import { defaultUiPreferences, parseUiPreferences, type UiPreferences } from "./ui-preferences";

/** Explicit links must not inherit unrelated filters from the recipient's browser. */
export function readUrlState(search: string, saved: UiPreferences, now = new Date()): UiPreferences {
  const query = new URLSearchParams(search);
  if (!query.has("page")) return saved;
  const defaults = defaultUiPreferences(now);
  const page = query.get("page");
  const parsed = parseUiPreferences({
    page,
    dashboard: {
      datePreset: query.get("range") ?? defaults.dashboard.datePreset,
      dateRange: { startDate: query.get("from"), endDate: query.get("to") },
      completeDataOnly: query.get("complete") === "1",
      trendGranularity: query.get("period"),
    },
    transactions: {
      economicType: query.get("economic"),
      completeDataOnly: query.get("complete") === "1",
      showingCashFlowExclusions: query.get("excluded") === "1",
      filters: {
        sourceId: query.get("provider"), accountId: query.get("account"),
        currencyCode: query.get("currency"), transactionType: query.get("type"),
        description: query.get("q"), minAmount: query.get("min"), maxAmount: query.get("max"),
        startDate: query.get("from"), endDate: query.get("to"),
        hideTransfers: query.get("hideTransfers") === "1",
        hideTrading212InterestCashbackAndDividends: query.get("hideRewards") === "1",
        tagIds: query.getAll("tag"), untagged: query.get("untagged") === "1",
      },
    },
  }, now);
  return {
    page: parsed.page,
    dashboard: parsed.page === "dashboard" ? parsed.dashboard : saved.dashboard,
    transactions: parsed.page === "transactions" ? parsed.transactions : saved.transactions,
  };
}

export function writeUrlState(state: UiPreferences): string {
  const query = new URLSearchParams({ page: state.page });
  const put = (key: string, value: string | boolean) => {
    if (value) query.set(key, value === true ? "1" : value);
  };
  if (state.page === "dashboard") {
    put("range", state.dashboard.datePreset);
    if (state.dashboard.datePreset === "custom") {
      put("from", state.dashboard.dateRange.startDate);
      put("to", state.dashboard.dateRange.endDate);
    }
    put("complete", state.dashboard.completeDataOnly);
    if (state.dashboard.trendGranularity === "year") put("period", "year");
  } else if (state.page === "transactions") {
    const { filters, economicType, completeDataOnly, showingCashFlowExclusions } = state.transactions;
    put("from", filters.startDate); put("to", filters.endDate);
    put("currency", filters.currencyCode); put("q", filters.description);
    put("provider", filters.sourceId); put("account", filters.accountId);
    put("type", filters.transactionType);
    if (economicType !== "all") put("economic", economicType);
    put("min", filters.minAmount); put("max", filters.maxAmount);
    put("hideTransfers", filters.hideTransfers);
    put("hideRewards", filters.hideTrading212InterestCashbackAndDividends);
    for (const id of filters.tagIds) query.append("tag", id);
    put("untagged", filters.untagged);
    put("complete", completeDataOnly); put("excluded", showingCashFlowExclusions);
  }
  return `?${query}`;
}

/** Drill-down starts clean so previous searches cannot silently hide the month's activity. */
export function transactionsForPeriod(period: string, currencyCode: string): UiPreferences["transactions"] {
  const startDate = period.length === 4 ? `${period}-01-01` : `${period}-01`;
  const end = new Date(`${startDate}T00:00:00Z`);
  if (period.length === 4) end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const transactions = defaultUiPreferences().transactions;
  return { ...transactions, filters: { ...transactions.filters, startDate, endDate: end.toISOString().slice(0, 10), currencyCode } };
}
