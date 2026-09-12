export const frequencies = ["weekly", "monthly", "quarterly", "semiannual", "annual"] as const;
export const frequencyLabels = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly · every 3 months", semiannual: "Every 6 months", annual: "Annual" };
export type Frequency = typeof frequencies[number];
export type RecurringMatchMode = "exact" | "starts_with" | "contains";
export type RecurringPaymentInput = {
  name: string; kind: "subscription" | "bill" | "instalment";
  accountId: number; currencyCode: string; description: string; matchMode: RecurringMatchMode;
  amountMinor: number; frequency: Frequency; anchorDate: string;
  status: "active" | "paused" | "cancelled" | "dismissed";
};
export type RecurringPayment = RecurringPaymentInput & { id: number };
export type PaymentMethodChange = { paymentId: number; accountId: number; description: string; matchMode: RecurringMatchMode; effectiveDate: string; previousEffectiveDate?: string; anchorDate: string | null; frequency: Frequency | null; amountMinor: number | null };
export type RecurringTransaction = { id: number; accountId: number; currencyCode: string; description: string; amountMinor: number; transactionDate: string };
export type RecurringTransactionDecision = { paymentId: number; transactionId: number; oneOff: boolean; priceWarningDismissed: boolean };
export type RecurringSnapshot = { transactionDecisions: RecurringTransactionDecision[]; payments: RecurringPayment[]; methods: PaymentMethodChange[]; transactions: RecurringTransaction[]; coverage: Array<{ accountId: number; startDate: string; endDate: string }>; links: Array<{ transactionId: number; paymentId: number }> };
export interface RecurringPaymentRepository {
  snapshot(): Promise<RecurringSnapshot>;
  setTransactionDecision(input: RecurringTransactionDecision): Promise<void>;
  save(input: RecurringPaymentInput, id?: number): Promise<RecurringPayment>;
  link(transactionId: number, paymentId: number): Promise<void>;
  changeMethod(input: PaymentMethodChange): Promise<void>;
}

// Preserve distinguishing merchant text: broad reference stripping can merge unrelated purchases.
export function recurringDescription(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase(); }
// Discovery removes statement formatting only; saved matching rules retain the original text.
export function recurringMerchant(value: string) {
  return recurringDescription(value)
    .replace(/^INT['’]L\s+\d+\s+/, "")
    .replace(/\s+(?:GBP|USD|EUR)\s+\d+(?:\.\d+)?\s+@\s+[\d.]+\s+VISA RATE$/, "")
    .replace(/\s+ON\s+\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\s+\d{2,4})?$/, "")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}
const day = 86400000;
const dateValue = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime();
// Calculate from the original anchor so February and processing delays cannot drift later bills.
export function scheduledDate(anchor: string, frequency: Frequency, cycle: number) {
  const date = new Date(dateValue(anchor));
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + cycle * 7);
  else {
    const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "semiannual" ? 6 : 12;
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
  const estimate = Math.round(((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth()) / (frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "semiannual" ? 6 : 12));
  // Posting can cross into the next month, so choose the nearest billing date.
  return [estimate - 1, estimate, estimate + 1].sort((left, right) => Math.abs(dateValue(scheduledDate(anchor, frequency, left)) - dateValue(value)) - Math.abs(dateValue(scheduledDate(anchor, frequency, right)) - dateValue(value)))[0];
}
function onSchedule(payment: RecurringPaymentInput, transaction: RecurringTransaction) {
  const cycle = cycleFor(payment.anchorDate, payment.frequency, transaction.transactionDate);
  return Math.abs(dateValue(transaction.transactionDate) - dateValue(scheduledDate(payment.anchorDate, payment.frequency, cycle))) <= (payment.frequency === "weekly" ? 1 : 4) * day;
}
// Use one comparison for tracking and review versions so both see the same merchant history.
export function matchesRecurringDescription(value: string, pattern: string, mode: RecurringMatchMode) {
  const description = recurringDescription(value), normalizedPattern = recurringDescription(pattern);
  return mode === "contains" ? description.includes(normalizedPattern) : mode === "starts_with" ? description.startsWith(normalizedPattern) : description === normalizedPattern;
}
function sameMerchant(payment: RecurringPaymentInput, transaction: RecurringTransaction) {
  return payment.accountId === transaction.accountId && payment.currencyCode === transaction.currencyCode && matchesRecurringDescription(transaction.description, payment.description, payment.matchMode);
}

// Blank overrides preserve the preceding schedule, including across later provider changes.
export function recurringMethodAt(payment: RecurringPayment, methods: PaymentMethodChange[], date: string) {
  let resolved = { ...payment, effectiveDate: "0001-01-01" };
  for (const method of methods.filter(m => m.paymentId === payment.id && m.effectiveDate <= date.slice(0, 10)).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))) {
    resolved = { ...resolved, accountId: method.accountId, description: method.description, matchMode: method.matchMode, effectiveDate: method.effectiveDate,
      anchorDate: method.anchorDate ?? resolved.anchorDate, frequency: method.frequency ?? resolved.frequency, amountMinor: method.amountMinor ?? resolved.amountMinor };
  }
  return resolved;
}

