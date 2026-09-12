import { expect, test } from "bun:test";
import { recurringOverview, type RecurringPayment, type RecurringSnapshot } from "./recurring-payments";
import { recurringBudget, recurringCalendar } from "./recurring-dashboard";

const base: RecurringPayment = { id: 1, name: "Service charge", kind: "bill", accountId: 1, currencyCode: "GBP", description: "SERVICE", matchMode: "exact", amountMinor: 166754, frequency: "semiannual", anchorDate: "2026-01-31", status: "active" };
function snapshot(payments: RecurringPayment[] = [base]): RecurringSnapshot {
  return { payments, methods: [], transactions: [], coverage: [], links: [], transactionDecisions: [], spendingControls: [] };
}

test("budget uses expected costs, separates currencies and excludes inactive payments", () => {
  const s = snapshot([base, { ...base, id: 2, currencyCode: "USD" }, { ...base, id: 3, status: "paused" }, { ...base, id: 4, name: "Annual", amountMinor: 1744, frequency: "annual" }]);
  s.transactions.push({ id: 1, accountId: 1, currencyCode: "GBP", description: "SERVICE", transactionDate: "2026-01-31", amountMinor: -193446 });
  const data = recurringOverview(s, "2026-02-01");
  const result = recurringBudget(data.payments, "GBP");
  expect(result.rows.map(p => p.id)).toEqual([1, 4]);
  expect(result.monthly).toBe(27792 + 145);
  expect(result.annual).toBe(166754 * 2 + 1744);
  expect(result.byControl).toEqual({ fixed: 0, reducible: 0, cancellable: 0, unclassified: result.monthly });
  expect(recurringBudget(data.payments, "EUR").monthly).toBe(0);
});

test("savings scenarios honor fixed commitments and annualize each replacement bill exactly", () => {
  const s = snapshot([base, { ...base, id: 2, name: "Gym", amountMinor: 2899, frequency: "monthly" }, { ...base, id: 3, name: "Annual", amountMinor: 1744, frequency: "annual" }, { ...base, id: 4, currencyCode: "USD" }]);
  s.spendingControls = [{ paymentId: 1, control: "fixed" }, { paymentId: 2, control: "reducible" }, { paymentId: 3, control: "cancellable" }];
  const data = recurringOverview(s, "2026-02-01");
  const result = recurringBudget(data.payments, "GBP", { 1: 0, 2: 1999, 3: 0, 4: 0 });
  expect(result.monthlySaving).toBe(900 + 145);
  expect(result.annualSaving).toBe(900 * 12 + 1744);
  expect(result.scenarioMonthly).toBe(27792 + 1999);
  expect(data.payments[1].currentMethod.amountMinor).toBe(2899);
});

test("calendar projects past stale next dates without assuming payment and respects future billing changes", () => {
  const s = snapshot([{ ...base, amountMinor: 2000, frequency: "monthly" }]);
  s.methods = [{ paymentId: 1, accountId: 1, description: "SERVICE", matchMode: "exact", effectiveDate: "2026-04-01", amountMinor: 8000, anchorDate: "2026-04-15", frequency: null }];
  const data = recurringOverview(s, "2026-03-10");
  expect(data.payments[0].nextDate).toBe("2026-01-31");
  const events = recurringCalendar(data, "2026-02-01", "2026-05-31", "2026-03-10", "GBP");
  expect(events.map(e => [e.date, e.amountMinor, e.status])).toEqual([
    ["2026-02-28", 2000, "unconfirmed"], ["2026-03-31", 2000, "expected"], ["2026-04-15", 8000, "expected"], ["2026-05-15", 8000, "expected"],
  ]);
});

test("calendar distinguishes recorded bills, missing covered bills and one-off extras", () => {
  const s = snapshot([{ ...base, amountMinor: 2899, frequency: "monthly", anchorDate: "2026-01-20" }]);
  s.transactions = [
    { id: 1, accountId: 1, currencyCode: "GBP", description: "SERVICE", amountMinor: -699, transactionDate: "2026-01-22" },
    { id: 2, accountId: 1, currencyCode: "GBP", description: "SERVICE", amountMinor: -30000, transactionDate: "2026-02-20" },
  ];
  s.links = [{ paymentId: 1, transactionId: 2 }];
  s.transactionDecisions = [{ paymentId: 1, transactionId: 2, oneOff: true, priceWarningDismissed: false }];
  s.coverage = [{ accountId: 1, startDate: "2026-01-01", endDate: "2026-02-28" }];
  const events = recurringCalendar(recurringOverview(s, "2026-03-01"), "2026-01-01", "2026-02-28", "2026-03-01", "GBP");
  expect(events).toMatchObject([{ status: "recorded", actualMinor: 699, amountMinor: 2899 }, { status: "missing", actualMinor: null }]);
});

test("weekly and six-monthly forecasts use full bills on calendar dates and skip paused records", () => {
  const s = snapshot([base, { ...base, id: 2, amountMinor: 1000, frequency: "weekly", anchorDate: "2026-01-01", description: "WEEKLY" }, { ...base, id: 3, status: "paused" }]);
  const data = recurringOverview(s, "2026-01-01");
  const events = recurringCalendar(data, "2026-01-01", "2026-01-31", "2026-01-01", "GBP");
  expect(events.filter(e => e.paymentId === 2)).toHaveLength(5);
  expect(events.find(e => e.paymentId === 1)?.amountMinor).toBe(166754);
  expect(events.some(e => e.paymentId === 3)).toBe(false);
  expect(recurringBudget(data.payments, "GBP").monthly).toBe(27792 + 4333);
});
