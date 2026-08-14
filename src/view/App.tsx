import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "../index.css";
import { ClassificationPage } from "./ClassificationPage";
import { ReconciliationPage } from "./ReconciliationPage";
import { TagsPage } from "./TagsPage";
import { TagPicker } from "./TagPicker";
import { DatePicker } from "../components/ui/date-picker";
import { Checkbox } from "../components/ui/checkbox";
import { capEndDateToCoverage, coverageIntervalForStart } from "../app/data-coverage";
import { DataCoverageCard } from "./DataCoverageCard";
import { economicTypeOptions, economicTypeOptionsForDirection, formatCompactMoney, formatMoney, formatTransactionDate, matchModeOptions, titleCase } from "./formatters";
import type { Account, CashFlowSummary, CashFlowTrend, ClassificationMatchMode, ClassificationReviewGroup, ClassificationRule, DataCoverage, EconomicDirection, EconomicType, LatestImport, PayPalPaymentLink, Tag, TagRule, TagRuleDraft, Transaction, TransactionFilters, TransactionSummary } from "./types";

/*type LatestImport = {
  fileName: string;
  status: string;
  recordCount: number;
  duplicateRecordCount: number;
  attemptCount: number;
  errorMessage: string | null;
  importedAt: string | null;
} | null;

type Transaction = {
  id: number;
  accountName: string;
  transactionDate: string;
  description: string;
  amountMinor: number;
  currencyCode: string;
  transactionType: string;
  economicType: string;
  reconciliationLabel: string | null;
  isExcludedFromCashFlow: boolean;
};

type TransactionSummary = { currencyCode: string; transactionCount: number; incomeMinor: number; expenseMinor: number; netCashFlowMinor: number; transferInflowMinor: number; transferOutflowMinor: number };

type Account = { id: number; name: string; currencyCode: string; sourceName: string | null; sourceId: number | null };
type TransactionFilters = { sourceId: string; accountId: string; currencyCode: string; transactionType: string; description: string; minAmount: string; maxAmount: string; startDate: string; endDate: string; hideTrading212InterestCashbackAndDividends: boolean; hideTransfers: boolean };

type PayPalPaymentLink = {
  id: number;
  status: "pending" | "confirmed" | "rejected";
  confidenceScore: number | null;
  matchReason: string | null;
  hsbcTransaction: { id: number; transactionDate: string; description: string; amountMinor: number; currencyCode: string };
  paypalTransaction: { id: number; transactionDate: string; description: string; amountMinor: number; currencyCode: string };
};

type EconomicType = "expense" | "income" | "transfer" | "unclassified";
type EconomicDirection = "inflow" | "outflow";
type ClassificationMatchMode = "exact" | "starts_with" | "contains" | "all";

type ClassificationReviewGroup = {
  sourceId: number;
  sourceName: string;
  description: string;
  direction: EconomicDirection;
  transactionCount: number;
  latestTransactionDate: string;
  samples: Array<{ id: number; transactionDate: string; amountMinor: number; currencyCode: string }>;
};

type ClassificationRule = {
  id: number;
  sourceId: number;
  sourceName: string;
  normalizedDescription: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
  economicType: EconomicType;
};

type CashFlowSourceBreakdown = {
  sourceName: string;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
};

type CashFlowSummary = {
  currencyCode: string;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
  unclassifiedTransactionCount: number;
  sources: CashFlowSourceBreakdown[];
};

type CashFlowPeriod = {
  period: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
  unclassifiedTransactionCount: number;
};

type CashFlowTrend = { currencyCode: string; periods: CashFlowPeriod[] };

const economicTypeOptions: EconomicType[] = ["expense", "income", "transfer", "unclassified"];
const matchModeOptions: ClassificationMatchMode[] = ["exact", "starts_with", "contains", "all"];
const transactionPageSize = 100;
const classificationReviewPageSize = 25;

function economicTypeOptionsForDirection(direction: EconomicDirection): EconomicType[] {
  return direction === "inflow" ? ["income", "transfer", "unclassified"] : ["expense", "transfer", "unclassified"];
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

function since2024Range() {
  return { startDate: "2024-01-01", endDate: toDateInput(new Date()) };
}

function presetDateRange(preset: "since_2024" | "month" | "last_30_days" | "last_90_days" | "year_to_date") {
  if (preset === "since_2024") return since2024Range();
  if (preset === "month") return currentMonthRange();
  const end = new Date();
  const start = new Date(end);
  if (preset === "year_to_date") start.setUTCMonth(0, 1);
  else start.setUTCDate(start.getUTCDate() - (preset === "last_30_days" ? 29 : 89));
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function formatCompactMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amountMinor / 100);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function formatTransactionDate(transactionDate: string) {
  return transactionDate.slice(0, 10);
}*/

function toDateInput(date: Date) { return date.toISOString().slice(0, 10); }
const transactionPageSize = 100;
const classificationReviewPageSize = 25;
function isAmountInput(value: string) { return value === "" || /^-?\d*(?:\.\d{0,2})?$/.test(value); }
function isCompleteAmount(value: string) { return /^-?\d+(?:\.\d{1,2})?$/.test(value); }
function currentMonthRange() { const now = new Date(); return { startDate: toDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), endDate: toDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))) }; }
function since2024Range() { return { startDate: "2024-01-01", endDate: toDateInput(new Date()) }; }
function presetDateRange(preset: "since_2024" | "month" | "last_30_days" | "last_90_days" | "year_to_date") { if (preset === "since_2024") return since2024Range(); if (preset === "month") return currentMonthRange(); const end = new Date(); const start = new Date(end); if (preset === "year_to_date") start.setUTCMonth(0, 1); else start.setUTCDate(start.getUTCDate() - (preset === "last_30_days" ? 29 : 89)); return { startDate: toDateInput(start), endDate: toDateInput(end) }; }
function coverageStartSuggestion(coverage: DataCoverage | null, selectedStart: string) { return coverage?.commonIntervals.find(interval => interval.startDate > selectedStart)?.startDate ?? coverage?.commonIntervals[0]?.startDate ?? null; }
const emptyTagRuleDraft: TagRuleDraft = { tagId: "", sourceId: "", description: "", matchMode: "exact", direction: "outflow" };
const emptyTransactionFilters: TransactionFilters = { sourceId: "", accountId: "", currencyCode: "", transactionType: "", description: "", minAmount: "", maxAmount: "", startDate: "", endDate: "", hideTrading212InterestCashbackAndDividends: false, hideTransfers: false, tagIds: [], untagged: false };

