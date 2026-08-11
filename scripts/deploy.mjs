const deploymentEnvPath = new URL("../.env.deploy", import.meta.url);

function parseEnv(source) {
  const values = {};

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;

    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  }

  return values;
}

let deployConfig;
try {
  deployConfig = parseEnv(await Bun.file(deploymentEnvPath).text());
} catch {
  throw new Error("Missing .env.deploy. Copy .env.deploy.example and fill in the deployment settings.");
}

const requiredSettings = ["DEPLOY_HOST", "DEPLOY_APP_DIR"];
const missingSettings = requiredSettings.filter(setting => !deployConfig[setting]);
if (missingSettings.length > 0) {
  throw new Error(`Missing required deployment setting(s): ${missingSettings.join(", ")}`);
}

const sshTarget = deployConfig.DEPLOY_USER
  ? `${deployConfig.DEPLOY_USER}@${deployConfig.DEPLOY_HOST}`
  : deployConfig.DEPLOY_HOST;
const sshArgs = ["ssh"];
if (deployConfig.DEPLOY_SSH_PORT) sshArgs.push("-p", deployConfig.DEPLOY_SSH_PORT);

const remoteScript = String.raw`
set -eu
app_dir="$1"
health_url="$2"

cd -- "$app_dir"
git pull --ff-only
docker compose up -d --build
docker compose ps

if [ -n "$health_url" ]; then
  if command -v curl >/dev/null 2>&1; then
    curl --fail --show-error --silent "$health_url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --output-document=- "$health_url"
  else
    echo "Health check skipped: neither curl nor wget is available on the server." >&2
  fi
fi
`;

const deployProcess = Bun.spawn(
  [...sshArgs, sshTarget, "sh", "-s", "--", deployConfig.DEPLOY_APP_DIR, deployConfig.DEPLOY_HEALTH_URL ?? ""],
  { stdin: new Blob([remoteScript]), stdout: "inherit", stderr: "inherit" },
);

const exitCode = await deployProcess.exited;
if (exitCode !== 0) Bun.exit(exitCode);
