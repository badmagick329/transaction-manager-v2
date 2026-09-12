import { annualCost, monthlyCost, cycleFor, recurringMethodAt, scheduledDate, type recurringOverview } from "./recurring-payments";

export type RecurringOverview = ReturnType<typeof recurringOverview>;
export type DashboardPayment = RecurringOverview["payments"][number];
/** Scenarios express a replacement bill, so annual and weekly savings use the same cadence as the commitment. */
export function recurringBudget(payments: DashboardPayment[], currency: string, replacements: Record<number, number> = {}) {
  const rows = payments.filter(p => p.status === "active" && p.currencyCode === currency)
    .sort((a, b) => b.monthlyEquivalentMinor - a.monthlyEquivalentMinor || a.name.localeCompare(b.name));
  const monthly = rows.reduce((sum, p) => sum + p.monthlyEquivalentMinor, 0);
  const annual = rows.reduce((sum, p) => sum + annualCost(p.currentMethod.amountMinor, p.currentMethod.frequency), 0);
  const byControl = { fixed: 0, reducible: 0, cancellable: 0, unclassified: 0 };
  let scenarioMonthly = 0, scenarioAnnual = 0;
  for (const p of rows) {
    byControl[p.control] += p.monthlyEquivalentMinor;
    const replacement = p.control === "fixed" ? p.currentMethod.amountMinor : replacements[p.id] ?? p.currentMethod.amountMinor;
    scenarioMonthly += monthlyCost(replacement, p.currentMethod.frequency);
    scenarioAnnual += annualCost(replacement, p.currentMethod.frequency);
  }
  return { rows, monthly, annual, byControl, scenarioMonthly, monthlySaving: monthly - scenarioMonthly, annualSaving: annual - scenarioAnnual };
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function monthRange(month: string) {
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) };
}
export type BillingEvent = {
  paymentId: number; name: string; date: string; amountMinor: number; currencyCode: string;
  status: "expected" | "recorded" | "unconfirmed" | "missing";
  actualMinor: number | null;
};

/** Project each dated schedule independently of stale next-payment notices; unknown past charges are never assumed paid. */
export function recurringCalendar(data: RecurringOverview, start: string, end: string, today: string, currency: string): BillingEvent[] {
  const events: BillingEvent[] = [];
  for (const p of data.payments.filter(p => p.status === "active" && p.currencyCode === currency)) {
    for (let date = start; date <= end; date = shiftDate(date, 1)) {
      const method = recurringMethodAt(p, p.methods, date);
      if (date < method.anchorDate || scheduledDate(method.anchorDate, method.frequency, cycleFor(method.anchorDate, method.frequency, date)) !== date) continue;
      const matching = p.transactions.filter(t => {
        if (p.transactionDecisions.some(d => d.transactionId === t.id && d.oneOff)) return false;
        const atCharge = recurringMethodAt(p, p.methods, t.transactionDate);
        const tolerance = atCharge.frequency === "weekly" ? 1 : 4;
        return atCharge.anchorDate === method.anchorDate && atCharge.frequency === method.frequency
          && scheduledDate(atCharge.anchorDate, atCharge.frequency, cycleFor(atCharge.anchorDate, atCharge.frequency, t.transactionDate)) === date
          && t.transactionDate.slice(0, 10) >= shiftDate(date, -tolerance) && t.transactionDate.slice(0, 10) <= shiftDate(date, tolerance);
      });
      let covered = true;
      for (let day = shiftDate(date, -4); day <= shiftDate(date, 4); day = shiftDate(day, 1)) {
        const accountId = recurringMethodAt(p, p.methods, day).accountId;
        if (!data.coverage.some(c => c.accountId === accountId && c.startDate <= day && c.endDate >= day)) covered = false;
      }
      const status = matching.length ? "recorded" : date >= today ? "expected" : covered && shiftDate(date, 4) < today ? "missing" : "unconfirmed";
      events.push({ paymentId: p.id, name: p.name, date, currencyCode: currency, amountMinor: method.amountMinor, status,
        actualMinor: matching.length ? matching.reduce((sum, t) => sum + Math.abs(t.amountMinor), 0) : null });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