// Preview uses the real matcher, so conflicts and irregular charges stay visible instead of being silently accepted.
export function previewRecurringChange(before: RecurringSnapshot, after: RecurringSnapshot, paymentId: number) {
  const original = recurringOverview(before).payments.find(p => p.id === paymentId);
  const overview = recurringOverview(after);
  const payment = overview.payments.find(p => p.id === paymentId)!;
  const included = new Set(payment.transactions.map(t => t.id));
  const previouslyIncluded = new Set(original?.transactions.map(t => t.id));
  return {
    nextDate: payment.nextDate,
    rows: after.transactions.filter(t => included.has(t.id) || previouslyIncluded.has(t.id) || sameMerchant(recurringMethodAt(payment, after.methods, t.transactionDate), t)).map(t => {
      const other = overview.payments.find(p => p.id !== paymentId && p.status !== "dismissed" && p.transactions.some(item => item.id === t.id));
      return { ...t, outcome: included.has(t.id) ? "Included" : previouslyIncluded.has(t.id) ? "Removed from this subscription" : other ? `Already tracked: ${other.name}` : !onSchedule(recurringMethodAt(payment, after.methods, t.transactionDate), t) ? "Outside billing schedule; attach manually if appropriate" : "Ambiguous; not attached" };
    }).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.id - b.id),
  };
}

