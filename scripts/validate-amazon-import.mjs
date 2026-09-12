import { amazonImportSchema } from "../src/app/contracts/amazon-orders";

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Usage: bun scripts/validate-amazon-import.mjs <import.json> [...more.json]");
for (const path of paths) {
  const file = amazonImportSchema.parse(await Bun.file(path).json());
  console.log(`${path}: ${file.orders.length} orders, ${file.orders.reduce((n, o) => n + (o.items?.length ?? 0), 0)} item lines; ${file.orders.filter(o => o.incomplete).length} incomplete orders. Valid purchase evidence; no bank events created.`);
}
