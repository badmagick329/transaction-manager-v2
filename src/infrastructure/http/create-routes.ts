import type { createDashboardQueries } from "../../app/use-cases/query-dashboard";
import type { createClassificationActions } from "../../app/use-cases/classify-transactions";
import type { createPayPalPaymentReconciliation } from "../../app/use-cases/reconcile-paypal-payments";
import type { createTaggingActions } from "../../app/use-cases/manage-tags";
import { classificationMatchModes, economicDirections, economicTypes, linkStatuses, transactionTypes } from "../../core/finance/constants";
import type { TransactionFilters } from "../../app/ports/dashboard-query-repository";
import { z } from "zod";

type CreateHttpRoutesOptions = {
  queries: ReturnType<typeof createDashboardQueries>;
  classifications: ReturnType<typeof createClassificationActions>;
  reconciliation: ReturnType<typeof createPayPalPaymentReconciliation>;
  tagging: ReturnType<typeof createTaggingActions>;
};

type RequestHandler = (request: Request) => Response | Promise<Response>;
type HttpRoute = Partial<Record<"GET" | "POST", RequestHandler>>;

const saveRuleSchema = z.object({
  sourceId: z.number().int().positive(),
  description: z.string().min(1),
  matchMode: z.enum(classificationMatchModes),
  direction: z.enum(economicDirections),
  economicType: z.enum(economicTypes),
});

const deleteRuleSchema = z.object({ ruleId: z.number().int().positive() });
const updatePayPalLinkSchema = z.object({ linkId: z.number().int().positive(), status: z.enum(linkStatuses) });
const updateCashFlowExclusionSchema = z.object({ transactionId: z.number().int().positive(), excluded: z.boolean() });
const tagNameSchema = z.string().max(50);
const createTagSchema = z.object({ name: tagNameSchema });
const renameTagSchema = z.object({ tagId: z.number().int().positive(), name: tagNameSchema });
const deleteTagSchema = z.object({ tagId: z.number().int().positive() });
const setManualTagSchema = z.object({ transactionId: z.number().int().positive(), tagId: z.number().int().positive(), assigned: z.boolean() });
const saveTagRuleSchema = z.object({
  ruleId: z.number().int().positive().optional(),
  tagId: z.number().int().positive(),
  sourceId: z.number().int().positive(),
  description: z.string().max(200),
  matchMode: z.enum(classificationMatchModes),
  direction: z.enum(economicDirections),
});
const deleteTagRuleSchema = z.object({ ruleId: z.number().int().positive() });

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  return schema.parse(await request.json());
}

function parseTransactionFilters(url: URL): TransactionFilters | null {
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
  const cashFlowExcludedText = url.searchParams.get("cashFlowExcluded");
  const tagIdTexts = url.searchParams.getAll("tagId");
  const untaggedText = url.searchParams.get("untagged");
  const sourceId = sourceIdText === null ? undefined : Number(sourceIdText);
  const accountId = accountIdText === null ? undefined : Number(accountIdText);
  const minAmountMinor = minAmountText === null ? undefined : Math.round(Number(minAmountText) * 100);
  const maxAmountMinor = maxAmountText === null ? undefined : Math.round(Number(maxAmountText) * 100);
  const tagIds = tagIdTexts.map(Number);

  if (
    (economicType !== null && !economicTypes.includes(economicType as (typeof economicTypes)[number])) ||
    (sourceIdText !== null && (!Number.isInteger(sourceId) || sourceId! < 1)) ||
    (accountIdText !== null && (!Number.isInteger(accountId) || accountId! < 1)) ||
    (currencyCode !== null && !/^[A-Z]{3}$/.test(currencyCode)) ||
    (transactionType !== null && !transactionTypes.includes(transactionType as (typeof transactionTypes)[number])) ||
    (description !== undefined && description.length > 200) ||
    (minAmountText !== null && !Number.isFinite(minAmountMinor)) ||
    (maxAmountText !== null && !Number.isFinite(maxAmountMinor)) ||
    (minAmountMinor !== undefined && maxAmountMinor !== undefined && minAmountMinor > maxAmountMinor) ||
    (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) ||
    (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) ||
    (startDate && endDate && startDate > endDate) ||
    (hideTrading212InterestCashbackAndDividendsText !== null && hideTrading212InterestCashbackAndDividendsText !== "true" && hideTrading212InterestCashbackAndDividendsText !== "false") ||
    (hideTransfersText !== null && hideTransfersText !== "true" && hideTransfersText !== "false") ||
    (cashFlowExcludedText !== null && cashFlowExcludedText !== "true" && cashFlowExcludedText !== "false")
    || tagIds.some(tagId => !Number.isInteger(tagId) || tagId < 1)
    || (untaggedText !== null && untaggedText !== "true" && untaggedText !== "false")
  ) return null;

  return {
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
    cashFlowExcluded: cashFlowExcludedText === "true" ? true : cashFlowExcludedText === "false" ? false : undefined,
    ...(tagIds.length > 0 ? { tagIds: [...new Set(tagIds)] } : {}),
    ...(untaggedText === "true" ? { untagged: true } : {}),
  };
}

