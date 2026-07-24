import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { schema } from "./schema";

const defaultDatabasePath = resolve(process.cwd(), "data", "app.db");

export function createDb(databasePath = defaultDatabasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
  return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof createDb>;
