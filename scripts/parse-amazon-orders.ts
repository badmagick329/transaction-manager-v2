import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseAmazonExport, splitAmazonExport } from "../src/infrastructure/import/amazon-export";

const args = process.argv.slice(2);
const paths: string[] = [];
let invoiceText: unknown = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--invoice-text") { if (!args[i + 1]) throw new Error("--invoice-text requires a JSON path"); invoiceText = JSON.parse(await readFile(args[++i]!, "utf8")); }
  else paths.push(args[i]!);
}
if (!paths.length) throw new Error("Usage: bun scripts/parse-amazon-orders.ts <amazon-export.zip> [--invoice-text <extracted-pages.json>]");
await mkdir("notes/temp_files", { recursive: true });
for (const path of paths) {
  const { file, report } = parseAmazonExport(await readFile(path), basename(path), new Date().toISOString(), invoiceText);
  const stem = `${basename(path).replace(/\.zip$/i, "")}-${file.source.fileHash.slice(0, 12)}${args.includes("--invoice-text") ? "-invoices" : ""}`;
  const output = join("notes/temp_files", stem);
  await mkdir(output, { recursive: true });
  for (const single of splitAmazonExport(file)) {
    const order = single.orders[0]!;
    await writeFile(join(output, `${order.marketplace}-${order.orderId}.amazon-orders.json`), JSON.stringify(single, null, 2));
  }
  await writeFile(join("notes/temp_files", `${stem}.report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report, diagnostics: `${report.diagnostics.length} details in report` }, null, 2));
}
