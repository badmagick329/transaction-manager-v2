import { eq, inArray, desc } from "drizzle-orm";
import { alreadyReviewed, canonical, evidenceVersion, prepareReview, reviewItems, reviewPreviewToken, reviewSubjectVersion, ReviewConflict, trackingState, validateDecision, type RecurringReviewRepository, type ReviewDecision, type TrackingState } from "../../app/recurring-review";
import { recurringOverview, type RecurringSnapshot } from "../../app/recurring-payments";
import type { ReviewAction, ReviewDecisionInput, ReviewReportInput } from "../../app/contracts/recurring-review";
import type { AppDatabase } from "./client";
import { DrizzleRecurringPaymentRepository } from "./drizzle-recurring-payment-repository";
import { accounts, recurringPayments, recurringPaymentLinks, recurringPaymentMethods, recurringReviewDecisions, recurringReviewReports } from "./schema";

// Review writes use immediate transactions: evidence cannot change between checking and committing.
export class DrizzleRecurringReviewRepository implements RecurringReviewRepository {
  private payments: DrizzleRecurringPaymentRepository;
  constructor(private readonly db: AppDatabase) { this.payments = new DrizzleRecurringPaymentRepository(db); }
  private atomic<T>(work: () => T): T { return this.db.transaction(work, { behavior: "immediate" }); }
  private all() { return this.db.select().from(recurringReviewDecisions).all().map(row => row.decision); }
  private get(id: number) {
    const row = this.db.select().from(recurringReviewDecisions).where(eq(recurringReviewDecisions.id, id)).get();
    if (!row) throw new Error("Review decision not found.");
    return row.decision;
  }
  private put(decision: ReviewDecision) {
    this.db.update(recurringReviewDecisions).set({ decision }).where(eq(recurringReviewDecisions.id, decision.id)).run();
    return decision;
  }
  // Persist what the agent claims to have inspected without claiming unexamined rows were reviewed.
  report(input: ReviewReportInput) {
    return this.atomic(() => {
      const prior = this.db.select().from(recurringReviewReports).where(eq(recurringReviewReports.requestId, input.requestId)).get();
      if (prior) {
        const { createdAt, eligibleCount, accounts: accountScope, ...request } = prior.report;
        if (canonical(request) !== canonical(input)) throw new ReviewConflict("Report requestId reused with different content.");
        return prior.report;
      }
      const snapshot = this.payments.snapshotSync();
      if (input.evidenceVersion !== evidenceVersion(snapshot)) throw new ReviewConflict("Evidence changed. Refresh before reporting.");
      const eligible = new Set(snapshot.transactions.map(t => t.id));
      const inspected = new Set(input.inspectedTransactionIds);
      if (input.inspectedTransactionIds.some(id => !eligible.has(id)) || input.unresolved.some(u => u.transactionIds.some(id => !inspected.has(id)))) throw new Error("Report IDs must be eligible; unresolved records must have been inspected.");
      const report = { ...input, createdAt: new Date().toISOString(), eligibleCount: eligible.size,
        accounts: this.db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map(a => {
          const rows = snapshot.transactions.filter(t => t.accountId === a.id);
          const examined = rows.filter(t => inspected.has(t.id)).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
          return { ...a, eligibleCount: rows.length, inspectedCount: examined.length, firstDate: examined[0]?.transactionDate ?? null, lastDate: examined.at(-1)?.transactionDate ?? null };
        }),
      };
      this.db.insert(recurringReviewReports).values({ requestId: input.requestId, report }).run();
      return report;
    });
  }
  queue() {
    return this.atomic(() => {
      const snapshot = this.payments.snapshotSync();
      const version = evidenceVersion(snapshot);
      const decisions = this.all().map(d => d.status === "pending" && d.request.evidenceVersion !== version ? this.put({ ...d, status: "outdated" }) : d);
      const items = reviewItems(snapshot).map(item => ({ ...item, decisions: decisions.filter(d => d.itemId === item.id).map(d => ({ id: d.id, status: d.status, reasoning: d.request.reasoning })),
        alreadyReviewed: decisions.some(d => d.itemId === item.id && alreadyReviewed(d, snapshot)),
      }));
      return { evidenceVersion: version, latestReport: this.db.select().from(recurringReviewReports).orderBy(desc(recurringReviewReports.id)).get()?.report ?? null, items, accounts: this.db.select({ id: accounts.id, name: accounts.name, currencyCode: accounts.currencyCode }).from(accounts).all(),
        scope: {
          description: "All posted, negative expenses included in cash flow. Availability is not proof that an agent inspected them.",
          accounts: this.db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map(account => {
            const rows = snapshot.transactions.filter(t => t.accountId === account.id).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
            return { ...account, transactionCount: rows.length, firstDate: rows[0]?.transactionDate ?? null, lastDate: rows.at(-1)?.transactionDate ?? null,
              coverage: snapshot.coverage.filter(c => c.accountId === account.id) };
          }),
          transactionCount: snapshot.transactions.length,
          withoutDecisionCount: snapshot.transactions.filter(t => !decisions.some(d => d.request.evidenceTransactionIds.includes(t.id))).length,
        },
        ...recurringOverview(snapshot), transactions: snapshot.transactions, coverage: snapshot.coverage, links: snapshot.links,
        decisions: decisions.reverse(),
      };
    });
  }
  private validateAccounts(action: ReviewAction) {
    if (action.type === "link") return;
    const ids = [action.input.accountId, ...((action.type === "create" || action.type === "update") ? (action.methods ?? []).map(m => m.accountId) : [])];
    if (ids.some(id => !this.db.select().from(accounts).where(eq(accounts.id, id)).get())) throw new Error("Account not found.");
  }
  assess(input: ReviewDecisionInput) {
    return this.atomic(() => {
      this.validateAccounts(input.action);
      const checked = validateDecision(this.payments.snapshotSync(), input);
      return { preview: checked.preview, automaticBlockers: checked.automaticBlockers };
    });
  }
  submit(input: ReviewDecisionInput) {
    return this.atomic(() => {
      const prior = this.db.select().from(recurringReviewDecisions).where(eq(recurringReviewDecisions.requestId, input.requestId)).get();
      if (prior) {
        if (canonical(prior.decision.request) !== canonical(input)) throw new ReviewConflict("This requestId was already used for a different decision.");
        return prior.decision;
      }
      const snapshot = this.payments.snapshotSync();
      if (this.all().some(d => d.itemId === input.itemId && alreadyReviewed(d, snapshot))) throw new ReviewConflict("This item already has a review decision for its current evidence. Leave it for the user.");
      if (input.itemId.startsWith("discovery:") && this.all().some(d => d.request.evidenceTransactionIds.includes(Number(input.itemId.slice(10))) && alreadyReviewed(d, snapshot))) throw new ReviewConflict("This discovery evidence already has a review decision. Review the existing proposal or payment.");
      this.validateAccounts(input.action);
      const checked = validateDecision(snapshot, input);
      const decision: ReviewDecision = {
        id: 0, itemId: input.itemId, name: checked.item.name, request: input,
        reviewedVersion: reviewSubjectVersion(snapshot, input.itemId),
        status: "pending", preview: checked.preview, automaticBlockers: checked.automaticBlockers,
        evidence: snapshot.transactions.filter(t => input.evidenceTransactionIds.includes(t.id)),
        appliedAction: null, appliedBy: null, before: null, after: null,
        createdAt: new Date().toISOString(), resolvedAt: null,
      };
      decision.id = this.db.insert(recurringReviewDecisions).values({ requestId: input.requestId, decision }).returning().get()!.id;
      if (input.disposition === "apply" && checked.automaticBlockers.length === 0) return this.apply(decision, input.action, "agent", snapshot);
      return this.put(decision);
    });
  }
  private checkPending(decision: ReviewDecision) {
    if (decision.status !== "pending" && decision.status !== "outdated") throw new ReviewConflict("This proposal is already resolved.");
  }
  private freshPreview(decision: ReviewDecision, snapshot: RecurringSnapshot, action: ReviewAction) {
    this.checkPending(decision);
    this.validateAccounts(action);
    // Human editing can correct proposed fields while preserving the original subject and operation.
    const original = decision.request.action;
    const target = (a: ReviewAction) => a.type === "create" ? a.input.accountId : a.type === "method" ? a.input.paymentId : a.paymentId;
    if (action.type !== original.type || target(action) !== target(original)) throw new Error("Editing must preserve the proposal's operation and target.");
    if (!decision.request.evidenceTransactionIds.every(id => snapshot.transactions.some(t => t.id === id))) throw new ReviewConflict("Supporting expenses changed or were excluded. Dismiss this proposal and review the current records.");
    return prepareReview(snapshot, action);
  }
  preview(id: number, action?: ReviewAction) {
    return this.atomic(() => {
      const decision = this.get(id);
      const snapshot = this.payments.snapshotSync();
      const chosen = action ?? decision.request.action;
      const version = evidenceVersion(snapshot);
      return { preview: this.freshPreview(decision, snapshot, chosen).preview, evidenceVersion: version, previewToken: reviewPreviewToken(version, id, chosen) };
    });
  }
  approve(id: number, version: string, previewToken: string, action?: ReviewAction) {
    return this.atomic(() => {
      const decision = this.get(id);
      if (decision.status === "applied") {
        if (action && canonical(action) !== canonical(decision.appliedAction)) throw new ReviewConflict("This proposal was applied with different edits.");
        return decision;
      }
      this.checkPending(decision);
      const snapshot = this.payments.snapshotSync();
      if (version !== evidenceVersion(snapshot)) throw new ReviewConflict("Evidence changed after preview. Preview again before accepting.");
      const chosen = action ?? decision.request.action;
      if (previewToken !== reviewPreviewToken(version, id, chosen)) throw new ReviewConflict("Proposal edits changed after preview. Preview the edited proposal again.");
      decision.preview = this.freshPreview(decision, snapshot, chosen).preview;
      return this.apply(decision, chosen, "human", snapshot);
    });
  }
  private apply(decision: ReviewDecision, action: ReviewAction, by: "agent" | "human", snapshot: RecurringSnapshot) {
    let paymentId: number;
    if (action.type === "create") {
      paymentId = this.payments.saveSync(action.input).id;

    }
    else if (action.type === "update") { paymentId = action.paymentId; this.payments.saveSync(action.input, paymentId); }
    else if (action.type === "method") { paymentId = action.input.paymentId; this.payments.changeMethodSync(action.input); }
    else { paymentId = action.paymentId; this.payments.linkSync(action.transactionId, paymentId); }
    if (action.type === "create" || action.type === "update") {
      for (const method of action.methods ?? []) this.payments.changeMethodSync({ ...method, paymentId });
      for (const id of action.transactionIds ?? []) this.payments.linkSync(id, paymentId);
    }
    const ids = new Set([paymentId]);
    if (action.type === "link") {
      const previous = recurringOverview(snapshot).payments.find(p => p.id !== paymentId && p.transactions.some(t => t.id === action.transactionId));
      if (previous) ids.add(previous.id);
    }
    const after = this.payments.snapshotSync();
    const capture = (s: RecurringSnapshot) => Object.fromEntries([...ids].map(id => [String(id), trackingState(s, id)]));
    return this.put({ ...decision, status: "applied", appliedBy: by, appliedAction: action,
      reviewedVersion: reviewSubjectVersion(after, decision.itemId),
      before: capture(snapshot), after: capture(after), resolvedAt: new Date().toISOString(),
    });
  }
  dismiss(id: number) {
    return this.atomic(() => {
      const decision = this.get(id);
      if (decision.status === "dismissed") return decision;
      this.checkPending(decision);
      return this.put({ ...decision, status: "dismissed", reviewedVersion: reviewSubjectVersion(this.payments.snapshotSync(), decision.itemId), resolvedAt: new Date().toISOString() });
    });
  }
  undo(id: number) {
    return this.atomic(() => {
      const decision = this.get(id);
      if (decision.status === "undone") return decision;
      if (decision.status !== "applied") throw new ReviewConflict("Only applied changes can be undone.");
      const snapshot = this.payments.snapshotSync();
      const ids = Object.keys(decision.after!).map(Number);
      for (const id of ids) {
        if (canonical(trackingState(snapshot, id)) !== canonical(decision.after![String(id)])) throw new ReviewConflict("This payment has later changes. Undo would overwrite them.");
      }
      this.db.delete(recurringPaymentLinks).where(inArray(recurringPaymentLinks.paymentId, ids)).run();
      this.db.delete(recurringPaymentMethods).where(inArray(recurringPaymentMethods.paymentId, ids)).run();
      for (const id of ids) this.restore(id, decision.before![String(id)]);
      return this.put({ ...decision, status: "undone", reviewedVersion: reviewSubjectVersion(this.payments.snapshotSync(), decision.itemId), resolvedAt: new Date().toISOString() });
    });
  }
  private restore(id: number, state: TrackingState) {
    if (!state.payment) { this.db.delete(recurringPayments).where(eq(recurringPayments.id, id)).run(); return; }
    this.db.update(recurringPayments).set(state.payment).where(eq(recurringPayments.id, id)).run();
    if (state.methods.length) this.db.insert(recurringPaymentMethods).values(state.methods).run();
    if (state.links.length) this.db.insert(recurringPaymentLinks).values(state.links).run();
  }
}
