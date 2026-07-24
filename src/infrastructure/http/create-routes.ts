import type { createDashboardQueries } from "../../app/use-cases/query-dashboard";
import type { createClassificationActions } from "../../app/use-cases/classify-transactions";
import { classificationMatchModes, economicDirections, economicTypes } from "../../core/finance/constants";
import { z } from "zod";

type CreateHttpRoutesOptions = {
  queries: ReturnType<typeof createDashboardQueries>;
  classifications: ReturnType<typeof createClassificationActions>;
  indexHtml: unknown;
};

const saveRuleSchema = z.object({
  sourceId: z.number().int().positive(),
  description: z.string().min(1),
  matchMode: z.enum(classificationMatchModes),
  direction: z.enum(economicDirections),
  economicType: z.enum(economicTypes),
});

const deleteRuleSchema = z.object({ ruleId: z.number().int().positive() });

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  return schema.parse(await request.json());
}

export function createHttpRoutes({ queries, classifications, indexHtml }: CreateHttpRoutesOptions) {
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
      async GET(request: Request) {
        const url = new URL(request.url);
        const limitText = url.searchParams.get("limit");
        const offsetText = url.searchParams.get("offset");
        const economicType = url.searchParams.get("economicType");
        if (economicType !== null && !economicTypes.includes(economicType as (typeof economicTypes)[number])) {
          return Response.json({ error: "economicType is invalid." }, { status: 400 });
        }
        if (limitText === null && offsetText === null) {
          return Response.json(await queries.listTransactions({ economicType: economicType as (typeof economicTypes)[number] | undefined }));
        }
        const limit = Number(limitText);
        const offset = Number(offsetText ?? "0");
        if (!Number.isInteger(limit) || limit < 1 || limit > 250 || !Number.isInteger(offset) || offset < 0) {
          return Response.json({ error: "limit must be 1–250 and offset must be a non-negative integer." }, { status: 400 });
        }
        return Response.json(await queries.listTransactions({ limit, offset, economicType: economicType as (typeof economicTypes)[number] | undefined }));
      },
    },

    "/api/imports/latest": {
      async GET() {
        return Response.json(await queries.getLatestImport());
      },
    },

    "/api/dashboard/monthly": {
      async GET(request: Request) {
        const month = new URL(request.url).searchParams.get("month");
        if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          return Response.json({ error: "month must use YYYY-MM." }, { status: 400 });
        }
        return Response.json(await queries.getMonthlyCashFlowSummary(month));
      },
    },

    "/api/classification/review": {
      async GET() {
        return Response.json(await classifications.listReviewGroups());
      },
    },

    "/api/classification/rules": {
      async GET() {
        return Response.json(await classifications.listRules());
      },
      async POST(request: Request) {
        try {
          return Response.json(await classifications.saveRule(await parseBody(request, saveRuleSchema)));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Invalid classification rule." }, { status: 400 });
        }
      },
    },

    "/api/classification/rules/delete": {
      async POST(request: Request) {
        try {
          const { ruleId } = await parseBody(request, deleteRuleSchema);
          return Response.json(await classifications.deleteRule(ruleId));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to delete classification rule." }, { status: 400 });
        }
      },
    },
  };
}
