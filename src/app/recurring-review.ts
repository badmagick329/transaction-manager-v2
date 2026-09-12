import { createHash } from "node:crypto";
import { recurringOverview, recurringDescription, recurringMerchant, previewRecurringChange, type RecurringSnapshot, type RecurringPayment, type PaymentMethodChange } from "./recurring-payments";
import type { ReviewAction, ReviewDecisionInput, ReviewReportInput } from "./contracts/recurring-review";

// Stable serialization makes versions independent of database row and object-key order.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const evidenceVersion = (snapshot: RecurringSnapshot) => hash({ snapshot, today: new Date().toISOString().slice(0, 10) });
export const reviewPreviewToken = (version: string, decisionId: number, action: ReviewAction) => hash({ version, decisionId, action });

// A resolved price proposal must not suppress a later, different change on the same payment.
export function reviewSubjectVersion(snapshot: RecurringSnapshot, itemId: string) {
  if (itemId.startsWith("discovery:")) {
    const seed = snapshot.transactions.find(t => t.id === Number(itemId.slice(10)));
    return hash(seed ? snapshot.transactions.filter(t => t.currencyCode === seed.currencyCode && recurringMerchant(t.description) === recurringMerchant(seed.description)) : null);
  }
  if (!itemId.startsWith("payment:")) return itemId;
  const state = trackingState(snapshot, Number(itemId.slice("payment:".length)));
  if (!state.payment) return hash(state);
  const methods = [state.payment, ...state.methods];
  const derived = recurringOverview(snapshot).payments.find(p => p.id === state.payment!.id)!;
  return hash({ ...state,
    issues: { priceChanged: derived.priceChanged, needsReview: derived.needsReview, paymentMissing: derived.paymentMissing, coverageUnknown: derived.coverageUnknown, matchedTransactions: derived.transactions.map(t => t.id) },
    transactions: snapshot.transactions.filter(t => t.currencyCode === state.payment!.currencyCode && (state.links.some(l => l.transactionId === t.id) || methods.some(m => {
      const description = recurringDescription(t.description);
      return m.accountId === t.accountId && (m.matchMode === "exact" ? description === m.description : description.startsWith(m.description));
    }))),
    coverage: snapshot.coverage.filter(c => methods.some(m => m.accountId === c.accountId)),
  });
}

export function alreadyReviewed(decision: ReviewDecision, snapshot: RecurringSnapshot) {
  if (decision.status === "pending" || decision.status === "outdated") return true;
  return decision.reviewedVersion === reviewSubjectVersion(snapshot, decision.itemId);
}
export function reviewItems(snapshot: RecurringSnapshot) {
  const overview = recurringOverview(snapshot);
  return [
    ...overview.suggestions.map(suggestion => ({
      id: `suggestion:${hash([suggestion.accountId, suggestion.currencyCode, suggestion.description, suggestion.frequency])}`,
      kind: "suggestion" as const, name: suggestion.name, suggestion, paymentId: null,
      issues: [suggestion.reason], transactionIds: suggestion.transactions.map(t => t.id),
    })),
    ...overview.payments.filter(p => p.status !== "dismissed").map(p => ({
      id: `payment:${p.id}`, kind: "payment" as const, name: p.name, suggestion: null, paymentId: p.id,
      issues: [p.priceChanged && "Price differs", p.needsReview && "Conflicting matches", p.paymentMissing && "Missing payment", p.coverageUnknown && "Incomplete statement coverage"].filter(Boolean) as string[],
      transactionIds: snapshot.transactions.filter(t => t.currencyCode === p.currencyCode).map(t => t.id),
    })),
  ];
}

export type ReviewPreview = {
  before: RecurringPayment | null;
  after: RecurringPayment;
  methodsBefore: PaymentMethodChange[];
  methodsAfter: PaymentMethodChange[];
  matching: ReturnType<typeof previewRecurringChange>;
  reassignedFrom: number | null;
  reassignedFromName: string | null;
  relatedUnmatched?: RecurringSnapshot["transactions"];
};

