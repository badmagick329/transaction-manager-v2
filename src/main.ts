import { serve } from "bun";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import indexHtml from "./index.html";
import { createDashboardQueries } from "./app/use-cases/query-dashboard";
import { createDb } from "./infrastructure/db/client";
import { DrizzleDashboardQueryRepository } from "./infrastructure/db/drizzle-dashboard-query-repository";
import { DrizzleImportRepository } from "./infrastructure/db/drizzle-import-repository";
import { createHttpRoutes } from "./infrastructure/http/create-routes";
import { startWatchedImports } from "./infrastructure/imports/watched-imports";

export function startApp() {
  const db = createDb();
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const queries = createDashboardQueries(new DrizzleDashboardQueryRepository(db));
  const routes = createHttpRoutes({
    queries,
    indexHtml,
  });

  void startWatchedImports({ repository: new DrizzleImportRepository(db) }).catch(error => {
    console.error("Unable to start import watcher", error);
  });

  const server = serve({
    routes,
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  });

  return server;
}