export function createHttpRoutes({ queries, classifications, reconciliation, tagging }: CreateHttpRoutesOptions) {
  return {
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
        const filters = parseTransactionFilters(url);
        if (!filters) {
          return Response.json({ error: "Transaction filters are invalid." }, { status: 400 });
        }
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
        const filters = parseTransactionFilters(url);
        if (!filters) {
          return Response.json({ error: "Transaction filters are invalid." }, { status: 400 });
        }
        return Response.json(await queries.summarizeTransactions(filters));
      },
    },

    "/api/transactions/cash-flow-exclusions/count": {
      async GET() {
        return Response.json({ count: await queries.getCashFlowExclusionCount() });
      },
    },

    "/api/transactions/cash-flow-exclusion": {
      async POST(request: Request) {
        try {
          const { transactionId, excluded } = await parseBody(request, updateCashFlowExclusionSchema);
          await queries.setCashFlowExcluded(transactionId, excluded);
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to update cash-flow exclusion." }, { status: 400 });
        }
      },
    },

    "/api/transactions/tag": {
      async POST(request: Request) {
        try {
          const { transactionId, tagId, assigned } = await parseBody(request, setManualTagSchema);
          await tagging.setManualTag(transactionId, tagId, assigned);
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to update transaction tag." }, { status: 400 });
        }
      },
    },

    "/api/tags": {
      async GET() {
        return Response.json(await tagging.listTags());
      },
      async POST(request: Request) {
        try {
          const { name } = await parseBody(request, createTagSchema);
          return Response.json(await tagging.createTag(name));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to create tag." }, { status: 400 });
        }
      },
    },

    "/api/tags/rename": {
      async POST(request: Request) {
        try {
          const { tagId, name } = await parseBody(request, renameTagSchema);
          return Response.json(await tagging.renameTag(tagId, name));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to rename tag." }, { status: 400 });
        }
      },
    },

    "/api/tags/delete": {
      async POST(request: Request) {
        try {
          const { tagId } = await parseBody(request, deleteTagSchema);
          await tagging.deleteTag(tagId);
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to delete tag." }, { status: 400 });
        }
      },
    },

    "/api/tag-rules": {
      async GET() {
        return Response.json(await tagging.listRules());
      },
      async POST(request: Request) {
        try {
          return Response.json(await tagging.saveRule(await parseBody(request, saveTagRuleSchema)));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to save tag rule." }, { status: 400 });
        }
      },
    },

    "/api/tag-rules/delete": {
      async POST(request: Request) {
        try {
          const { ruleId } = await parseBody(request, deleteTagRuleSchema);
          return Response.json(await tagging.deleteRule(ruleId));
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Unable to delete tag rule." }, { status: 400 });
        }
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
  } satisfies Record<string, HttpRoute>;
}
