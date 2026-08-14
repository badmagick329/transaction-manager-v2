import type { EconomicType, TransactionFilters } from "./types";

export type WorkspacePage = "dashboard" | "classification" | "reconciliation" | "tags" | "transactions";
export type DashboardDatePreset = "since_2024" | "month" | "last_30_days" | "last_90_days" | "year_to_date" | "custom";
export type TrendGranularity = "month" | "year";

export type UiPreferences = {
  page: WorkspacePage;
  dashboard: {
    datePreset: DashboardDatePreset;
    dateRange: { startDate: string; endDate: string };
    completeDataOnly: boolean;
    trendGranularity: TrendGranularity;
  };
  transactions: {
    economicType: "all" | EconomicType;
    filters: TransactionFilters;
    completeDataOnly: boolean;
    showingCashFlowExclusions: boolean;
  };
};

type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const uiPreferencesStorageKey = "transaction-manager.ui-preferences.v1";
export const emptyTransactionFilters: TransactionFilters = {
  sourceId: "",
  accountId: "",
  currencyCode: "",
  transactionType: "",
  description: "",
  minAmount: "",
  maxAmount: "",
  startDate: "",
  endDate: "",
  hideTrading212InterestCashbackAndDividends: false,
  hideTransfers: false,
  tagIds: [],
  untagged: false,
};

const pages: WorkspacePage[] = ["dashboard", "classification", "reconciliation", "tags", "transactions"];
const datePresets: DashboardDatePreset[] = ["since_2024", "month", "last_30_days", "last_90_days", "year_to_date", "custom"];
const economicTypes: Array<"all" | EconomicType> = ["all", "expense", "income", "transfer", "unclassified"];
const transactionTypes = ["purchase", "direct_debit", "transfer", "funding", "withdrawal", "card_payment", "refund", "fee", "cashback", "interest", "dividend", "adjustment", "unclassified"];

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function presetDateRange(preset: Exclude<DashboardDatePreset, "custom">, now = new Date()) {
  if (preset === "since_2024") return { startDate: "2024-01-01", endDate: toDateInput(now) };
  if (preset === "month") {
    return {
      startDate: toDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      endDate: toDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
    };
  }
  const end = new Date(now);
  const start = new Date(now);
  if (preset === "year_to_date") start.setUTCMonth(0, 1);
  else start.setUTCDate(start.getUTCDate() - (preset === "last_30_days" ? 29 : 89));
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

export function defaultUiPreferences(now = new Date()): UiPreferences {
  return {
    page: "dashboard",
    dashboard: {
      datePreset: "since_2024",
      dateRange: presetDateRange("since_2024", now),
      completeDataOnly: false,
      trendGranularity: "month",
    },
    transactions: {
      economicType: "all",
      filters: { ...emptyTransactionFilters, tagIds: [] },
      completeDataOnly: false,
      showingCashFlowExclusions: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function loadUiPreferences(storage: PreferenceStorage | null, now = new Date()): UiPreferences {
  const defaults = defaultUiPreferences(now);
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(uiPreferencesStorageKey);
    if (!raw) return defaults;
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored)) return defaults;
    const dashboard = isRecord(stored.dashboard) ? stored.dashboard : {};
    const transactions = isRecord(stored.transactions) ? stored.transactions : {};
    const filters = isRecord(transactions.filters) ? transactions.filters : {};
    let datePreset = datePresets.includes(dashboard.datePreset as DashboardDatePreset)
      ? dashboard.datePreset as DashboardDatePreset
      : defaults.dashboard.datePreset;
    const storedRange = isRecord(dashboard.dateRange) ? dashboard.dateRange : {};
    const hasValidCustomRange = validDate(storedRange.startDate)
      && validDate(storedRange.endDate)
      && String(storedRange.startDate) <= String(storedRange.endDate);
    if (datePreset === "custom" && !hasValidCustomRange) datePreset = defaults.dashboard.datePreset;
    const dateRange = datePreset === "custom"
      ? { startDate: String(storedRange.startDate), endDate: String(storedRange.endDate) }
      : presetDateRange(datePreset, now);
    const economicType = economicTypes.includes(transactions.economicType as "all" | EconomicType)
      ? transactions.economicType as "all" | EconomicType
      : defaults.transactions.economicType;

    return {
      page: pages.includes(stored.page as WorkspacePage) ? stored.page as WorkspacePage : defaults.page,
      dashboard: {
        datePreset,
        dateRange,
        completeDataOnly: booleanValue(dashboard.completeDataOnly),
        trendGranularity: dashboard.trendGranularity === "year" ? "year" : "month",
      },
      transactions: {
        economicType,
        completeDataOnly: booleanValue(transactions.completeDataOnly),
        showingCashFlowExclusions: booleanValue(transactions.showingCashFlowExclusions),
        filters: {
          sourceId: /^\d+$/.test(stringValue(filters.sourceId)) ? String(filters.sourceId) : "",
          accountId: /^\d+$/.test(stringValue(filters.accountId)) ? String(filters.accountId) : "",
          currencyCode: stringValue(filters.currencyCode),
          transactionType: transactionTypes.includes(stringValue(filters.transactionType)) ? String(filters.transactionType) : "",
          description: stringValue(filters.description),
          minAmount: /^-?\d*(?:\.\d{0,2})?$/.test(stringValue(filters.minAmount)) ? String(filters.minAmount) : "",
          maxAmount: /^-?\d*(?:\.\d{0,2})?$/.test(stringValue(filters.maxAmount)) ? String(filters.maxAmount) : "",
          startDate: validDate(filters.startDate) ? String(filters.startDate) : "",
          endDate: validDate(filters.endDate) ? String(filters.endDate) : "",
          hideTrading212InterestCashbackAndDividends: booleanValue(filters.hideTrading212InterestCashbackAndDividends),
          hideTransfers: booleanValue(filters.hideTransfers),
          tagIds: Array.isArray(filters.tagIds) ? filters.tagIds.filter((value): value is string => typeof value === "string" && /^\d+$/.test(value)) : [],
          untagged: booleanValue(filters.untagged),
        },
      },
    };
  } catch {
    return defaults;
  }
}

export function saveUiPreferences(storage: PreferenceStorage | null, preferences: UiPreferences) {
  if (!storage) return;
  try {
    storage.setItem(uiPreferencesStorageKey, JSON.stringify(preferences));
  } catch {
    // Preferences are optional when browser storage is unavailable.
  }
}

export function browserPreferenceStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