// Proposals may be broader than automatic actions, but must obey the same domain invariants as manual edits.
export function prepareReview(snapshot: RecurringSnapshot, action: ReviewAction): { snapshot: RecurringSnapshot; paymentId: number; preview: ReviewPreview } {
  const after: RecurringSnapshot = structuredClone(snapshot);
  const paymentId = action.type === "create" ? -1 : action.type === "method" ? action.input.paymentId : action.paymentId;
  const before = snapshot.payments.find(p => p.id === paymentId) ?? null;
  if (action.type !== "create" && (!before || before.status === "dismissed")) throw new Error("Choose a tracked recurring payment.");
  let reassignedFrom: number | null = null;
  if (action.type === "create") {
    if (action.input.status !== "active") throw new Error("New proposals must create active recurring payments.");
    if (snapshot.payments.some(p => p.accountId === action.input.accountId && p.currencyCode === action.input.currencyCode && p.description === action.input.description)) throw new Error("This merchant already has a tracking decision. Review the existing record.");
    after.payments.push({ ...action.input, id: paymentId });
  } else if (action.type === "update") {
    for (const key of ["accountId", "currencyCode", "anchorDate", "frequency", "amountMinor"] as const) {
      if (action.input[key] !== before![key]) throw new Error("Use a dated billing change for account, schedule, or price updates. Currency cannot change.");
    }
    after.payments = after.payments.map(p => p.id === paymentId ? { ...action.input, id: paymentId } : p);
  } else if (action.type === "method") {
    const { previousEffectiveDate, ...method } = action.input;
    const replacedDate = previousEffectiveDate ?? method.effectiveDate;
    if (previousEffectiveDate && !after.methods.some(m => m.paymentId === paymentId && m.effectiveDate === previousEffectiveDate)) throw new Error("Billing change no longer exists.");
    if (previousEffectiveDate && previousEffectiveDate !== method.effectiveDate && after.methods.some(m => m.paymentId === paymentId && m.effectiveDate === method.effectiveDate)) throw new Error("Another billing change already uses this date.");
    after.methods = [...after.methods.filter(m => m.paymentId !== paymentId || m.effectiveDate !== replacedDate), method];
  } else {
    const transaction = snapshot.transactions.find(t => t.id === action.transactionId);
    if (!transaction || transaction.currencyCode !== before!.currencyCode) throw new Error("Choose an eligible expense in the payment currency.");
    reassignedFrom = recurringOverview(snapshot).payments.find(p => p.id !== paymentId && p.transactions.some(t => t.id === action.transactionId))?.id ?? null;
    after.links = [...after.links.filter(l => l.transactionId !== action.transactionId), { transactionId: action.transactionId, paymentId }];
  }
  if (action.type === "create" || action.type === "update") {
    const dates = (action.methods ?? []).map(m => m.effectiveDate);
    if (new Set(dates).size !== dates.length) throw new Error("Billing changes must have distinct effective dates.");
    for (const method of action.methods ?? []) {
      after.methods = [...after.methods.filter(m => m.paymentId !== paymentId || m.effectiveDate !== method.effectiveDate), { ...method, paymentId }];
    }
    for (const id of action.transactionIds ?? []) {
      const transaction = snapshot.transactions.find(t => t.id === id);
      if (!transaction || transaction.currencyCode !== action.input.currencyCode) throw new Error("Choose eligible expenses in the payment currency.");
      if (snapshot.links.some(l => l.transactionId === id && l.paymentId !== paymentId) || recurringOverview(snapshot).payments.some(p => p.id !== paymentId && p.transactions.some(t => t.id === id))) throw new Error("History includes a transaction already tracked by another payment.");
      after.links = [...after.links.filter(l => l.transactionId !== id), { transactionId: id, paymentId }];
    }
  }
  return { snapshot: after, paymentId, preview: {
    before, after: after.payments.find(p => p.id === paymentId)!,
    methodsBefore: snapshot.methods.filter(m => m.paymentId === paymentId),
    methodsAfter: after.methods.filter(m => m.paymentId === paymentId),
    matching: previewRecurringChange(snapshot, after, paymentId), reassignedFrom,
    reassignedFromName: snapshot.payments.find(p => p.id === reassignedFrom)?.name ?? null,
    relatedUnmatched: (() => {
      const payment = after.payments.find(p => p.id === paymentId)!;
      const words = new Set([payment.description, ...after.methods.filter(m => m.paymentId === paymentId).map(m => m.description)].flatMap(d => recurringMerchant(d).split(" ")).filter(w => w.length >= 5 && !["PAYMENT", "SUBSCRIPTION", "ONLINE", "KARLSRUHE"].includes(w)));
      const included = new Set(recurringOverview(after).payments.find(p => p.id === paymentId)!.transactions.map(t => t.id));
      return snapshot.transactions.filter(t => t.currencyCode === payment.currencyCode && !included.has(t.id) && recurringMerchant(t.description).split(" ").some(w => words.has(w)));
    })(),
  } };
}

