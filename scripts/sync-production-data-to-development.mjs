import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const localDataDirectory = resolve(projectDirectory, "data");
const arguments_ = process.argv.slice(2);

if (arguments_.includes("--help") || arguments_.includes("-h")) {
  console.log("Usage: bun scripts/sync-production-data-to-development.mjs --yes");
  console.log("Copies a consistent production data snapshot into the local data directory.");
  console.log("The current local data directory is retained under tmp/ for recovery.");
  process.exit(0);
}

if (!arguments_.includes("--yes")) {
  throw new Error("Refusing to replace local data without confirmation. Re-run with --yes.");
}

const deploymentEnvironment = await readDeploymentEnvironment();
const requiredSettings = ["DEPLOY_HOST", "DEPLOY_APP_DIR"];
const missingSettings = requiredSettings.filter(setting => !deploymentEnvironment[setting]);
if (missingSettings.length > 0) {
  throw new Error(`Missing required deployment setting(s): ${missingSettings.join(", ")}`);
}

const sshTarget = deploymentEnvironment.DEPLOY_USER
  ? `${deploymentEnvironment.DEPLOY_USER}@${deploymentEnvironment.DEPLOY_HOST}`
  : deploymentEnvironment.DEPLOY_HOST;
const sshOptions = deploymentEnvironment.DEPLOY_SSH_PORT ? ["-p", deploymentEnvironment.DEPLOY_SSH_PORT] : [];
const scpOptions = deploymentEnvironment.DEPLOY_SSH_PORT ? ["-P", deploymentEnvironment.DEPLOY_SSH_PORT] : [];
const syncId = `${new Date().toISOString().replaceAll(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
const temporaryDirectory = resolve(projectDirectory, "tmp", `production-data-sync-${syncId}`);
const extractedDirectory = resolve(temporaryDirectory, "snapshot");
const archivePath = resolve(temporaryDirectory, "production-data.tar.gz");
const previousDataDirectory = resolve(temporaryDirectory, "previous-data");
const remoteArchivePath = `/tmp/transaction-manager-data-${syncId}.tar.gz`;

await mkdir(extractedDirectory, { recursive: true });

let localDataWasMoved = false;
try {
  console.log("Stopping production long enough to take a consistent SQLite snapshot...");
  await runRemoteSnapshot({
    sshOptions,
    sshTarget,
    appDirectory: deploymentEnvironment.DEPLOY_APP_DIR,
    remoteArchivePath,
  });

  console.log("Downloading the production snapshot...");
  await run("scp", [...scpOptions, `${sshTarget}:${remoteArchivePath}`, archivePath]);

  console.log("Extracting and checking the snapshot...");
  await run("tar", ["-xzf", archivePath, "-C", extractedDirectory]);
  const extractedDataDirectory = resolve(extractedDirectory, "data");
  await requireFile(resolve(extractedDataDirectory, "app.db"));

  console.log("Backing up the current development data and installing the snapshot...");
  await renameIfPresent(localDataDirectory, previousDataDirectory);
  localDataWasMoved = true;
  await rename(extractedDataDirectory, localDataDirectory);

  try {
    verifyDatabase(resolve(localDataDirectory, "app.db"));
  } catch (error) {
    await rm(localDataDirectory, { recursive: true, force: true });
    await rename(previousDataDirectory, localDataDirectory);
    localDataWasMoved = false;
    throw error;
  }

  console.log(`Production data is now available in ${localDataDirectory}.`);
  console.log(`The previous development data is retained in ${previousDataDirectory}.`);
  console.log("Restart the development app before opening it so it reconnects to the copied database.");
} catch (error) {
  if (localDataWasMoved) {
    await rm(localDataDirectory, { recursive: true, force: true }).catch(() => {});
    await rename(previousDataDirectory, localDataDirectory).catch(() => {});
  }
  throw error;
} finally {
  await runRemoteCleanup({ sshOptions, sshTarget, remoteArchivePath }).catch(error => {
    console.warn(`Could not remove the temporary production archive: ${error.message}`);
  });
}

async function readDeploymentEnvironment() {
  const environmentPath = resolve(projectDirectory, ".env.deploy");
  let source;
  try {
    source = await Bun.file(environmentPath).text();
  } catch {
    throw new Error("Missing .env.deploy. Copy .env.deploy.example and fill in the deployment settings.");
  }

  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/^(?:["'])(.*)(?:["'])$/, "$1");
  }
  return values;
}

async function runRemoteSnapshot({ sshOptions, sshTarget, appDirectory, remoteArchivePath }) {
  const remoteScript = `
set -eu
app_directory="$1"
archive_path="$2"
restarted=0
cleanup() {
  if [ "$restarted" -eq 1 ]; then
    docker compose up -d >/dev/null
  fi
}
trap cleanup EXIT
cd -- "$app_directory"
restarted=1
docker compose down
tar -czf "$archive_path" data
`;
  const remoteCommand = `sh -s -- ${quoteForShell(appDirectory)} ${quoteForShell(remoteArchivePath)}`;
  await run("ssh", [...sshOptions, sshTarget, remoteCommand], { stdin: remoteScript });
}

async function runRemoteCleanup({ sshOptions, sshTarget, remoteArchivePath }) {
  await run("ssh", [...sshOptions, sshTarget, `rm -f -- ${quoteForShell(remoteArchivePath)}`]);
}

async function renameIfPresent(source, destination) {
  await rm(destination, { recursive: true, force: true });
  try {
    await rename(source, destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function requireFile(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`Production snapshot is missing ${path}.`);
  }
}

function verifyDatabase(path) {
  const database = new Database(path, { readonly: true });
  try {
    const result = database.query("PRAGMA integrity_check").get();
    if (!result || Object.values(result)[0] !== "ok") throw new Error("The copied SQLite database failed integrity_check.");
  } finally {
    database.close();
  }
}

function quoteForShell(value) {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

async function run(command, args, options = {}) {
  const process = Bun.spawn([command, ...args], {
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : "."}`);
  }
  return stdout;
}