export function App() {
  const [latestImport, setLatestImport] = useState<LatestImport>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionSummary, setTransactionSummary] = useState<TransactionSummary[]>([]);
  const [cashFlowExclusionCount, setCashFlowExclusionCount] = useState(0);
  const [showingCashFlowExclusions, setShowingCashFlowExclusions] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dataCoverage, setDataCoverage] = useState<DataCoverage | null>(null);
  const [dashboardCompleteDataOnly, setDashboardCompleteDataOnly] = useState(false);
  const [transactionCompleteDataOnly, setTransactionCompleteDataOnly] = useState(false);
  const [savingCoverageAccountId, setSavingCoverageAccountId] = useState<number | null>(null);
  const [page, setPage] = useState<"dashboard" | "classification" | "reconciliation" | "tags" | "transactions">("dashboard");
  const [dateRange, setDateRange] = useState(since2024Range);
  const [datePreset, setDatePreset] = useState<"since_2024" | "month" | "last_30_days" | "last_90_days" | "year_to_date" | "custom">("since_2024");
  const [cashFlowSummary, setCashFlowSummary] = useState<CashFlowSummary[] | null>(null);
  const [cashFlowTrend, setCashFlowTrend] = useState<CashFlowTrend[] | null>(null);
  const [trendGranularity, setTrendGranularity] = useState<"month" | "year">("month");
  const [reviewGroups, setReviewGroups] = useState<ClassificationReviewGroup[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [payPalLinks, setPayPalLinks] = useState<PayPalPaymentLink[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagRules, setTagRules] = useState<TagRule[]>([]);
  const [tagRuleDraft, setTagRuleDraft] = useState<TagRuleDraft>(emptyTagRuleDraft);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { description: string; matchMode: ClassificationMatchMode }>>({});
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<"all" | EconomicType>("all");
  const [transactionFilters, setTransactionFilters] = useState<TransactionFilters>(emptyTransactionFilters);
  const [visibleReviewGroupCount, setVisibleReviewGroupCount] = useState(classificationReviewPageSize);
  const remainingClassificationCount = reviewGroups.reduce((total, group) => total + group.transactionCount, 0);
  const sources = [...new Map(accounts.filter(account => account.sourceId !== null).map(account => [account.sourceId!, account.sourceName ?? "Unknown source"])).entries()];
  const currencies = [...new Set(accounts.map(account => account.currencyCode))].sort();
  const dashboardCoverageInterval = dataCoverage ? coverageIntervalForStart(dataCoverage.commonIntervals, dateRange.startDate) : null;
  const transactionCoverageInterval = dataCoverage && transactionFilters.startDate ? coverageIntervalForStart(dataCoverage.commonIntervals, transactionFilters.startDate) : null;
  const dashboardQueryRange = useMemo(() => ({
    ...dateRange,
    endDate: dashboardCompleteDataOnly && dashboardCoverageInterval ? capEndDateToCoverage(dateRange.endDate, dashboardCoverageInterval) : dateRange.endDate,
  }), [dateRange, dashboardCompleteDataOnly, dashboardCoverageInterval?.endDate]);
  const transactionEffectiveEndDate = transactionCompleteDataOnly && transactionCoverageInterval
    ? capEndDateToCoverage(transactionFilters.endDate, transactionCoverageInterval)
    : transactionFilters.endDate;

  const loadClassifications = async () => {
    const [reviewResponse, rulesResponse] = await Promise.all([
      fetch("/api/classification/review"),
      fetch("/api/classification/rules"),
    ]);
    if (!reviewResponse.ok || !rulesResponse.ok) throw new Error("Unable to load classification data.");
    setReviewGroups(await reviewResponse.json());
    setRules(await rulesResponse.json());
    setVisibleReviewGroupCount(classificationReviewPageSize);
  };

  const loadPayPalLinks = async () => {
    const response = await fetch("/api/reconciliation/paypal");
    if (!response.ok) throw new Error("Unable to load PayPal matches.");
    setPayPalLinks(await response.json());
  };

  const loadTags = async () => {
    const [tagsResponse, rulesResponse] = await Promise.all([fetch("/api/tags"), fetch("/api/tag-rules")]);
    if (!tagsResponse.ok || !rulesResponse.ok) throw new Error("Unable to load tags.");
    setTags(await tagsResponse.json());
    setTagRules(await rulesResponse.json());
  };

  const loadCashFlowSummary = async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
    const response = await fetch(`/api/dashboard/cash-flow?start=${startDate}&end=${endDate}`);
    if (!response.ok) throw new Error("Unable to load cash flow.");
    setCashFlowSummary(await response.json());
    setError(null);
  };

  const loadCashFlowTrend = async ({ startDate, endDate }: { startDate: string; endDate: string }, granularity = trendGranularity) => {
    const response = await fetch(`/api/dashboard/cash-flow-over-time?start=${startDate}&end=${endDate}&granularity=${granularity}`);
    if (!response.ok) throw new Error("Unable to load cash-flow trend.");
    setCashFlowTrend(await response.json());
    setError(null);
  };

  const loadAccounts = async () => {
    const response = await fetch("/api/accounts");
    if (!response.ok) throw new Error("Unable to load accounts.");
    setAccounts(await response.json());
  };

  const loadDataCoverage = async () => {
    const response = await fetch("/api/data-coverage");
    if (!response.ok) throw new Error("Unable to load data coverage.");
    setDataCoverage(await response.json());
  };

  const loadCashFlowExclusionCount = async () => {
    const response = await fetch("/api/transactions/cash-flow-exclusions/count");
    if (!response.ok) throw new Error("Unable to load cash-flow exclusions.");
    const body: { count: number } = await response.json();
    setCashFlowExclusionCount(body.count);
  };

  const loadTransactions = async (offset = 0, append = false, filter = transactionFilter, filters = transactionFilters, showExcluded = showingCashFlowExclusions) => {
    setLoadingTransactions(true);
    try {
      const query = new URLSearchParams({ limit: String(transactionPageSize), offset: String(offset) });
      if (filter !== "all") query.set("economicType", filter);
      if (filters.sourceId) query.set("sourceId", filters.sourceId);
      if (filters.accountId) query.set("accountId", filters.accountId);
      if (filters.currencyCode) query.set("currencyCode", filters.currencyCode);
      if (filters.transactionType) query.set("transactionType", filters.transactionType);
      if (filters.description.trim()) query.set("description", filters.description.trim());
      if (isCompleteAmount(filters.minAmount)) query.set("minAmount", filters.minAmount);
      if (isCompleteAmount(filters.maxAmount)) query.set("maxAmount", filters.maxAmount);
      if (filters.startDate) query.set("startDate", filters.startDate);
      const effectiveEndDate = filters === transactionFilters ? transactionEffectiveEndDate : filters.endDate;
      if (effectiveEndDate) query.set("endDate", effectiveEndDate);
      if (filters.hideTrading212InterestCashbackAndDividends) query.set("hideTrading212InterestCashbackAndDividends", "true");
      if (filters.hideTransfers) query.set("hideTransfers", "true");
      filters.tagIds.forEach(tagId => query.append("tagId", tagId));
      if (filters.untagged) query.set("untagged", "true");
      if (showExcluded) query.set("cashFlowExcluded", "true");
      const summaryQuery = new URLSearchParams(query);
      if (!showExcluded) summaryQuery.set("cashFlowExcluded", "false");
      const [response, summaryResponse] = await Promise.all([
        fetch(`/api/transactions?${query}`),
        append ? Promise.resolve(null) : fetch(`/api/transactions/summary?${summaryQuery}`),
      ]);
      if (!response.ok) throw new Error("Unable to load transactions.");
      if (summaryResponse && !summaryResponse.ok) throw new Error("Unable to load transaction summary.");
      const page: Transaction[] = await response.json();
      setTransactions(current => append ? [...current, ...page] : page);
      if (summaryResponse) setTransactionSummary(await summaryResponse.json());
      setHasMoreTransactions(page.length === transactionPageSize);
      setError(null);
    } finally {
      setLoadingTransactions(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [importResponse] = await Promise.all([
          fetch("/api/imports/latest"),
          loadTransactions(),
          loadAccounts(),
          loadDataCoverage(),
          loadClassifications(),
          loadPayPalLinks(),
          loadCashFlowExclusionCount(),
          loadTags(),
        ]);
        if (!importResponse.ok) throw new Error("Unable to load the finance workspace.");
        setLatestImport(await importResponse.json());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load the finance workspace.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    void loadCashFlowSummary(dashboardQueryRange).catch(summaryError => {
      setError(summaryError instanceof Error ? summaryError.message : "Unable to load cash flow.");
    });
  }, [dashboardQueryRange]);

  useEffect(() => {
    void loadCashFlowTrend(dashboardQueryRange).catch(trendError => {
      setError(trendError instanceof Error ? trendError.message : "Unable to load cash-flow trend.");
    });
  }, [dashboardQueryRange, trendGranularity]);

  useEffect(() => {
    if (page !== "transactions") return;
    void loadTransactions().catch(transactionError => {
      setError(transactionError instanceof Error ? transactionError.message : "Unable to load transactions.");
    });
  }, [page, transactionFilter, transactionFilters, showingCashFlowExclusions, transactionCompleteDataOnly, transactionEffectiveEndDate]);

  const setCashFlowExcluded = async (transaction: Transaction, excluded: boolean) => {
    setSavingKey(`cash-flow-${transaction.id}`);
    setError(null);
    try {
      const response = await fetch("/api/transactions/cash-flow-exclusion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId: transaction.id, excluded }),
      });
      if (!response.ok) throw new Error("Unable to update cash-flow exclusion.");
      await Promise.all([
        loadTransactions(),
        loadCashFlowSummary(dashboardQueryRange),
        loadCashFlowTrend(dashboardQueryRange),
        loadCashFlowExclusionCount(),
      ]);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update cash-flow exclusion.");
    } finally {
      setSavingKey(null);
    }
  };

  const tagRequest = async (path: string, body: unknown, key: string) => {
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to update tags.");
      await Promise.all([loadTags(), loadTransactions()]);
      return responseBody;
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Unable to update tags.");
      throw tagError;
    } finally {
      setSavingKey(null);
    }
  };

  const createTag = async (name: string) => { await tagRequest("/api/tags", { name }, "create-tag"); };
  const renameTag = async (tagId: number, name: string) => { await tagRequest("/api/tags/rename", { tagId, name }, `rename-tag-${tagId}`); };
  const deleteTag = (tag: Tag) => { if (confirm(`Delete “${tag.name}” everywhere, including its rules and assignments?`)) void tagRequest("/api/tags/delete", { tagId: tag.id }, `delete-tag-${tag.id}`); };
  const setManualTag = (transactionId: number, tagId: number, assigned: boolean) => { void tagRequest("/api/transactions/tag", { transactionId, tagId, assigned }, `tag-${transactionId}-${tagId}`); };
  const createAndAssignTag = async (transactionId: number, name: string) => {
    const created = await tagRequest("/api/tags", { name }, "create-tag") as Tag;
    await tagRequest("/api/transactions/tag", { transactionId, tagId: created.id, assigned: true }, `tag-${transactionId}-${created.id}`);
  };
  const saveTagRule = (draft: TagRuleDraft) => {
    void tagRequest("/api/tag-rules", { ruleId: draft.ruleId, tagId: Number(draft.tagId), sourceId: Number(draft.sourceId), description: draft.matchMode === "all" ? "*" : draft.description, matchMode: draft.matchMode, direction: draft.direction }, "save-tag-rule").then(() => setTagRuleDraft(emptyTagRuleDraft));
  };
  const deleteTagRule = (rule: TagRule) => { if (confirm(`Delete the automatic “${rule.tagName}” rule?`)) void tagRequest("/api/tag-rules/delete", { ruleId: rule.id }, `delete-tag-rule-${rule.id}`); };
  const createRuleFromTransaction = (transaction: Transaction) => {
    setTagRuleDraft({ tagId: transaction.tags[0] ? String(transaction.tags[0].id) : "", sourceId: String(transaction.sourceId), description: transaction.description, matchMode: "exact", direction: transaction.amountMinor < 0 ? "outflow" : "inflow" });
    setPage("tags");
  };

  const saveRule = async (input: { sourceId: number; description: string; direction: EconomicDirection; matchMode: ClassificationMatchMode; economicType: EconomicType }, key: string) => {
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/classification/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to save classification rule.");
      await Promise.all([
        loadClassifications(),
        loadTransactions(),
      ]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save classification rule.");
    } finally {
      setSavingKey(null);
    }
  };

  const deleteRule = async (rule: ClassificationRule) => {
    const key = `delete-${rule.id}`;
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/classification/rules/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to delete classification rule.");
      await Promise.all([
        loadClassifications(),
        loadTransactions(),
      ]);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete classification rule.");
    } finally {
      setSavingKey(null);
    }
  };

  const updatePayPalLink = async (linkId: number, status: PayPalPaymentLink["status"]) => {
    const key = `paypal-link-${linkId}`;
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/reconciliation/paypal/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId, status }),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to update PayPal match.");
      await Promise.all([loadPayPalLinks(), loadTransactions(), loadCashFlowSummary(dashboardQueryRange), loadCashFlowTrend(dashboardQueryRange)]);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update PayPal match.");
    } finally {
      setSavingKey(null);
    }
  };

  const saveCoverageSettings = async (accountId: number, draft: { required: boolean; activeThrough: string; startDate: string; endDate: string }) => {
    setSavingCoverageAccountId(accountId);
    setError(null);
    try {
      const response = await fetch("/api/data-coverage/account-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          required: draft.required,
          activeThrough: draft.activeThrough || null,
          baselineStartDate: draft.startDate || null,
          baselineEndDate: draft.endDate || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to update data coverage.");
      setDataCoverage(body);
      await loadAccounts();
    } catch (coverageError) {
      setError(coverageError instanceof Error ? coverageError.message : "Unable to update data coverage.");
    } finally {
      setSavingCoverageAccountId(null);
    }
  };

  const setDashboardCoverageCap = (enabled: boolean) => {
    if (enabled && !dashboardCoverageInterval) {
      const suggestion = coverageStartSuggestion(dataCoverage, dateRange.startDate);
      setError(suggestion ? `Complete coverage does not include ${dateRange.startDate}. Choose ${suggestion} or a later covered start date.` : "Complete coverage is not established for all required accounts yet.");
      return;
    }
    setDashboardCompleteDataOnly(enabled);
    setError(null);
  };

  const setTransactionCoverageCap = (enabled: boolean) => {
    if (enabled && !transactionFilters.startDate) {
      setError("Choose a transaction start date before enabling Complete data only.");
      return;
    }
    if (enabled && !transactionCoverageInterval) {
      const suggestion = coverageStartSuggestion(dataCoverage, transactionFilters.startDate);
      setError(suggestion ? `Complete coverage does not include ${transactionFilters.startDate}. Choose ${suggestion} or a later covered start date.` : "Complete coverage is not established for all required accounts yet.");
      return;
    }
    setTransactionCompleteDataOnly(enabled);
    setError(null);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8">
        <header className="border-b border-neutral-800 pb-6">
          <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Transaction Manager</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bank import workspace</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Put completed parser JSON files into <code className="rounded bg-neutral-800 px-1.5 py-0.5">imports/incoming</code>.
          </p>
          <nav className="mt-5 flex flex-wrap gap-2" aria-label="Workspace pages">
            {(["dashboard", "classification", "reconciliation", "tags", "transactions"] as const).map(item => (
              <button
                key={item}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${page === item ? "bg-neutral-100 text-neutral-950" : "border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-900"}`}
                onClick={() => setPage(item)}
              >
                {titleCase(item)}
              </button>
            ))}
          </nav>
        </header>

        {error ? <p className="mt-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{error}</p> : null}

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Latest import</p>
          {loading ? <p className="mt-3 text-sm text-neutral-400">Loading import status…</p> : null}
          {!loading && !latestImport ? (
            <p className="mt-3 text-sm text-neutral-400">No files imported yet. Add a completed JSON file to the incoming folder.</p>
          ) : null}
          {!loading && latestImport ? (
            <div className="mt-3">
              <p className="font-medium text-neutral-100">{latestImport.fileName}</p>
              <p className="mt-1 text-sm text-neutral-400">
                {titleCase(latestImport.status)} · {latestImport.recordCount} record{latestImport.recordCount === 1 ? "" : "s"}
                {latestImport.duplicateRecordCount ? ` · ${latestImport.duplicateRecordCount} already seen` : ""}
                {latestImport.attemptCount > 1 ? ` · attempt ${latestImport.attemptCount}` : ""}
              </p>
              {latestImport.errorMessage ? <p className="mt-3 text-sm text-red-300">{latestImport.errorMessage}</p> : null}
            </div>
          ) : null}
        </section>

        {page === "dashboard" ? (
          <>
          <DataCoverageCard coverage={dataCoverage} savingAccountId={savingCoverageAccountId} onSave={(accountId, draft) => void saveCoverageSettings(accountId, draft)} />
          <section className="mt-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Cash flow</p>
                <h2 className="mt-2 text-xl font-semibold">Monthly overview</h2>
              </div>
              <label className="text-sm text-neutral-400">
                Range
                <select
                  className="ml-3 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-neutral-100"
                  value={datePreset}
                  onChange={event => {
                    const preset = event.target.value as typeof datePreset;
                    setDashboardCompleteDataOnly(false);
                    setDatePreset(preset);
                    if (preset !== "custom") setDateRange(presetDateRange(preset));
                  }}
                >
                  <option value="since_2024">Since 2024</option>
                  <option value="month">This month</option>
                  <option value="last_30_days">Last 30 days</option>
                  <option value="last_90_days">Last 90 days</option>
                  <option value="year_to_date">Year to date</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-neutral-400">
              <label>From <input className="ml-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-neutral-100" type="date" value={dateRange.startDate} onChange={event => { setDashboardCompleteDataOnly(false); setDatePreset("custom"); setDateRange(current => ({ ...current, startDate: event.target.value })); }} /></label>
              <label>To <input className="ml-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-neutral-100" type="date" value={dateRange.endDate} onChange={event => { setDatePreset("custom"); setDateRange(current => ({ ...current, endDate: event.target.value })); }} /></label>
              <label className="flex items-center gap-2 text-neutral-300"><Checkbox checked={dashboardCompleteDataOnly} onCheckedChange={checked => setDashboardCoverageCap(checked === true)} />Complete data only</label>
            </div>
            {dashboardCompleteDataOnly && dashboardCoverageInterval ? <p className="mt-2 text-xs text-emerald-300">Using verified data through {dashboardQueryRange.endDate}.</p> : null}
            {cashFlowSummary === null ? <p className="mt-5 text-sm text-neutral-400">Loading cash flow…</p> : null}
            {cashFlowSummary?.length === 0 ? <p className="mt-5 text-sm text-neutral-400">No transactions for this range.</p> : null}
            {cashFlowSummary?.map(summary => (
              <div key={summary.currencyCode} className="mt-5">
                <p className="text-sm font-medium text-neutral-300">{summary.currencyCode}</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"><p className="text-sm text-neutral-400">Income</p><p className="mt-2 text-2xl font-semibold text-emerald-300">{formatMoney(summary.incomeMinor, summary.currencyCode)}</p></div>
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"><p className="text-sm text-neutral-400">Expenses</p><p className="mt-2 text-2xl font-semibold text-red-300">{formatMoney(Math.abs(summary.expenseMinor), summary.currencyCode)}</p></div>
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"><p className="text-sm text-neutral-400">Net cash flow</p><p className={`mt-2 text-2xl font-semibold ${summary.netCashFlowMinor < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatMoney(summary.netCashFlowMinor, summary.currencyCode)}</p></div>
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"><p className="text-sm text-neutral-400">Unclassified</p><p className="mt-2 text-2xl font-semibold">{summary.unclassifiedTransactionCount}</p><button className="mt-2 text-sm text-neutral-400 hover:text-neutral-200" onClick={() => setPage("classification")}>Review classifications</button></div>
                </div>
                <p className="mt-4 text-sm text-neutral-500">Transfer activity: {formatMoney(summary.transferInflowMinor, summary.currencyCode)} in · {formatMoney(Math.abs(summary.transferOutflowMinor), summary.currencyCode)} out · {formatMoney(summary.transferInflowMinor + summary.transferOutflowMinor, summary.currencyCode)} net</p>
                {cashFlowExclusionCount > 0 ? <button className="mt-2 text-sm text-neutral-500 hover:text-neutral-300" onClick={() => { setShowingCashFlowExclusions(true); setPage("transactions"); }}>Excluding {cashFlowExclusionCount} marked transaction{cashFlowExclusionCount === 1 ? "" : "s"} from cash flow</button> : null}
                <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-800">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-4 py-3 font-medium">Source</th><th className="px-4 py-3 text-right font-medium">Income</th><th className="px-4 py-3 text-right font-medium">Expenses</th><th className="px-4 py-3 text-right font-medium">Net flow</th><th className="px-4 py-3 text-right font-medium">Transfer activity</th></tr></thead>
                    <tbody className="divide-y divide-neutral-800">
                      {summary.sources.map(source => (
                        <tr key={source.sourceName} className="bg-neutral-950/30">
                          <td className="px-4 py-3 text-neutral-100">{source.sourceName}</td>
                          <td className="px-4 py-3 text-right text-emerald-300">{formatMoney(source.incomeMinor, summary.currencyCode)}</td>
                          <td className="px-4 py-3 text-right text-red-300">{formatMoney(Math.abs(source.expenseMinor), summary.currencyCode)}</td>
                          <td className={`px-4 py-3 text-right ${source.netCashFlowMinor < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatMoney(source.netCashFlowMinor, summary.currencyCode)}</td>
                          <td className="px-4 py-3 text-right text-neutral-400">{formatMoney(source.transferInflowMinor, summary.currencyCode)} in · {formatMoney(Math.abs(source.transferOutflowMinor), summary.currencyCode)} out · {formatMoney(source.transferInflowMinor + source.transferOutflowMinor, summary.currencyCode)} net</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-neutral-600">Transfer activity includes internal account movements and is not reconciled across accounts.</p>
              </div>
            ))}

            <div className="mt-10 border-t border-neutral-800 pt-8">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Cash flow over time</p>
                  <h2 className="mt-2 text-xl font-semibold">Period-by-period view</h2>
                  <p className="mt-1 text-sm text-neutral-400">Income and expenses are shown separately; transfers remain outside net cash flow.</p>
                </div>
                <div className="flex rounded-lg border border-neutral-700 p-1 text-sm">
                  {(["month", "year"] as const).map(granularity => (
                    <button key={granularity} className={`rounded-md px-3 py-1.5 ${trendGranularity === granularity ? "bg-neutral-100 text-neutral-950" : "text-neutral-300 hover:bg-neutral-900"}`} onClick={() => setTrendGranularity(granularity)}>{granularity === "month" ? "Monthly" : "Yearly"}</button>
                  ))}
                </div>
              </div>
              {cashFlowTrend === null ? <p className="mt-5 text-sm text-neutral-400">Loading cash-flow trend…</p> : null}
              {cashFlowTrend?.map(trend => {
                const chartData = trend.periods.map(period => ({ ...period, expenseDisplayMinor: Math.abs(period.expenseMinor) }));
                const netLineColor = trend.periods.some(period => period.netCashFlowMinor < 0) ? "#fca5a5" : "#6ee7b7";
                return (
                  <div key={trend.currencyCode} className="mt-6">
                    <p className="text-sm font-medium text-neutral-300">{trend.currencyCode}</p>
                    <div className="mt-3 h-72 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                          <CartesianGrid stroke="#262626" vertical={false} />
                          <XAxis dataKey="label" tick={{ fill: "#a3a3a3", fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis tickFormatter={value => formatCompactMoney(Number(value), trend.currencyCode)} tick={{ fill: "#a3a3a3", fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                          <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: "0.5rem" }} labelStyle={{ color: "#f5f5f5" }} itemStyle={{ color: "#d4d4d4" }} formatter={(value, name) => [formatMoney(name === "Expenses" ? -Number(value) : Number(value), trend.currencyCode), name]} />
                          <Legend wrapperStyle={{ fontSize: "0.75rem", color: "#d4d4d4" }} />
                          <Bar dataKey="incomeMinor" name="Income" fill="#6ee7b7" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="expenseDisplayMinor" name="Expenses" fill="#fca5a5" radius={[4, 4, 0, 0]} />
                          <Line type="monotone" dataKey="netCashFlowMinor" name="Net cash flow" stroke={netLineColor} strokeWidth={2} dot={{ r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-800">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-4 py-3 font-medium">{trendGranularity === "month" ? "Month" : "Year"}</th><th className="px-4 py-3 text-right font-medium">Income</th><th className="px-4 py-3 text-right font-medium">Expenses</th><th className="px-4 py-3 text-right font-medium">Net cash flow</th></tr></thead>
                        <tbody className="divide-y divide-neutral-800">
                          {trend.periods.map(period => <tr key={period.period} className="bg-neutral-950/30"><td className="px-4 py-3 text-neutral-100">{period.label}</td><td className="px-4 py-3 text-right text-emerald-300">{formatMoney(period.incomeMinor, trend.currencyCode)}</td><td className="px-4 py-3 text-right text-red-300">{formatMoney(Math.abs(period.expenseMinor), trend.currencyCode)}</td><td className={`px-4 py-3 text-right ${period.netCashFlowMinor < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatMoney(period.netCashFlowMinor, trend.currencyCode)}</td></tr>)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          </>
        ) : null}

        {page === "classification" ? <ClassificationPage loading={loading} reviewGroups={reviewGroups} rules={rules} savingKey={savingKey} ruleDrafts={ruleDrafts} visibleCount={visibleReviewGroupCount} setRuleDrafts={setRuleDrafts} loadMore={() => setVisibleReviewGroupCount(current => current + classificationReviewPageSize)} saveRule={(input, key) => void saveRule(input, key)} deleteRule={rule => void deleteRule(rule)} /> : null}
        {/*
        <section className={page === "classification" ? "mt-8" : "hidden"}>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Classification review</p>
            <h2 className="mt-2 text-xl font-semibold">Recurring descriptions without a rule</h2>
            <p className="mt-2 text-sm text-neutral-400">
              {remainingClassificationCount} transaction{remainingClassificationCount === 1 ? "" : "s"} across {reviewGroups.length} description{reviewGroups.length === 1 ? "" : "s"} left to review.
            </p>
            <p className="mt-1 text-sm text-neutral-500">Approving a type applies it to every matching transaction from this provider and to future imports.</p>
          </div>

          {!loading && reviewGroups.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">Every imported description has a rule.</div>
          ) : null}

          <div className="mt-5 space-y-3">
            {reviewGroups.slice(0, visibleReviewGroupCount).map(group => {
              const key = `${group.sourceId}:${group.direction}:${group.description}`;
              const draft = ruleDrafts[key] ?? { description: group.description, matchMode: "exact" as const };
              return (
                <article key={key} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <h3 className="font-medium text-neutral-100">{group.description}</h3>
                      <p className="mt-1 text-sm text-neutral-400">
                        {group.sourceName} · {titleCase(group.direction)} · {group.transactionCount} transaction{group.transactionCount === 1 ? "" : "s"} · latest {group.latestTransactionDate}
                      </p>
                      <p className="mt-2 text-sm text-neutral-500">
                        {group.samples.map(sample => `${sample.transactionDate} ${formatMoney(sample.amountMinor, sample.currencyCode)}`).join(" · ")}
                      </p>
                    </div>
                    <div className="flex max-w-lg flex-wrap gap-2">
                      <input
                        className="min-w-48 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                        value={draft.description}
                        disabled={savingKey === key}
                        onChange={event => setRuleDrafts(current => ({ ...current, [key]: { ...draft, description: event.target.value } }))}
                        aria-label="Rule match text"
                      />
                      <select
                        className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        value={draft.matchMode}
                        disabled={savingKey === key}
                        onChange={event => setRuleDrafts(current => ({ ...current, [key]: { ...draft, matchMode: event.target.value as ClassificationMatchMode } }))}
                        aria-label="Rule match mode"
                      >
                        {matchModeOptions.map(matchMode => <option key={matchMode} value={matchMode}>{titleCase(matchMode)}</option>)}
                      </select>
                      {economicTypeOptionsForDirection(group.direction).map(economicType => (
                        <button
                          key={economicType}
                          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={savingKey === key}
                          onClick={() => void saveRule({ sourceId: group.sourceId, description: draft.description, direction: group.direction, matchMode: draft.matchMode, economicType }, key)}
                        >
                          {savingKey === key ? "Saving…" : titleCase(economicType)}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {reviewGroups.length > visibleReviewGroupCount ? (
            <button className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-900" onClick={() => setVisibleReviewGroupCount(current => current + classificationReviewPageSize)}>
              Load more classification groups
            </button>
          ) : null}
        </section>
        */}

        {/*
        <section className={page === "classification" ? "mt-8" : "hidden"}>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Classification rules</p>
            <h2 className="mt-2 text-xl font-semibold">Saved local decisions</h2>
          </div>
          {!loading && rules.length === 0 ? <p className="mt-5 text-sm text-neutral-400">No rules approved yet.</p> : null}
          {rules.length > 0 ? (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-neutral-800">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                  <tr><th className="px-4 py-3 font-medium">Provider</th><th className="px-4 py-3 font-medium">Match</th><th className="px-4 py-3 font-medium">Direction</th><th className="px-4 py-3 font-medium">Economic type</th><th className="px-4 py-3" /></tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {rules.map(rule => (
                    <tr key={rule.id} className="bg-neutral-950/30">
                      <td className="px-4 py-3 text-neutral-400">{rule.sourceName}</td>
                      <td className="px-4 py-3 text-neutral-100">{titleCase(rule.matchMode)}: {rule.normalizedDescription}</td>
                      <td className="px-4 py-3 text-neutral-400">{titleCase(rule.direction)}</td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                          value={rule.economicType}
                          disabled={savingKey === `rule-${rule.id}`}
                          onChange={event => void saveRule({ sourceId: rule.sourceId, description: rule.normalizedDescription, direction: rule.direction, matchMode: rule.matchMode, economicType: event.target.value as EconomicType }, `rule-${rule.id}`)}
                        >
                          {economicTypeOptionsForDirection(rule.direction).map(economicType => <option key={economicType} value={economicType}>{titleCase(economicType)}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right"><button className="text-sm text-red-300 hover:text-red-200 disabled:opacity-50" disabled={savingKey === `delete-${rule.id}`} onClick={() => void deleteRule(rule)}>{savingKey === `delete-${rule.id}` ? "Deleting…" : "Delete"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        */}

        {page === "reconciliation" ? <ReconciliationPage loading={loading} links={payPalLinks} savingKey={savingKey} updateLink={(linkId, status) => void updatePayPalLink(linkId, status)} /> : null}
        {page === "tags" ? <TagsPage tags={tags} rules={tagRules} accounts={accounts} loading={loading} savingKey={savingKey} ruleDraft={tagRuleDraft} setRuleDraft={setTagRuleDraft} createTag={createTag} renameTag={renameTag} deleteTag={deleteTag} saveRule={saveTagRule} deleteRule={deleteTagRule} /> : null}
        {/*
        <section className={page === "reconciliation" ? "mt-8" : "hidden"}>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Reconciliation</p>
            <h2 className="mt-2 text-xl font-semibold">PayPal payments funded by HSBC</h2>
            <p className="mt-2 text-sm text-neutral-400">Confirm a match to keep the named PayPal purchase as the only expense in cash-flow totals.</p>
          </div>
          {!loading && payPalLinks.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">No PayPal payment matches found.</div> : null}
          <div className="mt-5 space-y-3">
            {payPalLinks.map(link => {
              const key = `paypal-link-${link.id}`;
              const saving = savingKey === key;
              return (
                <article key={link.id} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">{titleCase(link.status)} match</p>
                      <p className="mt-2 text-sm text-neutral-400">HSBC {link.hsbcTransaction.transactionDate} · {formatMoney(link.hsbcTransaction.amountMinor, link.hsbcTransaction.currencyCode)} · {link.hsbcTransaction.description}</p>
                      <p className="mt-1 text-sm text-neutral-100">PayPal {link.paypalTransaction.transactionDate} · {formatMoney(link.paypalTransaction.amountMinor, link.paypalTransaction.currencyCode)} · {link.paypalTransaction.description}</p>
                      <p className="mt-2 text-xs text-neutral-500">{link.matchReason}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {link.status !== "confirmed" ? <button className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50" disabled={saving} onClick={() => void updatePayPalLink(link.id, "confirmed")}>{saving ? "Saving…" : "Confirm"}</button> : null}
                      {link.status !== "rejected" ? <button className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-950/50 disabled:opacity-50" disabled={saving} onClick={() => void updatePayPalLink(link.id, "rejected")}>Reject</button> : null}
                      {link.status !== "pending" ? <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50" disabled={saving} onClick={() => void updatePayPalLink(link.id, "pending")}>Reopen</button> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        */}

        <section className={page === "transactions" ? "mt-8" : "hidden"}>
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Transactions</p>
              <h2 className="mt-2 text-xl font-semibold">Newest first</h2>
            </div>
            {!loading ? <div className="flex items-center gap-3"><p className="text-sm text-neutral-500">{transactions.length}{hasMoreTransactions ? "+" : ""} loaded</p>{cashFlowExclusionCount > 0 ? <button className="text-sm text-neutral-400 hover:text-neutral-200" onClick={() => setShowingCashFlowExclusions(current => !current)}>{showingCashFlowExclusions ? "Show all" : `Exclusions (${cashFlowExclusionCount})`}</button> : null}</div> : null}
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-neutral-400">Economic type<select className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" value={transactionFilter} onChange={event => setTransactionFilter(event.target.value as "all" | EconomicType)}><option value="all">All economic types</option>{economicTypeOptions.map(economicType => <option key={economicType} value={economicType}>{titleCase(economicType)}</option>)}</select></label>
            <label className="text-xs text-neutral-400">Provider<select className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" value={transactionFilters.sourceId} onChange={event => setTransactionFilters(current => ({ ...current, sourceId: event.target.value, accountId: "" }))}><option value="">All providers</option>{sources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label className="text-xs text-neutral-400">Account<select className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" value={transactionFilters.accountId} onChange={event => setTransactionFilters(current => ({ ...current, accountId: event.target.value }))}><option value="">All accounts</option>{accounts.filter(account => !transactionFilters.sourceId || String(account.sourceId) === transactionFilters.sourceId).map(account => <option key={account.id} value={account.id}>{account.name} ({account.currencyCode})</option>)}</select></label>
            <label className="text-xs text-neutral-400">Currency<select className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" value={transactionFilters.currencyCode} onChange={event => setTransactionFilters(current => ({ ...current, currencyCode: event.target.value }))}><option value="">All currencies</option>{currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
            <label className="text-xs text-neutral-400">Transaction type<select className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" value={transactionFilters.transactionType} onChange={event => setTransactionFilters(current => ({ ...current, transactionType: event.target.value }))}><option value="">All types</option><option value="purchase">Purchase</option><option value="direct_debit">Direct debit</option><option value="transfer">Transfer</option><option value="funding">Funding</option><option value="withdrawal">Withdrawal</option><option value="card_payment">Card payment</option><option value="refund">Refund</option><option value="fee">Fee</option><option value="cashback">Cashback</option><option value="interest">Interest</option><option value="dividend">Dividend</option><option value="adjustment">Adjustment</option><option value="unclassified">Unclassified</option></select></label>
            <label className="text-xs text-neutral-400">Description contains<input className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" value={transactionFilters.description} onChange={event => setTransactionFilters(current => ({ ...current, description: event.target.value }))} placeholder="e.g. Spotify" /></label>
            <label className="text-xs text-neutral-400">Amount from<input className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" type="text" inputMode="decimal" value={transactionFilters.minAmount} onChange={event => { if (isAmountInput(event.target.value)) setTransactionFilters(current => ({ ...current, minAmount: event.target.value })); }} placeholder="e.g. -200.00" /></label>
            <label className="text-xs text-neutral-400">Amount to<input className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" type="text" inputMode="decimal" value={transactionFilters.maxAmount} onChange={event => { if (isAmountInput(event.target.value)) setTransactionFilters(current => ({ ...current, maxAmount: event.target.value })); }} placeholder="e.g. 200.00" /></label>
            <label className="text-xs text-neutral-400">From<DatePicker value={transactionFilters.startDate} onChange={value => { setTransactionCompleteDataOnly(false); setTransactionFilters(current => ({ ...current, startDate: value })); }} placeholder="Select start date" /></label>
            <label className="text-xs text-neutral-400">To<DatePicker value={transactionFilters.endDate} onChange={value => setTransactionFilters(current => ({ ...current, endDate: value }))} placeholder="Select end date" /></label>
            <fieldset className="text-xs text-neutral-400 sm:col-span-2"><legend>Tags · match any</legend><div className="mt-1 flex min-h-9 max-h-28 flex-wrap items-center gap-2 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5">{tags.map(tag => <label key={tag.id} className="flex items-center gap-1.5 text-sm text-neutral-300"><Checkbox checked={transactionFilters.tagIds.includes(String(tag.id))} onCheckedChange={checked => setTransactionFilters(current => ({ ...current, tagIds: checked === true ? [...current.tagIds, String(tag.id)] : current.tagIds.filter(tagId => tagId !== String(tag.id)) }))} />{tag.name}</label>)}<label className="flex items-center gap-1.5 text-sm text-neutral-300"><Checkbox checked={transactionFilters.untagged} onCheckedChange={checked => setTransactionFilters(current => ({ ...current, untagged: checked === true }))} />Untagged</label>{tags.length === 0 ? <span className="text-sm text-neutral-500">No tags created</span> : null}</div></fieldset>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-neutral-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                <label className="flex items-center gap-2 text-sm text-neutral-300"><Checkbox checked={transactionFilters.hideTrading212InterestCashbackAndDividends} onCheckedChange={checked => setTransactionFilters(current => ({ ...current, hideTrading212InterestCashbackAndDividends: checked === true }))} />Hide Trading 212 interest, cashback, and dividends</label>
                <label className="flex items-center gap-2 text-sm text-neutral-300"><Checkbox checked={transactionFilters.hideTransfers} onCheckedChange={checked => setTransactionFilters(current => ({ ...current, hideTransfers: checked === true }))} />Hide transfers</label>
                <label className="flex items-center gap-2 text-sm text-neutral-300"><Checkbox checked={transactionCompleteDataOnly} onCheckedChange={checked => setTransactionCoverageCap(checked === true)} />Complete data only</label>
              </div>
              <button className="w-fit rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800" onClick={() => { setTransactionCompleteDataOnly(false); setTransactionFilter("all"); setTransactionFilters(emptyTransactionFilters); }}>Clear filters</button>
            </div>
          </div>
          {transactionCompleteDataOnly && transactionCoverageInterval ? <p className="mt-2 text-xs text-emerald-300">Using verified data through {transactionEffectiveEndDate}.</p> : null}
          <p className="mt-2 text-xs text-neutral-500">Amount filters use signed values: negative for money out and positive for money in.</p>

          {transactionSummary.length > 0 ? <div className="mt-4 flex flex-wrap gap-3">{transactionSummary.map(summary => <div key={summary.currencyCode} className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm"><p className="text-xs uppercase tracking-wide text-neutral-500">{showingCashFlowExclusions ? "Excluded total" : "Filtered total"} · {summary.transactionCount} transactions · {summary.currencyCode}</p><p className="mt-1 text-neutral-200">Income <span className="font-medium text-emerald-300">{formatMoney(summary.incomeMinor, summary.currencyCode)}</span> · Expenses <span className="font-medium text-red-300">{formatMoney(Math.abs(summary.expenseMinor), summary.currencyCode)}</span> · Net cash flow <span className={summary.netCashFlowMinor < 0 ? "font-medium text-red-300" : "font-medium text-emerald-300"}>{formatMoney(summary.netCashFlowMinor, summary.currencyCode)}</span></p><p className="mt-1 text-xs text-neutral-500">Transfers: {formatMoney(summary.transferInflowMinor, summary.currencyCode)} in · {formatMoney(Math.abs(summary.transferOutflowMinor), summary.currencyCode)} out</p>{showingCashFlowExclusions ? <p className="mt-1 text-xs text-neutral-500">Not included in dashboard cash flow.</p> : null}</div>)}</div> : null}

          {!loading && transactions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 p-8 text-sm text-neutral-400">
              Imported transactions will appear here.
            </div>
          ) : null}

          {transactions.length > 0 ? (
            <div className="mt-5">
              <div className="overflow-x-auto rounded-2xl border border-neutral-800">
                <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Economic</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="w-10 px-2 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {transactions.map(transaction => (
                    <tr key={transaction.id} className="group bg-neutral-950/30">
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-400">{formatTransactionDate(transaction.transactionDate)}</td>
                      <td className="px-4 py-3 text-neutral-100"><p>{transaction.description}</p>{transaction.reconciliationLabel ? <p className="mt-1 text-xs text-amber-300">{transaction.reconciliationLabel}</p> : null}{transaction.isExcludedFromCashFlow ? <p className="mt-1 text-xs text-neutral-500">Excluded from cash flow</p> : null}<TagPicker transaction={transaction} tags={tags} savingKey={savingKey} setManualTag={setManualTag} createAndAssignTag={createAndAssignTag} createRule={createRuleFromTransaction} /></td>
                      <td className="px-4 py-3 text-neutral-400">{transaction.accountName}</td>
                      <td className="px-4 py-3 text-neutral-400">{titleCase(transaction.transactionType)}</td>
                      <td className="px-4 py-3 text-neutral-400">{titleCase(transaction.economicType)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${transaction.amountMinor < 0 ? "text-red-300" : "text-emerald-300"}`}>
                        {formatMoney(transaction.amountMinor, transaction.currencyCode)}
                      </td>
                      <td className="px-2 py-3 text-right"><button className="rounded px-2 py-1 text-xs text-neutral-500 opacity-0 transition hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40" disabled={savingKey === `cash-flow-${transaction.id}`} onClick={() => void setCashFlowExcluded(transaction, !transaction.isExcludedFromCashFlow)}>{transaction.isExcludedFromCashFlow ? "Include" : "Exclude"}</button></td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
              {hasMoreTransactions ? (
                <button
                  className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={loadingTransactions}
                  onClick={() => void loadTransactions(transactions.length, true)}
                >
                  {loadingTransactions ? "Loading…" : "Load more transactions"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default App;
