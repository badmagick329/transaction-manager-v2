import { describe, expect, test } from "bun:test";
import { defaultUiPreferences, loadUiPreferences, saveUiPreferences, uiPreferencesStorageKey } from "./ui-preferences";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(uiPreferencesStorageKey, initial);
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

const now = new Date("2026-08-14T12:00:00Z");

describe("UI preferences", () => {
  test("falls back safely when browser storage is empty or invalid", () => {
    expect(loadUiPreferences(memoryStorage(), now)).toEqual(defaultUiPreferences(now));
    expect(loadUiPreferences(memoryStorage("not json"), now)).toEqual(defaultUiPreferences(now));
  });

  test("restores dashboard and every transaction selection", () => {
    const storage = memoryStorage(JSON.stringify({
      page: "transactions",
      dashboard: {
        datePreset: "custom",
        dateRange: { startDate: "2025-01-01", endDate: "2026-01-30" },
        completeDataOnly: true,
        trendGranularity: "year",
      },
      transactions: {
        economicType: "expense",
        completeDataOnly: true,
        showingCashFlowExclusions: true,
        filters: {
          sourceId: "2",
          accountId: "3",
          currencyCode: "GBP",
          transactionType: "purchase",
          description: "coffee",
          minAmount: "-50",
          maxAmount: "0",
          startDate: "2025-01-01",
          endDate: "2026-01-30",
          hideTrading212InterestCashbackAndDividends: true,
          hideTransfers: true,
          tagIds: ["4", "5"],
          untagged: true,
        },
      },
    }));

    expect(loadUiPreferences(storage, now)).toMatchObject({
      page: "transactions",
      dashboard: { datePreset: "custom", completeDataOnly: true, trendGranularity: "year" },
      transactions: {
        economicType: "expense",
        completeDataOnly: true,
        showingCashFlowExclusions: true,
        filters: { sourceId: "2", accountId: "3", tagIds: ["4", "5"], untagged: true },
      },
    });
  });

  test("refreshes relative dashboard presets for the current day", () => {
    const storage = memoryStorage(JSON.stringify({ dashboard: { datePreset: "last_30_days", dateRange: { startDate: "2020-01-01", endDate: "2020-01-30" } } }));
    expect(loadUiPreferences(storage, now).dashboard.dateRange).toEqual({ startDate: "2026-07-16", endDate: "2026-08-14" });
  });

  test("writes preferences under the versioned storage key", () => {
    const storage = memoryStorage();
    const preferences = defaultUiPreferences(now);
    saveUiPreferences(storage, preferences);
    expect(loadUiPreferences(storage, now)).toEqual(preferences);
  });
});
