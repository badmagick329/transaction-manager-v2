export const frequencies = ["weekly", "monthly", "quarterly", "annual"] as const;
export type Frequency = typeof frequencies[number];
export type RecurringPaymentInput = {
  name: string; kind: "subscription" | "bill" | "instalment";
  accountId: number; currencyCode: string; description: string;
  amountMinor: number; frequency: Frequency; anchorDate: string;
  status: "active" | "paused" | "cancelled" | "dismissed";
};
export type RecurringPayment = RecurringPaymentInput & { id: number };
export type PaymentMethodChange = { paymentId: number; accountId: number; description: string; effectiveDate: string; previousEffectiveDate?: string };
export type RecurringTransaction = { id: number; accountId: number; currencyCode: string; description: string; amountMinor: number; transactionDate: string };
export type RecurringSnapshot = { payments: RecurringPayment[]; methods: PaymentMethodChange[]; transactions: RecurringTransaction[]; coverage: Array<{ accountId: number; startDate: string; endDate: string }>; links: Array<{ transactionId: number; paymentId: number }> };
export interface RecurringPaymentRepository {
  snapshot(): Promise<RecurringSnapshot>;
  save(input: RecurringPaymentInput, id?: number): Promise<RecurringPayment>;
  link(transactionId: number, paymentId: number): Promise<void>;
  changeMethod(input: PaymentMethodChange): Promise<void>;
}

