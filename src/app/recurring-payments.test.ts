import { expect, test } from "bun:test";
import { recurringOverview, scheduledDate, previewRecurringChange, type RecurringPayment, type RecurringSnapshot } from "./recurring-payments";

const payment: RecurringPayment = { matchMode: "exact", id: 1, name: "TV licence", description: "TV LICENCE", accountId: 1, currencyCode: "GBP", amountMinor: 4400, frequency: "quarterly", anchorDate: "2026-01-31", status: "active", kind: "bill" };
function snapshot(dates: string[], payments: RecurringPayment[] = []): RecurringSnapshot {
  return { transactionDecisions: [], payments, methods: [], coverage: [], links: [], transactions: dates.map((transactionDate, index) => ({ id: index + 1, accountId: 1, currencyCode: "GBP", description: "TV LICENCE", amountMinor: -4400, transactionDate })) };
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
  expect(result.payments[0]).toMatchObject({ nextDate: "2026-10-31", priceChanged: true, monthlyEquivalentMinor: 1467 });
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
    { matchMode: "exact", anchorDate: null, frequency: null, amountMinor: null, paymentId: 1, accountId: 2, description: "TV LICENCE HSBC", effectiveDate: "2026-02-01" },
    { matchMode: "exact", anchorDate: null, frequency: null, amountMinor: null, paymentId: 1, accountId: 1, description: "TV LICENCE", effectiveDate: "2026-04-01" },
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
  input.methods = [{ matchMode: "exact", anchorDate: null, frequency: null, amountMinor: null, paymentId: 1, accountId: 2, description: "TV LICENCE HSBC", effectiveDate: "2026-06-01" }];
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

test("Hyperoptic description, billing date and price changes retain history and isolate irregular payments", () => {
  const base = { ...payment, name: "Hyperoptic", description: "HYPEROPTIC DD", frequency: "monthly" as const, anchorDate: "2026-03-02", amountMinor: 4600 };
  const input: RecurringSnapshot = { ...snapshot([], [base]), methods: [
    { paymentId: 1, accountId: 2, description: "Hyperoptic", matchMode: "starts_with", effectiveDate: "2026-03-27", anchorDate: "2026-04-16", frequency: null, amountMinor: 5000 },
    { paymentId: 1, accountId: 3, description: "Hyperoptic", matchMode: "starts_with", effectiveDate: "2026-07-01", anchorDate: null, frequency: null, amountMinor: null },
  ], transactions: [
    { id: 1, accountId: 1, currencyCode: "GBP", description: "HYPEROPTIC DD", transactionDate: "2026-03-02", amountMinor: -4600 },
    { id: 2, accountId: 2, currencyCode: "GBP", description: "Hyperoptic, www.Hyperopti", transactionDate: "2026-03-27", amountMinor: -4600 },
    { id: 3, accountId: 2, currencyCode: "GBP", description: "Hyperoptic, www.Hyperopti", transactionDate: "2026-04-17", amountMinor: -5000 },
    { id: 4, accountId: 2, currencyCode: "GBP", description: "Hyperoptic, www.Hyperopti", transactionDate: "2026-05-16", amountMinor: -5000 },
    { id: 5, accountId: 2, currencyCode: "GBP", description: "Hyperoptic, London", transactionDate: "2026-06-30", amountMinor: -5000 },
    { id: 6, accountId: 3, currencyCode: "GBP", description: "Hyperoptic", transactionDate: "2026-07-16", amountMinor: -5000 },
    { id: 7, accountId: 3, currencyCode: "GBP", description: "Hyperoptic", transactionDate: "2026-08-16", amountMinor: -5000 },
  ] };
  const before = { ...input, methods: [] };
  const preview = previewRecurringChange(before, input, 1);
  expect(preview.rows.find(t => t.id === 3).outcome).toBe("Included");
  expect(preview.rows.find(t => t.id === 5).outcome).toContain("Outside billing schedule");
  expect(recurringOverview(input).payments[0].transactions.map(t => t.id)).toEqual([1, 3, 4, 6, 7]);
  input.links = [{ paymentId: 1, transactionId: 2 }, { paymentId: 1, transactionId: 5 }];
  const result = recurringOverview(input, "2026-09-01").payments[0];
  expect(result.transactions).toHaveLength(7);
  expect(result.nextDate).toBe("2026-09-16");
  expect(result.currentMethod.amountMinor).toBe(5000);
  expect(result.priceChanged).toBe(false);
  expect(recurringOverview({ ...input, transactions: input.transactions.slice(0, 5) }, "2026-06-30").payments[0].nextDate).toBe("2026-06-16");
  input.transactions.push({ ...input.transactions[6], id: 8, accountId: 2 }, { ...input.transactions[6], id: 9, currencyCode: "USD" });
  expect(recurringOverview(input).payments[0].transactions).toHaveLength(7);
});

test("prefix collisions remain ambiguous in the preview and explicit links resolve ownership", () => {
  const input = snapshot(["2026-01-31"], [{ ...payment, matchMode: "starts_with", description: "TV" }, { ...payment, id: 2 }]);
  expect(previewRecurringChange(input, input, 1).rows[0].outcome).toContain("Ambiguous");
  input.links.push({ paymentId: 1, transactionId: 1 });
  expect(previewRecurringChange(input, input, 1).rows[0].outcome).toBe("Included");
  expect(recurringOverview(input).payments[1].transactions).toHaveLength(0);
});


test("Hetzner statement dates produce one monthly history, not twelve annual subscriptions", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const input = snapshot(Array.from({ length: 24 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-14`));
  input.transactions.forEach((t, i) => { t.description = `Hetzner Online GmbH Hetzner.Com/ DEU on 13 ${months[i % 12]}`; t.amountMinor = i < 12 ? -2324 : -1194; });
  const suggestions = recurringOverview(input).suggestions;
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0].frequency).toBe("monthly");
  expect(suggestions[0].transactions).toHaveLength(24);
});

test("Netcup international references and FX rates retain the monthly series", () => {
  const input = snapshot(["2026-01-27", "2026-02-27", "2026-03-27", "2026-04-27", "2026-05-27", "2026-06-29", "2026-07-27"]);
  input.transactions.forEach((t, i) => { t.description = i < 4 ? `INT'L ${1000000 + i} NETCUP KARLSRUHE EUR 8.28 @ 1.${1400 + i} Visa Rate` : i === 4 ? "NETCUP" : "NETCUP - KARLSRUHE"; t.amountMinor = -719 - i; });
  expect(recurringOverview(input).suggestions[0].transactions).toHaveLength(7);
  expect(recurringOverview(input).suggestions[0].frequency).toBe("monthly");
});

test("account switches retain full detection evidence", () => {
  const input = snapshot(["2026-01-04", "2026-02-04", "2026-03-04", "2026-04-04"]);
  input.transactions[2].accountId = 2;
  input.transactions[3].accountId = 2;
  expect(recurringOverview(input).suggestions[0].transactions).toHaveLength(4);
});


test("contains matches Netcup through changing FX descriptions without crossing account or currency", () => {
  const input = snapshot(["2026-01-27", "2026-02-27", "2026-03-27", "2026-04-27", "2026-05-27"]);
  input.transactions.forEach((t, i) => { t.description = i < 4 ? `INT'L ${1000 + i} NETCUP KARLSRUHE EUR 8.28 @ 1.14${i} Visa Rate` : "NETCUP"; });
  input.transactions.push({ ...input.transactions[0], id: 20, accountId: 2 }, { ...input.transactions[0], id: 21, currencyCode: "EUR" });
  const tracked: RecurringPayment = { ...payment, name: "Netcup", description: " netcup ", matchMode: "contains", frequency: "monthly", anchorDate: "2026-01-27" };
  const after = { ...input, payments: [tracked] };
  expect(recurringOverview(after).payments[0].transactions.map(t => t.id)).toEqual([1, 2, 3, 4, 5]);
  expect(previewRecurringChange(input, after, tracked.id).rows).toHaveLength(5);
  expect(recurringOverview({ ...after, payments: [{ ...tracked, matchMode: "starts_with" }] }).payments[0].transactions).toHaveLength(1);
  const switched = { ...input, payments: [{ ...tracked, matchMode: "exact" as const, description: "NETCUP" }], methods: [{ paymentId: tracked.id, accountId: 1, description: "NETCUP", matchMode: "contains" as const, effectiveDate: "2026-01-01", anchorDate: null, frequency: null, amountMinor: null }] };
  expect(recurringOverview(switched).payments[0].transactions).toHaveLength(5);
  after.transactions.push({ ...input.transactions[0], id: 22 });
  expect(recurringOverview(after).payments[0].needsReview).toBe(true);
  expect(recurringOverview(after).payments[0].transactions.map(t => t.id)).not.toContain(22);
});


test("six-month billing detects, matches and forecasts twice-yearly payments", () => {
  const input = snapshot(["2025-01-12", "2025-07-12", "2026-01-12"]);
  input.transactions.forEach(t => t.amountMinor = -155995);
  expect(recurringOverview(input).suggestions[0].frequency).toBe("semiannual");
  input.payments = [{ ...payment, frequency: "semiannual", anchorDate: "2025-01-12", amountMinor: 155995 }];
  const result = recurringOverview(input, "2026-01-13").payments[0];
  expect(result.transactions).toHaveLength(3);
  expect(result.nextDate).toBe("2026-07-12");
  expect(result.monthlyEquivalentMinor).toBe(25999);
  expect(scheduledDate("2024-08-31", "semiannual", 1)).toBe("2025-02-28");
  expect(scheduledDate("2024-08-31", "semiannual", 2)).toBe("2025-08-31");
});


test("attached service-charge extras preserve history without changing the commitment or next date", () => {
  const input = snapshot(["2026-01-12", "2026-01-27"], [{ ...payment, frequency: "semiannual", anchorDate: "2026-01-12", amountMinor: 166754 }]);
  input.transactions[0].amountMinor = -166754;
  input.transactions[1].amountMinor = -30711;
  input.links = [{ paymentId: 1, transactionId: 2 }];
  const result = recurringOverview(input, "2026-02-01").payments[0];
  expect(result.transactions.map(t => t.id)).toEqual([1, 2]);
  expect(result).toMatchObject({ monthlyEquivalentMinor: 27792, nextDate: "2026-07-12" });
});

test("temporary gym discounts and catch-up charges do not replace the expected monthly price", () => {
  const input = snapshot(["2026-05-20", "2026-06-22", "2026-07-20"], [{ ...payment, frequency: "monthly", anchorDate: "2026-05-20", amountMinor: 2899 }]);
  input.transactions.forEach((t, i) => t.amountMinor = [-2899, -699, -4146][i]);
  for (const count of [2, 3]) {
    const result = recurringOverview({ ...input, transactions: input.transactions.slice(0, count) }, "2026-07-21").payments[0];
    expect(result.monthlyEquivalentMinor).toBe(2899);
    expect(result.transactions).toHaveLength(count);
    expect(result.priceChanged).toBe(true);
  }
});

test("dated expected prices take effect without waiting for matching charges", () => {
  const input = snapshot(["2026-01-31", "2026-02-28"], [{ ...payment, frequency: "monthly" }]);
  input.methods = [{ paymentId: 1, accountId: 1, description: "TV LICENCE", matchMode: "exact", effectiveDate: "2026-02-01", anchorDate: null, frequency: null, amountMinor: 5000 }];
  expect(recurringOverview(input, "2026-01-31").payments[0].monthlyEquivalentMinor).toBe(4400);
  expect(recurringOverview(input, "2026-02-01").payments[0].monthlyEquivalentMinor).toBe(5000);
  expect(recurringOverview(input, "2026-03-01").payments[0].monthlyEquivalentMinor).toBe(5000);
});


test("dismissing one price warning preserves its scheduled payment and permits future warnings", () => {
  const input = snapshot(["2026-01-31", "2026-04-30"], [payment]);
  input.transactions[1].amountMinor = -5000;
  input.transactionDecisions = [{ paymentId: 1, transactionId: 2, oneOff: false, priceWarningDismissed: true }];
  expect(recurringOverview(input, "2026-05-01").payments[0]).toMatchObject({ priceChanged: false, nextDate: "2026-07-31", monthlyEquivalentMinor: 1467 });
  input.transactionDecisions[0].priceWarningDismissed = false;
  expect(recurringOverview(input).payments[0].priceChanged).toBe(true);
  input.transactionDecisions[0].priceWarningDismissed = true;
  input.transactions.push({ ...input.transactions[1], id: 3, transactionDate: "2026-07-31" });
  expect(recurringOverview(input).payments[0].priceChanged).toBe(true);
  input.transactionDecisions[0].transactionId = 3;
  input.transactionDecisions[0].paymentId = 999;
  expect(recurringOverview(input).payments[0].priceChanged).toBe(true);
});

test("one-off adjustments inside a billing window preserve real history without satisfying a scheduled bill", () => {
  const input = snapshot(["2026-01-31", "2026-04-30"], [payment]);
  input.transactions[1].amountMinor = -30000;
  input.links = [{ paymentId: 1, transactionId: 2 }];
  input.transactionDecisions = [{ paymentId: 1, transactionId: 2, oneOff: true, priceWarningDismissed: false }];
  input.coverage = [{ accountId: 1, startDate: "2026-04-01", endDate: "2026-05-31" }];
  const result = recurringOverview(input, "2026-05-10").payments[0];
  expect(result.transactions).toHaveLength(2);
  expect(result).toMatchObject({ priceChanged: false, nextDate: "2026-04-30", paymentMissing: true, monthlyEquivalentMinor: 1467 });
  input.transactions.push({ ...input.transactions[0], id: 3, transactionDate: "2026-04-30" });
  expect(recurringOverview(input, "2026-05-10").payments[0]).toMatchObject({ nextDate: "2026-07-31", needsReview: false, paymentMissing: false });
  expect(recurringOverview(input).payments[0].transactions).toHaveLength(3);
  input.transactions.pop();
  input.transactionDecisions[0].oneOff = false;
  expect(recurringOverview(input).payments[0]).toMatchObject({ priceChanged: true, nextDate: "2026-07-31" });
});