// Recompute evidence from eligible expenses so exclusions and reclassification take effect immediately.
export function recurringOverview(snapshot: RecurringSnapshot, today = new Date().toISOString().slice(0, 10)) {
  const methodsFor = (payment: RecurringPayment) => snapshot.methods.filter(m => m.paymentId === payment.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const methodAt = (payment: RecurringPayment, date: string) => recurringMethodAt(payment, snapshot.methods, date);
  const merchantAt = (payment: RecurringPayment, transaction: RecurringTransaction) => sameMerchant({ ...payment, ...methodAt(payment, transaction.transactionDate) }, transaction);
  const sorted = [...snapshot.transactions].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.id - b.id);
  const owners = new Map<number, number[]>();
  for (const transaction of sorted) {
    const explicit = snapshot.links.find(link => link.transactionId === transaction.id);
    owners.set(transaction.id, explicit ? [explicit.paymentId] : snapshot.payments.filter(p => p.status !== "dismissed" && merchantAt(p, transaction) && onSchedule(methodAt(p, transaction.transactionDate), transaction)).map(p => p.id));
  }
  const payments = snapshot.payments.map(payment => {
    const transactionDecisions = snapshot.transactionDecisions.filter(d => d.paymentId === payment.id);
    const isOneOff = (t: RecurringTransaction) => transactionDecisions.some(d => d.transactionId === t.id && d.oneOff);
    const candidates = sorted.filter(t => owners.get(t.id)?.length === 1 && owners.get(t.id)![0] === payment.id);
    // Multiple charges in one billing window are ambiguous and need user review.
    const billingKey = (t: RecurringTransaction) => { const m = methodAt(payment, t.transactionDate); return `${m.anchorDate}:${m.frequency}:${cycleFor(m.anchorDate, m.frequency, t.transactionDate)}`; };
    const counts = new Map<string, number>();
    for (const t of candidates.filter(t => !isOneOff(t) && onSchedule(methodAt(payment, t.transactionDate), t))) { const key = billingKey(t); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const transactions = candidates.filter(t => isOneOff(t) || snapshot.links.some(link => link.transactionId === t.id && link.paymentId === payment.id) || counts.get(billingKey(t)) === 1);
    const latest = transactions.at(-1);
    const currentMethod = methodAt(payment, today);
    const forecastMethod = methodAt(payment, latest && latest.transactionDate.slice(0, 10) > today ? latest.transactionDate : today);
    // Attaching an irregular charge must not move the subscription's billing schedule.
    const latestScheduled = transactions.filter(t => !isOneOff(t)).filter(t => { const m = methodAt(payment, t.transactionDate); return m.anchorDate === forecastMethod.anchorDate && m.frequency === forecastMethod.frequency && onSchedule(m, t); }).at(-1);
    let cycle = latestScheduled ? cycleFor(forecastMethod.anchorDate, forecastMethod.frequency, latestScheduled.transactionDate) + 1 : Math.max(0, cycleFor(forecastMethod.anchorDate, forecastMethod.frequency, forecastMethod.effectiveDate === "0001-01-01" ? forecastMethod.anchorDate : forecastMethod.effectiveDate));
    let nextDate = scheduledDate(forecastMethod.anchorDate, forecastMethod.frequency, cycle);
    if (!latestScheduled && nextDate < forecastMethod.effectiveDate) nextDate = scheduledDate(forecastMethod.anchorDate, forecastMethod.frequency, ++cycle);
    const startDate = new Date(dateValue(nextDate) - 4 * day).toISOString().slice(0, 10);
    const endDate = new Date(dateValue(nextDate) + 4 * day).toISOString().slice(0, 10);
    // A billing window spanning a switch needs evidence from each account for its portion.
    let covered = true;
    for (let date = dateValue(startDate); date <= dateValue(endDate); date += day) {
      const value = new Date(date).toISOString().slice(0, 10);
      const accountId = methodAt(payment, value).accountId;
      if (!snapshot.coverage.some(c => c.accountId === accountId && c.startDate <= value && c.endDate >= value)) covered = false;
    }
    // One-off adjustments and temporary discounts are history, not a new recurring commitment.
    const expectedAmount = currentMethod.amountMinor;
    return { ...payment, transactionDecisions, methods: methodsFor(payment), currentMethod, transactions, nextDate: payment.status === "active" ? nextDate : null,
      monthlyEquivalentMinor: Math.round(expectedAmount * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 }[currentMethod.frequency])),
      priceChanged: !!latest && !isOneOff(latest) && !transactionDecisions.some(d => d.transactionId === latest.id && d.priceWarningDismissed) && Math.abs(latest.amountMinor) !== methodAt(payment, latest.transactionDate).amountMinor,
      needsReview: candidates.length !== transactions.length || sorted.some(t => owners.get(t.id)!.includes(payment.id) && owners.get(t.id)!.length > 1),
      paymentMissing: payment.status === "active" && endDate < today && covered,
      coverageUnknown: payment.status === "active" && endDate < today && !covered,
    };
  });
  const groups = new Map<string, RecurringTransaction[]>();
  // A shorter observed merchant name can explain a location suffix disappearing.
  // This is only a discovery hint: exact saved matching still requires review across variants.
  const observedNames = new Set(sorted.map(t => recurringMerchant(t.description)));

  for (const t of sorted) {
    if (snapshot.links.some(link => link.transactionId === t.id) || snapshot.payments.some(p => merchantAt(p, t))) continue;
    const normalized = recurringMerchant(t.description);
    const words = normalized.split(" ");
    const description = words.map((_, i) => words.slice(0, i + 1).join(" ")).find(name => name.length >= 5 && observedNames.has(name)) ?? normalized;
    if (!description || ["PAYPAL", "PAYPAL PAYMENT", "AMAZON", "APPLE.COM/BILL"].includes(description)) continue;
    const key = JSON.stringify([t.currencyCode, description]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const suggestions: Array<RecurringPaymentInput & { transactions: RecurringTransaction[]; reason: string; firstPaymentDate: string }> = [];
  for (const group of groups.values()) {
    for (const frequency of frequencies) {
      const required = frequency === "annual" ? 2 : 3;
      if (group.length < required) continue;
      const evidence = group;
      const first = evidence[0], latest = evidence.at(-1)!;
      const draft: RecurringPaymentInput = { matchMode: "exact", name: latest.description, description: latest.description, accountId: latest.accountId, currencyCode: latest.currencyCode, amountMinor: Math.abs(latest.amountMinor), frequency, anchorDate: first.transactionDate.slice(0, 10), kind: "subscription", status: "active" };
      if (!evidence.every((t, index) => cycleFor(draft.anchorDate, frequency, t.transactionDate) === index && onSchedule(draft, t))) continue;
      const amounts = evidence.map(t => Math.abs(t.amountMinor));
      const variable = Math.max(...amounts) !== Math.min(...amounts);
      suggestions.push({ ...draft, firstPaymentDate: group[0].transactionDate.slice(0, 10), transactions: evidence, reason: `${evidence.length} payments suggest a ${frequency} schedule. ${new Set(evidence.map(t => JSON.stringify([t.accountId, recurringDescription(t.description)]))).size > 1 ? "Descriptions or accounts differ; review the complete history before setting up matching. " : ""}${variable ? "Amounts vary; check whether this is a bill or a price change." : "The amount is consistent."}` });
      break;
    }
  }
  return { payments, suggestions };
}