// Preserve distinguishing merchant text: broad reference stripping can merge unrelated purchases.
export function recurringDescription(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase(); }
const day = 86400000;
const dateValue = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime();
// Calculate from the original anchor so February and processing delays cannot drift later bills.
export function scheduledDate(anchor: string, frequency: Frequency, cycle: number) {
  const date = new Date(dateValue(anchor));
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + cycle * 7);
  else {
    const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
    const originalDay = date.getUTCDate();
    const endOfMonth = originalDay === new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + cycle * months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(endOfMonth ? lastDay : Math.min(originalDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}
function cycleFor(anchor: string, frequency: Frequency, value: string) {
  if (frequency === "weekly") return Math.round((dateValue(value) - dateValue(anchor)) / day / 7);
  const a = new Date(dateValue(anchor)), b = new Date(dateValue(value));
  const estimate = Math.round(((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth()) / (frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12));
  // Posting can cross into the next month, so choose the nearest billing date.
  return [estimate - 1, estimate, estimate + 1].sort((left, right) => Math.abs(dateValue(scheduledDate(anchor, frequency, left)) - dateValue(value)) - Math.abs(dateValue(scheduledDate(anchor, frequency, right)) - dateValue(value)))[0];
}
function onSchedule(payment: RecurringPaymentInput, transaction: RecurringTransaction) {
  const cycle = cycleFor(payment.anchorDate, payment.frequency, transaction.transactionDate);
  return Math.abs(dateValue(transaction.transactionDate) - dateValue(scheduledDate(payment.anchorDate, payment.frequency, cycle))) <= (payment.frequency === "weekly" ? 1 : 4) * day;
}
function sameMerchant(payment: RecurringPaymentInput, transaction: RecurringTransaction) {
  return payment.accountId === transaction.accountId && payment.currencyCode === transaction.currencyCode && recurringDescription(payment.description) === recurringDescription(transaction.description);
}

// Recompute evidence from eligible expenses so exclusions and reclassification take effect immediately.
export function recurringOverview(snapshot: RecurringSnapshot, today = new Date().toISOString().slice(0, 10)) {
  const methodsFor = (payment: RecurringPayment) => snapshot.methods.filter(m => m.paymentId === payment.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const methodAt = (payment: RecurringPayment, date: string) => methodsFor(payment).filter(m => m.effectiveDate <= date.slice(0, 10)).at(-1) ?? payment;
  const merchantAt = (payment: RecurringPayment, transaction: RecurringTransaction) => sameMerchant({ ...payment, ...methodAt(payment, transaction.transactionDate) }, transaction);
  const sorted = [...snapshot.transactions].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.id - b.id);
  const owners = new Map<number, number[]>();
  for (const transaction of sorted) {
    const explicit = snapshot.links.find(link => link.transactionId === transaction.id);
    owners.set(transaction.id, explicit ? [explicit.paymentId] : snapshot.payments.filter(p => p.status !== "dismissed" && merchantAt(p, transaction) && onSchedule(p, transaction)).map(p => p.id));
  }
  const payments = snapshot.payments.map(payment => {
    const candidates = sorted.filter(t => owners.get(t.id)?.length === 1 && owners.get(t.id)![0] === payment.id);
    // Multiple charges in one billing window are ambiguous and need user review.
    const counts = new Map<number, number>();
    for (const t of candidates) { const cycle = cycleFor(payment.anchorDate, payment.frequency, t.transactionDate); counts.set(cycle, (counts.get(cycle) ?? 0) + 1); }
    const transactions = candidates.filter(t => snapshot.links.some(link => link.transactionId === t.id && link.paymentId === payment.id) || counts.get(cycleFor(payment.anchorDate, payment.frequency, t.transactionDate)) === 1);
    const latest = transactions.at(-1);
    const cycle = latest ? cycleFor(payment.anchorDate, payment.frequency, latest.transactionDate) + 1 : 0;
    const nextDate = scheduledDate(payment.anchorDate, payment.frequency, cycle);
    const startDate = new Date(dateValue(nextDate) - 4 * day).toISOString().slice(0, 10);
    const endDate = new Date(dateValue(nextDate) + 4 * day).toISOString().slice(0, 10);
    // A billing window spanning a switch needs evidence from each account for its portion.
    let covered = true;
    for (let date = dateValue(startDate); date <= dateValue(endDate); date += day) {
      const value = new Date(date).toISOString().slice(0, 10);
      const accountId = methodAt(payment, value).accountId;
      if (!snapshot.coverage.some(c => c.accountId === accountId && c.startDate <= value && c.endDate >= value)) covered = false;
    }
    const expectedAmount = latest ? Math.abs(latest.amountMinor) : payment.amountMinor;
    return { ...payment, methods: methodsFor(payment), currentMethod: methodAt(payment, today), transactions, nextDate: payment.status === "active" ? nextDate : null,
      monthlyEquivalentMinor: Math.round(expectedAmount * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 }[payment.frequency])),
      priceChanged: !!latest && Math.abs(latest.amountMinor) !== payment.amountMinor,
      needsReview: candidates.length !== transactions.length || sorted.some(t => owners.get(t.id)!.includes(payment.id) && owners.get(t.id)!.length > 1),
      paymentMissing: payment.status === "active" && endDate < today && covered,
      coverageUnknown: payment.status === "active" && endDate < today && !covered,
    };
  });
  const groups = new Map<string, RecurringTransaction[]>();
  for (const t of sorted) {
    if (snapshot.links.some(link => link.transactionId === t.id) || snapshot.payments.some(p => merchantAt(p, t))) continue;
    const description = recurringDescription(t.description);
    if (!description || ["PAYPAL", "PAYPAL PAYMENT", "AMAZON", "APPLE.COM/BILL"].includes(description)) continue;
    const key = JSON.stringify([t.accountId, t.currencyCode, description]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const suggestions: Array<RecurringPaymentInput & { transactions: RecurringTransaction[]; reason: string; firstPaymentDate: string }> = [];
  for (const group of groups.values()) {
    for (const frequency of frequencies) {
      const required = frequency === "annual" ? 2 : 3;
      if (group.length < required) continue;
      const evidence = group.slice(-Math.max(required, 6));
      const first = evidence[0], latest = evidence.at(-1)!;
      const draft: RecurringPaymentInput = { name: latest.description, description: latest.description, accountId: latest.accountId, currencyCode: latest.currencyCode, amountMinor: Math.abs(latest.amountMinor), frequency, anchorDate: first.transactionDate.slice(0, 10), kind: "subscription", status: "active" };
      if (!evidence.every((t, index) => cycleFor(draft.anchorDate, frequency, t.transactionDate) === index && onSchedule(draft, t))) continue;
      const amounts = evidence.map(t => Math.abs(t.amountMinor));
      const variable = Math.max(...amounts) !== Math.min(...amounts);
      suggestions.push({ ...draft, firstPaymentDate: group[0].transactionDate.slice(0, 10), transactions: evidence, reason: `${evidence.length} payments on a ${frequency} schedule. ${variable ? "Amounts vary; check whether this is a bill or a price change." : "The amount is consistent."}` });
      break;
    }
  }
  return { payments, suggestions };
}
