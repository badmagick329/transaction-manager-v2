import { serve } from "bun";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import indexHtml from "./index.html";
import { createDashboardQueries } from "./app/use-cases/query-dashboard";
import { createClassificationActions } from "./app/use-cases/classify-transactions";
import { createPayPalPaymentReconciliation } from "./app/use-cases/reconcile-paypal-payments";
import { createDb } from "./infrastructure/db/client";
import { DrizzleDashboardQueryRepository } from "./infrastructure/db/drizzle-dashboard-query-repository";
import { DrizzleImportRepository } from "./infrastructure/db/drizzle-import-repository";
import { DrizzleClassificationRepository } from "./infrastructure/db/drizzle-classification-repository";
import { DrizzlePayPalReconciliationRepository } from "./infrastructure/db/drizzle-paypal-reconciliation-repository";
import { createHttpRoutes } from "./infrastructure/http/create-routes";
import { startWatchedImports } from "./infrastructure/imports/watched-imports";

export function startApp() {
  const db = createDb();
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const queries = createDashboardQueries(new DrizzleDashboardQueryRepository(db));
  const classifications = createClassificationActions(new DrizzleClassificationRepository(db));
  const reconciliation = createPayPalPaymentReconciliation(new DrizzlePayPalReconciliationRepository(db));
  const routes = createHttpRoutes({
    queries,
    classifications,
    reconciliation,
    indexHtml,
  });

  void reconciliation.proposeLinks().catch(error => console.error("Unable to backfill PayPal matches", error));
  void startWatchedImports({ repository: new DrizzleImportRepository(db), afterProcessedImport: reconciliation.proposeLinks }).catch(error => {
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
