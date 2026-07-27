import type { createDashboardQueries } from "../../app/use-cases/query-dashboard";
import type { createClassificationActions } from "../../app/use-cases/classify-transactions";
import type { createPayPalPaymentReconciliation } from "../../app/use-cases/reconcile-paypal-payments";
import { classificationMatchModes, economicDirections, economicTypes, linkStatuses, transactionTypes } from "../../core/finance/constants";
import { z } from "zod";

type CreateHttpRoutesOptions = {
  queries: ReturnType<typeof createDashboardQueries>;
  classifications: ReturnType<typeof createClassificationActions>;
  reconciliation: ReturnType<typeof createPayPalPaymentReconciliation>;
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
const updatePayPalLinkSchema = z.object({ linkId: z.number().int().positive(), status: z.enum(linkStatuses) });

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  return schema.parse(await request.json());
}

export function createHttpRoutes({ queries, classifications, reconciliation, indexHtml }: CreateHttpRoutesOptions) {
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
        const sourceIdText = url.searchParams.get("sourceId");
        const accountIdText = url.searchParams.get("accountId");
        const currencyCode = url.searchParams.get("currencyCode");
        const transactionType = url.searchParams.get("transactionType");
        const description = url.searchParams.get("description")?.trim() || undefined;
        const minAmountText = url.searchParams.get("minAmount");
        const maxAmountText = url.searchParams.get("maxAmount");
        const startDate = url.searchParams.get("startDate") || undefined;
        const endDate = url.searchParams.get("endDate") || undefined;
        const hideTrading212InterestCashbackAndDividendsText = url.searchParams.get("hideTrading212InterestCashbackAndDividends");
        const hideTrading212InterestCashbackAndDividends = hideTrading212InterestCashbackAndDividendsText === "true";
        const hideTransfersText = url.searchParams.get("hideTransfers");
        const hideTransfers = hideTransfersText === "true";
        const sourceId = sourceIdText === null ? undefined : Number(sourceIdText);
        const accountId = accountIdText === null ? undefined : Number(accountIdText);
        const minAmountMinor = minAmountText === null ? undefined : Math.round(Number(minAmountText) * 100);
        const maxAmountMinor = maxAmountText === null ? undefined : Math.round(Number(maxAmountText) * 100);
        if (economicType !== null && !economicTypes.includes(economicType as (typeof economicTypes)[number])) {
          return Response.json({ error: "economicType is invalid." }, { status: 400 });
        }
        if ((sourceIdText !== null && (!Number.isInteger(sourceId) || sourceId! < 1)) || (accountIdText !== null && (!Number.isInteger(accountId) || accountId! < 1)) || (currencyCode !== null && !/^[A-Z]{3}$/.test(currencyCode)) || (transactionType !== null && !transactionTypes.includes(transactionType as (typeof transactionTypes)[number])) || (description !== undefined && description.length > 200) || (minAmountText !== null && (!Number.isFinite(minAmountMinor) || minAmountMinor! < 0)) || (maxAmountText !== null && (!Number.isFinite(maxAmountMinor) || maxAmountMinor! < 0)) || (minAmountMinor !== undefined && maxAmountMinor !== undefined && minAmountMinor > maxAmountMinor) || (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) || (startDate && endDate && startDate > endDate) || (hideTrading212InterestCashbackAndDividendsText !== null && hideTrading212InterestCashbackAndDividendsText !== "true" && hideTrading212InterestCashbackAndDividendsText !== "false") || (hideTransfersText !== null && hideTransfersText !== "true" && hideTransfersText !== "false")) {
          return Response.json({ error: "Transaction filters are invalid." }, { status: 400 });
        }
        const filters = { economicType: economicType as (typeof economicTypes)[number] | undefined, sourceId, accountId, currencyCode: currencyCode ?? undefined, transactionType: transactionType as (typeof transactionTypes)[number] | undefined, description, minAmountMinor, maxAmountMinor, startDate, endDate, hideTrading212InterestCashbackAndDividends, hideTransfers };
        if (limitText === null && offsetText === null) {
          return Response.json(await queries.listTransactions(filters));
        }
        const limit = Number(limitText);
        const offset = Number(offsetText ?? "0");
        if (!Number.isInteger(limit) || limit < 1 || limit > 250 || !Number.isInteger(offset) || offset < 0) {
          return Response.json({ error: "limit must be 1–250 and offset must be a non-negative integer." }, { status: 400 });
        }
        return Response.json(await queries.listTransactions({ ...filters, limit, offset }));
      },
    },

    "/api/transactions/summary": {
      async GET(request: Request) {
        const url = new URL(request.url);
        const economicType = url.searchParams.get("economicType");
        const sourceIdText = url.searchParams.get("sourceId");
        const accountIdText = url.searchParams.get("accountId");
        const currencyCode = url.searchParams.get("currencyCode");
        const transactionType = url.searchParams.get("transactionType");
        const description = url.searchParams.get("description")?.trim() || undefined;
        const minAmountText = url.searchParams.get("minAmount");
        const maxAmountText = url.searchParams.get("maxAmount");
        const startDate = url.searchParams.get("startDate") || undefined;
        const endDate = url.searchParams.get("endDate") || undefined;
        const hideTrading212InterestCashbackAndDividendsText = url.searchParams.get("hideTrading212InterestCashbackAndDividends");
        const hideTransfersText = url.searchParams.get("hideTransfers");
        const sourceId = sourceIdText === null ? undefined : Number(sourceIdText);
        const accountId = accountIdText === null ? undefined : Number(accountIdText);
        const minAmountMinor = minAmountText === null ? undefined : Math.round(Number(minAmountText) * 100);
        const maxAmountMinor = maxAmountText === null ? undefined : Math.round(Number(maxAmountText) * 100);
        if ((economicType !== null && !economicTypes.includes(economicType as (typeof economicTypes)[number])) || (sourceIdText !== null && (!Number.isInteger(sourceId) || sourceId! < 1)) || (accountIdText !== null && (!Number.isInteger(accountId) || accountId! < 1)) || (currencyCode !== null && !/^[A-Z]{3}$/.test(currencyCode)) || (transactionType !== null && !transactionTypes.includes(transactionType as (typeof transactionTypes)[number])) || (description !== undefined && description.length > 200) || (minAmountText !== null && (!Number.isFinite(minAmountMinor) || minAmountMinor! < 0)) || (maxAmountText !== null && (!Number.isFinite(maxAmountMinor) || maxAmountMinor! < 0)) || (minAmountMinor !== undefined && maxAmountMinor !== undefined && minAmountMinor > maxAmountMinor) || (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) || (startDate && endDate && startDate > endDate) || (hideTrading212InterestCashbackAndDividendsText !== null && hideTrading212InterestCashbackAndDividendsText !== "true" && hideTrading212InterestCashbackAndDividendsText !== "false") || (hideTransfersText !== null && hideTransfersText !== "true" && hideTransfersText !== "false")) {
          return Response.json({ error: "Transaction filters are invalid." }, { status: 400 });
        }
        return Response.json(await queries.summarizeTransactions({
          economicType: economicType as (typeof economicTypes)[number] | undefined,
          sourceId,
          accountId,
          currencyCode: currencyCode ?? undefined,
          transactionType: transactionType as (typeof transactionTypes)[number] | undefined,
          description,
          minAmountMinor,
          maxAmountMinor,
          startDate,
          endDate,
          hideTrading212InterestCashbackAndDividends: hideTrading212InterestCashbackAndDividendsText === "true",
          hideTransfers: hideTransfersText === "true",
        }));
      },
    },

    "/api/imports/latest": {
      async GET() {
        return Response.json(await queries.getLatestImport());
      },
    },

    "/api/dashboard/cash-flow": {
      async GET(request: Request) {
        const url = new URL(request.url);
        const startDate = url.searchParams.get("start");
        const endDate = url.searchParams.get("end");
        if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
          return Response.json({ error: "start and end must use YYYY-MM-DD, with start on or before end." }, { status: 400 });
        }
        return Response.json(await queries.getCashFlowSummary({ startDate, endDate }));
      },
    },

    "/api/dashboard/cash-flow-over-time": {
      async GET(request: Request) {
        const url = new URL(request.url);
        const startDate = url.searchParams.get("start");
        const endDate = url.searchParams.get("end");
        const granularity = url.searchParams.get("granularity");
        if (!startDate || !endDate || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(endDate) || startDate > endDate || (granularity !== "month" && granularity !== "year")) {
          return Response.json({ error: "start and end must use YYYY-MM-DD, start must not be after end, and granularity must be month or year." }, { status: 400 });
        }
        return Response.json(await queries.getCashFlowTrend({ startDate, endDate, granularity }));
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

    "/api/reconciliation/paypal": {
      async GET() {
        return Response.json(await reconciliation.listLinks());
      },
    },

    "/api/reconciliation/paypal/status": {
      async POST(request: Request) {
        try {
          const { linkId, status } = await parseBody(request, updatePayPalLinkSchema);
          return Response.json(await reconciliation.setLinkStatus(linkId, status));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to update PayPal match." }, { status: 400 });
        }
      },
    },
  };
}
