import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { correctHsbcDirectDebitTransfers } from "./correct-hsbc-direct-debits";
import { createDb } from "./client";

const db = createDb();
migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

const correctedCount = await correctHsbcDirectDebitTransfers(db);
console.log(`Corrected ${correctedCount} HSBC direct-debit transactions.`);