export function validateDecision(snapshot: RecurringSnapshot, input: ReviewDecisionInput) {
  if (input.evidenceVersion !== evidenceVersion(snapshot)) throw new ReviewConflict("Evidence changed. Fetch the review queue again.");
  const seed = input.itemId.startsWith("discovery:") ? snapshot.transactions.find(t => `discovery:${t.id}` === input.itemId) : undefined;
  const item = reviewItems(snapshot).find(item => item.id === input.itemId) ?? (seed ? {
    id: input.itemId, kind: "discovery", name: seed.description, suggestion: null, paymentId: null,
    transactionIds: snapshot.transactions.filter(t => t.currencyCode === seed.currencyCode).map(t => t.id), issues: [],
  } : undefined);
  if (!item) throw new ReviewConflict("This review item no longer needs a decision.");
  if (!input.evidenceTransactionIds.every(id => snapshot.transactions.some(t => t.id === id))) throw new Error("Supporting transactions must be eligible expenses.");
  const action = input.action;
  if (item.paymentId !== null && (action.type === "create" || (action.type === "method" ? action.input.paymentId : action.paymentId) !== item.paymentId)) throw new Error("The action must target the reviewed payment.");
  if (item.suggestion && action.type === "create" && action.input.currencyCode !== item.suggestion.currencyCode) throw new Error("The proposal must use the reviewed currency.");
  if (item.suggestion && action.type !== "create") {
    const target = snapshot.payments.find(p => p.id === (action.type === "method" ? action.input.paymentId : action.paymentId));
    if (action.type === "update" || target?.currencyCode !== item.suggestion.currencyCode) throw new Error("Use a billing change or transaction link to an existing payment in the suggestion currency.");
    if (action.type === "method" && action.input.accountId !== item.suggestion.accountId) throw new Error("The proposed method must use the suggestion account.");
  }
  if (action.type === "link" && !input.evidenceTransactionIds.includes(action.transactionId)) throw new Error("Cite the transaction being attached.");
  if (seed && (action.type !== "create" || action.input.currencyCode !== seed.currencyCode || !input.evidenceTransactionIds.includes(seed.id))) throw new Error("Discovery must create a payment in the seed currency and cite the seed transaction.");
  if ((action.type === "create" || action.type === "update") && !(action.transactionIds ?? []).every(id => input.evidenceTransactionIds.includes(id))) throw new Error("Cite every attached historical transaction.");
  const prepared = prepareReview(snapshot, action);
  if (input.evidenceTransactionIds.some(id => snapshot.transactions.find(t => t.id === id)!.currencyCode !== prepared.preview.after.currencyCode)) throw new Error("Supporting history must use the payment currency.");
  const automaticBlockers: string[] = [];
  if (action.type !== "create" || !item.suggestion) automaticBlockers.push(seed ? "Newly discovered payments require human approval." : "Existing payments require human approval.");
  else {
    const suggestion = item.suggestion;
    if (prepared.preview.relatedUnmatched?.length) automaticBlockers.push("Related merchant history remains outside this setup.");
    if ((action.methods?.length ?? 0) || (action.transactionIds?.length ?? 0)) automaticBlockers.push("Historical setup requires human approval.");
    const included = new Set(prepared.preview.matching.rows.filter(t => t.outcome === "Included").map(t => t.id));
    if (!input.evidenceTransactionIds.every(id => included.has(id))) automaticBlockers.push("Some supporting history is not included by this setup.");
    for (const key of ["accountId", "description", "currencyCode", "matchMode", "amountMinor", "frequency", "anchorDate", "status"] as const) {
      if (action.input[key] !== suggestion[key]) automaticBlockers.push(`Automatic creation must preserve the detected ${key}.`);
    }
    if (!suggestion.transactions.every(t => Math.abs(t.amountMinor) === suggestion.amountMinor)) automaticBlockers.push("Amounts vary.");
    if (!suggestion.transactions.every(t => input.evidenceTransactionIds.includes(t.id))) automaticBlockers.push("Cite all detected occurrences for automatic creation.");
    if (prepared.preview.matching.rows.some(t => t.outcome !== "Included")) automaticBlockers.push("Matching has irregular or conflicting transactions.");
    if (recurringOverview(prepared.snapshot).payments.find(p => p.id === prepared.paymentId)!.needsReview) automaticBlockers.push("The proposed match is ambiguous.");
  }
  return { ...prepared, item, automaticBlockers };
}

export class ReviewConflict extends Error {}

export type TrackingState = { payment: RecurringPayment | null; methods: PaymentMethodChange[]; links: RecurringSnapshot["links"] };
export function trackingState(snapshot: RecurringSnapshot, paymentId: number): TrackingState {
  return { payment: snapshot.payments.find(p => p.id === paymentId) ?? null, methods: snapshot.methods.filter(m => m.paymentId === paymentId), links: snapshot.links.filter(l => l.paymentId === paymentId) };
}
export type ReviewDecision = {
  id: number; itemId: string; name: string; request: ReviewDecisionInput;
  reviewedVersion: string;
  status: "pending" | "applied" | "dismissed" | "outdated" | "undone";
  preview: ReviewPreview; automaticBlockers: string[];
  evidence: RecurringSnapshot["transactions"];
  appliedAction: ReviewAction | null; appliedBy: "agent" | "human" | null;
  before: Record<string, TrackingState> | null; after: Record<string, TrackingState> | null;
  createdAt: string; resolvedAt: string | null;
};
export type ReviewReport = ReviewReportInput & { createdAt: string; eligibleCount: number; accounts: { id: number; name: string; inspectedCount: number; eligibleCount: number; firstDate: string | null; lastDate: string | null }[] };
export interface RecurringReviewRepository {
  report(input: ReviewReportInput): ReviewReport;
  queue(): unknown;
  assess(input: ReviewDecisionInput): { preview: ReviewPreview; automaticBlockers: string[] };
  submit(input: ReviewDecisionInput): ReviewDecision;
  preview(id: number, action?: ReviewAction): { preview: ReviewPreview; evidenceVersion: string; previewToken: string };
  approve(id: number, evidenceVersion: string, previewToken: string, action?: ReviewAction): ReviewDecision;
  dismiss(id: number): ReviewDecision;
  undo(id: number): ReviewDecision;
}
