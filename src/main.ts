import { serve } from "bun";
import { isAbsolute, relative, resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDashboardQueries } from "./app/use-cases/query-dashboard";
import { createClassificationActions } from "./app/use-cases/classify-transactions";
import { createPayPalPaymentReconciliation } from "./app/use-cases/reconcile-paypal-payments";
import { createTaggingActions } from "./app/use-cases/manage-tags";
import { createDb } from "./infrastructure/db/client";
import { DrizzleDashboardQueryRepository } from "./infrastructure/db/drizzle-dashboard-query-repository";
import { DrizzleImportRepository } from "./infrastructure/db/drizzle-import-repository";
import { DrizzleClassificationRepository } from "./infrastructure/db/drizzle-classification-repository";
import { DrizzlePayPalReconciliationRepository } from "./infrastructure/db/drizzle-paypal-reconciliation-repository";
import { DrizzleTaggingRepository } from "./infrastructure/db/drizzle-tagging-repository";
import { createHttpRoutes } from "./infrastructure/http/create-routes";
import { startWatchedImports } from "./infrastructure/imports/watched-imports";

export async function startApp() {
  const db = createDb();
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const queries = createDashboardQueries(new DrizzleDashboardQueryRepository(db));
  const classificationRepository = new DrizzleClassificationRepository(db);
  const classifications = createClassificationActions(classificationRepository);
  const reconciliation = createPayPalPaymentReconciliation(new DrizzlePayPalReconciliationRepository(db));
  const tagging = createTaggingActions(new DrizzleTaggingRepository(db));
  const routes = createHttpRoutes({
    queries,
    classifications,
    reconciliation,
    tagging,
  });

  await classificationRepository.ensureTrading212DefaultRules();
  await reconciliation.proposeLinks();
  await startWatchedImports({ repository: new DrizzleImportRepository(db), afterProcessedImport: reconciliation.proposeLinks });

  const server = serve({
    hostname: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    async fetch(request) {
      const url = new URL(request.url);
      const handler = routes[url.pathname]?.[request.method as "GET" | "POST"];
      if (handler) return handler(request);
      if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

      return serveFrontend(url.pathname);
    },
  });

  return server;
}

const distDirectory = resolve(process.cwd(), "dist");

async function serveFrontend(pathname: string) {
  const assetPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = resolve(distDirectory, assetPath);
  const pathRelativeToDist = relative(distDirectory, filePath);
  if (pathRelativeToDist.startsWith("..") || isAbsolute(pathRelativeToDist)) return new Response("Forbidden", { status: 403 });

  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  if (!assetPath.includes(".")) return new Response(Bun.file(resolve(distDirectory, "index.html")));
  return new Response("Not found", { status: 404 });
}
