import { expect, test } from "bun:test";
import { recurringOverview, scheduledDate, type RecurringPayment, type RecurringSnapshot } from "./recurring-payments";

const payment: RecurringPayment = { id: 1, name: "TV licence", description: "TV LICENCE", accountId: 1, currencyCode: "GBP", amountMinor: 4400, frequency: "quarterly", anchorDate: "2026-01-31", status: "active", kind: "bill" };
function snapshot(dates: string[], payments: RecurringPayment[] = []): RecurringSnapshot {
  return { payments, methods: [], coverage: [], links: [], transactions: dates.map((transactionDate, index) => ({ id: index + 1, accountId: 1, currencyCode: "GBP", description: "TV LICENCE", amountMinor: -4400, transactionDate })) };
}
test("quarterly detection uses calendar months and month-end billing", () => {
  const result = recurringOverview(snapshot(["2026-01-31", "2026-04-30", "2026-07-31"]));
  expect(result.suggestions[0].frequency).toBe("quarterly");
  expect(scheduledDate("2026-01-31", "monthly", 2)).toBe("2026-03-31");
  expect(scheduledDate("2024-02-29", "annual", 1)).toBe("2025-02-28");
});
test("allows processing movement and annual detection with two payments", () => {
  expect(recurringOverview(snapshot(["2026-01-31", "2026-03-02", "2026-04-02"])).suggestions[0].frequency).toBe("monthly");
  expect(recurringOverview(snapshot(["2026-01-05", "2026-02-07", "2026-03-05"])).suggestions[0].frequency).toBe("monthly");
  expect(recurringOverview(snapshot(["2025-02-01", "2026-02-02"])).suggestions[0].frequency).toBe("annual");
  expect(recurringOverview(snapshot(["2026-01-05", "2026-02-05"])).suggestions).toHaveLength(0);
});
test("irregular shopping and mixed accounts or currencies do not form a series", () => {
  expect(recurringOverview(snapshot(["2026-01-05", "2026-01-07", "2026-02-05", "2026-03-05"])).suggestions).toHaveLength(0);
  const input = snapshot(["2026-01-05", "2026-02-05", "2026-03-05"]);
  input.transactions[1].currencyCode = "USD";
  input.transactions[2].accountId = 2;
  expect(recurringOverview(input).suggestions).toHaveLength(0);
});
test("manual entries match future payments, retain price changes, and suppress suggestions", () => {
  const input = snapshot(["2026-01-31", "2026-04-30", "2026-07-31"], [payment]);
  input.transactions[2].amountMinor = -4600;
  const result = recurringOverview(input);
  expect(result.suggestions).toHaveLength(0);
  expect(result.payments[0]).toMatchObject({ nextDate: "2026-10-31", priceChanged: true, monthlyEquivalentMinor: 1533 });
  expect(result.payments[0].transactions).toHaveLength(3);
  input.payments = [{ ...payment, status: "dismissed" }];
  expect(recurringOverview(input).suggestions).toHaveLength(0);
});
test("missing payments require full coverage of the billing window", () => {
  const input = snapshot(["2026-01-31"], [payment]);
  expect(recurringOverview(input, "2026-06-01").payments[0]).toMatchObject({ paymentMissing: false, coverageUnknown: true });
  input.coverage = [{ accountId: 1, startDate: "2026-04-01", endDate: "2026-05-31" }];
  expect(recurringOverview(input, "2026-06-01").payments[0].paymentMissing).toBe(true);
  input.coverage = [{ accountId: 2, startDate: "2026-04-01", endDate: "2026-05-31" }];
  expect(recurringOverview(input, "2026-06-01").payments[0].paymentMissing).toBe(false);
});
test("ambiguous cycles and competing schedules stay unlinked until explicitly linked", () => {
  const input = snapshot(["2026-01-31", "2026-01-31"], [payment]);
  expect(recurringOverview(input).payments[0].transactions).toHaveLength(0);
  expect(recurringOverview(input).payments[0].needsReview).toBe(true);
  input.payments.push({ ...payment, id: 2 });
  input.links.push({ transactionId: 1, paymentId: 1 });
  expect(recurringOverview(input).payments[0].transactions.map(t => t.id)).toEqual([1]);
  expect(recurringOverview(input).payments[1].transactions).toHaveLength(0);
});
test("paused payments do not forecast or flag missed charges", () => {
  const input = snapshot([], [{ ...payment, status: "paused" }]);
  expect(recurringOverview(input).payments[0]).toMatchObject({ nextDate: null, paymentMissing: false, coverageUnknown: false });
});

test("provider switches preserve history, match new charges, and allow switching back", () => {
  const monthly = { ...payment, frequency: "monthly" as const, anchorDate: "2026-01-09" };
  const input = snapshot(["2026-01-09", "2026-02-09", "2026-03-09", "2026-04-09"], [monthly]);
  input.methods = [
    { paymentId: 1, accountId: 2, description: "TV LICENCE HSBC", effectiveDate: "2026-02-01" },
    { paymentId: 1, accountId: 1, description: "TV LICENCE", effectiveDate: "2026-04-01" },
  ];
  for (const t of input.transactions.slice(1, 3)) { t.accountId = 2; t.description = "TV LICENCE HSBC"; }
  const result = recurringOverview(input, "2026-03-20");
  expect(result.payments[0].transactions).toHaveLength(4);
  expect(result.payments[0].currentMethod.accountId).toBe(2);
  expect(result.payments[0].nextDate).toBe("2026-05-09");
  expect(result.suggestions).toHaveLength(0);
  expect(recurringOverview(input, "2026-04-20").payments[0].currentMethod.accountId).toBe(1);
  input.transactions.push({ ...input.transactions[1], id: 99, accountId: 1, description: "TV LICENCE" });
  expect(recurringOverview(input).payments[0].transactions.map(t => t.id)).not.toContain(99);
});

test("coverage follows the account effective at the missing billing date, not today's account", () => {
  const input = snapshot(["2026-01-31"], [payment]);
  input.methods = [{ paymentId: 1, accountId: 2, description: "TV LICENCE HSBC", effectiveDate: "2026-06-01" }];
  input.coverage = [{ accountId: 2, startDate: "2026-01-01", endDate: "2026-12-31" }];
  expect(recurringOverview(input, "2026-07-01").payments[0].paymentMissing).toBe(false);
  input.coverage.push({ accountId: 1, startDate: "2026-04-01", endDate: "2026-05-31" });
  expect(recurringOverview(input, "2026-07-01").payments[0].paymentMissing).toBe(true);
  input.methods[0].effectiveDate = "2026-04-30";
  input.coverage = [{ accountId: 1, startDate: "2026-04-26", endDate: "2026-04-29" }, { accountId: 2, startDate: "2026-04-30", endDate: "2026-05-04" }];
  expect(recurringOverview(input, "2026-07-01").payments[0].paymentMissing).toBe(true);
  input.coverage[1].startDate = "2026-05-01";
  expect(recurringOverview(input, "2026-07-01").payments[0].paymentMissing).toBe(false);
});
