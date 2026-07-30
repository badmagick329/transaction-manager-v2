import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, parse, resolve } from "node:path";
import { standardImportFileSchema } from "../src/app/contracts/standard-import";

const remoteIncomingDirectory = "apps/transaction-manager-v2/data/imports/incoming";
const arguments_ = process.argv.slice(2);

if (arguments_.includes("--help") || arguments_.includes("-h") || arguments_.length === 0) {
  console.log("Usage: bun scripts/upload-imports-to-server.mjs [--host <ssh-host>] <import.json> [...more-imports.json]");
  process.exit(arguments_.length === 0 ? 1 : 0);
}

let host = process.env.IMPORT_SERVER ?? "";
const inputPaths = [];
for (let index = 0; index < arguments_.length; index += 1) {
  if (arguments_[index] === "--host") {
    host = arguments_[index + 1] ?? "";
    if (!host) throw new Error("--host requires a value.");
    index += 1;
  } else {
    inputPaths.push(arguments_[index]);
  }
}

if (inputPaths.length === 0) throw new Error("Provide at least one generated import JSON file.");
if (!host) throw new Error("Provide --host <ssh-host> or set IMPORT_SERVER.");

const localPaths = inputPaths.map(resolve);
await Promise.all(localPaths.map(validateImportFile));
await run("ssh", [host, `mkdir -p "$HOME/${remoteIncomingDirectory}"`]);

for (const localPath of localPaths) {
  const originalName = basename(localPath);
  const { name, ext } = parse(originalName);
  const transferId = randomUUID();
  const temporaryName = `.${name}-${transferId}${ext}.uploading`;
  const remoteTemporaryPath = `~/${remoteIncomingDirectory}/${temporaryName}`;

  try {
    await run("scp", [localPath, `${host}:${remoteTemporaryPath}`]);
    const remoteCommand = [
      `incoming="$HOME/${remoteIncomingDirectory}"`,
      `temporary=${quoteForShell(temporaryName)}`,
      `requested=${quoteForShell(originalName)}`,
      `unique=${quoteForShell(`${name}-${transferId.slice(0, 8)}${ext}`)}`,
      'if [ -e "$incoming/$requested" ]; then final="$unique"; else final="$requested"; fi',
      'mv "$incoming/$temporary" "$incoming/$final"',
      'printf "%s\\n" "$incoming/$final"',
    ].join("; ");
    const remotePath = await run("ssh", [host, remoteCommand]);
    console.log(`${originalName} uploaded to ${remotePath.trim()}`);
  } catch (error) {
    await run("ssh", [host, `rm -f "$HOME/${remoteIncomingDirectory}/${temporaryName}"`]).catch(() => {});
    throw error;
  }
}

async function validateImportFile(filePath) {
  if (extname(filePath).toLowerCase() !== ".json") throw new Error(`${filePath} is not a JSON file.`);
  if (!(await stat(filePath)).isFile()) throw new Error(`${filePath} is not a file.`);

  const parsed = standardImportFileSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")));
  if (!parsed.success) throw new Error(`${filePath} is not a valid standard import: ${parsed.error.message}`);
}

function quoteForShell(value) {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

async function run(command, args) {
  const process = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(process.stdout).text();
  if (await process.exited !== 0) throw new Error(`${command} failed.`);
  return output;
}
