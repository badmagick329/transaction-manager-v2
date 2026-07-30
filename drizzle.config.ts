import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

const dataDirectory = process.env.DATA_DIR ?? "./data";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/infrastructure/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? resolve(dataDirectory, "app.db"),
  },
});
