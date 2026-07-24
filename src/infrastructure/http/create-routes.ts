import type { createDashboardQueries } from "../../app/use-cases/query-dashboard";

type CreateHttpRoutesOptions = {
  queries: ReturnType<typeof createDashboardQueries>;
  indexHtml: unknown;
};

export function createHttpRoutes({ queries, indexHtml }: CreateHttpRoutesOptions) {
  return {
    "/*": indexHtml,

    "/api/health": {
      async GET() {
        return Response.json({
          status: "ok",
          database: true,
        });
      },
    },

    "/api/accounts": {
      async GET() {
        return Response.json(await queries.listAccounts());
      },
    },

    "/api/transactions": {
      async GET() {
        return Response.json(await queries.listTransactions());
      },
    },

    "/api/imports/latest": {
      async GET() {
        return Response.json(await queries.getLatestImport());
      },
    },
  };
}
