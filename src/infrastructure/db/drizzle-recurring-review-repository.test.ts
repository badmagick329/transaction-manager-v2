import { expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq, sql } from "drizzle-orm";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { schema } from "./schema";
import type { RecurringPaymentInput } from "../../app/recurring-payments";
import { DrizzleRecurringPaymentRepository } from "./drizzle-recurring-payment-repository";
import { DrizzleRecurringReviewRepository } from "./drizzle-recurring-review-repository";
import { accounts, cashFlowExclusions, recurringPayments, recurringReviewDecisions, sources, transactions } from "./schema";
import { createRecurringAgentRoutes } from "../http/recurring-agent-routes";
import { recurringInputSchema, type ReviewDecisionInput } from "../../app/contracts/recurring-review";
import { canonical } from "../../app/recurring-review";

function fixture(amounts = [999, 999, 999]) {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  const source = db.insert(sources).values({ slug: "test", name: "Test", kind: "bank" }).returning().get();
  const account = db.insert(accounts).values({ sourceId: source.id, name: "Current", kind: "bank_account", currencyCode: "GBP" }).returning().get();
  const rows = db.insert(transactions).values(amounts.map((amount, index) => ({ sourceId: source.id, accountId: account.id, transactionDate: `2026-0${index + 1}-01`, description: "STREAMING SERVICE", amountMinor: -amount, currencyCode: "GBP", transactionType: "purchase" as const, economicType: "expense" as const }))).returning().all();
  const repository = new DrizzleRecurringReviewRepository(db);
  const payments = new DrizzleRecurringPaymentRepository(db);
  function decision(overrides: Partial<ReviewDecisionInput> = {}): ReviewDecisionInput {
    const queue = repository.queue();
    const item = queue.items.find(i => i.kind === "suggestion")!;
    return { requestId: crypto.randomUUID(), itemId: item.id, evidenceVersion: queue.evidenceVersion, disposition: "apply", reasoning: "A named streaming subscription with consecutive monthly charges.", evidenceTransactionIds: rows.map(r => r.id), action: { type: "create", input: recurringInputSchema.parse(item.suggestion) as RecurringPaymentInput }, ...overrides };
  }
  return { db, repository, payments, decision, rows, account, source };
}

test("clear new payments apply atomically, survive reload, and identical retries do not duplicate", () => {
  const f = fixture();
  const input = f.decision();
  const result = f.repository.submit(input);
  expect(result.status).toBe("applied");
  expect(result.appliedBy).toBe("agent");
  expect(result.evidence).toHaveLength(3);
  expect(f.payments.snapshotSync().payments).toHaveLength(1);
  expect(new DrizzleRecurringReviewRepository(f.db).submit(input)).toEqual(result);
  expect(() => f.repository.submit({ ...input, reasoning: "A different explanation for the same request identifier." })).toThrow("requestId");
  expect(f.repository.queue().decisions).toHaveLength(1);
});

test("variable amounts and altered detected rules become proposals, never automatic changes", () => {
  const f = fixture([999, 1099, 1099]);
  const result = f.repository.submit(f.decision());
  expect(result.status).toBe("pending");
  expect(result.automaticBlockers).toContain("Amounts vary.");
  expect(f.payments.snapshotSync().payments).toHaveLength(0);
  const other = fixture();
  const input = other.decision();
  if (input.action.type !== "create") throw new Error("fixture");
  input.action.input.matchMode = "starts_with";
  expect(other.repository.submit(input).status).toBe("pending");
});

test("broad matches that collide with another payment cannot be automatically accepted", () => {
  const f = fixture();
  const input = f.decision();
  if (input.action.type !== "create") throw new Error("fixture");
  f.payments.saveSync({ ...input.action.input, name: "Another service", description: "STREAMING SERVICE EXTRA" });
  f.db.insert(transactions).values({ sourceId: f.source.id, accountId: f.account.id, transactionDate: "2026-03-01", description: "STREAMING SERVICE EXTRA", amountMinor: -999, currencyCode: "GBP", transactionType: "purchase", economicType: "expense" }).run();
  const fresh = f.decision();
  if (fresh.action.type !== "create") throw new Error("fixture");
  fresh.action.input.matchMode = "starts_with";
  const preview = f.repository.assess(fresh);
  expect(preview.automaticBlockers.length).toBeGreaterThan(0);
  expect(f.repository.submit(fresh).status).toBe("pending");
});

test("existing billing changes require approval and preserve earlier billing history", () => {
  const f = fixture();
  const created = f.repository.submit(f.decision());
  const payment = f.payments.snapshotSync().payments[0];
  const queue = f.repository.queue();
  const input: ReviewDecisionInput = { requestId: "billing", itemId: `payment:${payment.id}`, evidenceVersion: queue.evidenceVersion, disposition: "apply", reasoning: "Proposed new monthly price, requiring approval before changing billing.", evidenceTransactionIds: [f.rows[2].id], action: { type: "method", input: { paymentId: payment.id, accountId: payment.accountId, description: payment.description, matchMode: "exact", effectiveDate: "2026-04-01", anchorDate: null, frequency: null, amountMinor: 1099 } } };
  const proposal = f.repository.submit(input);
  expect(proposal.status).toBe("pending");
  expect(f.payments.snapshotSync().methods).toHaveLength(0);
  const preview = f.repository.preview(proposal.id);
  const applied = f.repository.approve(proposal.id, preview.evidenceVersion, preview.previewToken);
  expect(applied.appliedBy).toBe("human");
  expect(f.payments.snapshotSync().payments[0].amountMinor).toBe(999);
  expect(f.payments.snapshotSync().methods[0].amountMinor).toBe(1099);
  expect(() => f.repository.undo(created.id)).toThrow("later changes");
  f.repository.undo(proposal.id);
  expect(f.payments.snapshotSync().methods).toHaveLength(0);
});

test("stale submission and stale approval are rejected and exclusions invalidate evidence", () => {
  const f = fixture();
  const input = f.decision({ disposition: "propose" });
  const proposal = f.repository.submit(input);
  const preview = f.repository.preview(proposal.id);
  f.db.update(transactions).set({ amountMinor: -1299 }).where(eq(transactions.id, f.rows[2].id)).run();
  expect(() => f.repository.approve(proposal.id, preview.evidenceVersion, preview.previewToken)).toThrow("Evidence changed");
  expect(f.repository.queue().decisions[0].status).toBe("outdated");
  expect(() => f.repository.submit({ ...input, requestId: "stale", itemId: "other" })).toThrow("Evidence changed");
  const fresh = f.repository.preview(proposal.id);
  expect(fresh.evidenceVersion).not.toBe(preview.evidenceVersion);
  f.db.insert(cashFlowExclusions).values({ transactionId: f.rows[0].id }).run();
  expect(() => f.repository.preview(proposal.id)).toThrow("excluded");
});

test("dismissing a proposal does not dismiss the payment or repeat the agent's decision", () => {
  const f = fixture();
  const input = f.decision({ disposition: "propose" });
  const proposal = f.repository.submit(input);
  f.repository.dismiss(proposal.id);
  expect(f.payments.snapshotSync().payments).toHaveLength(0);
  expect(f.repository.queue().items[0].alreadyReviewed).toBe(true);
  expect(() => f.repository.submit({ ...input, requestId: "new-request" })).toThrow("already has a review decision");
  expect(() => f.repository.approve(proposal.id, input.evidenceVersion, "")).toThrow("resolved");
});

test("dismissing an outdated proposal suppresses current evidence but permits later changes", () => {
  const f = fixture();
  f.repository.submit(f.decision());
  const payment = f.payments.snapshotSync().payments[0];
  const input: ReviewDecisionInput = {
    requestId: "outdated-dismissal", itemId: `payment:${payment.id}`,
    evidenceVersion: f.repository.queue().evidenceVersion, disposition: "propose",
    reasoning: "A possible billing change requires the user's review.",
    evidenceTransactionIds: [f.rows[2].id],
    action: { type: "method", input: { paymentId: payment.id, accountId: payment.accountId,
      description: payment.description, matchMode: "exact", effectiveDate: "2026-03-01",
      anchorDate: null, frequency: null, amountMinor: 1099 } },
  };
  const proposal = f.repository.submit(input);
  f.db.update(transactions).set({ amountMinor: -1199 }).where(eq(transactions.id, f.rows[2].id)).run();
  expect(f.repository.queue().decisions.find(d => d.id === proposal.id)!.status).toBe("outdated");
  const dismissed = f.repository.dismiss(proposal.id);
  const current = f.repository.queue();
  expect(current.items.find(i => i.id === input.itemId)!.alreadyReviewed).toBe(true);
  expect(() => f.repository.submit({ ...input, requestId: "immediate-repeat", evidenceVersion: current.evidenceVersion })).toThrow("already has a review decision");
  expect(f.payments.snapshotSync().methods).toHaveLength(0);

  f.db.update(transactions).set({ amountMinor: -1299 }).where(eq(transactions.id, f.rows[2].id)).run();
  expect(f.repository.dismiss(proposal.id)).toEqual(dismissed);
  const later = f.repository.queue();
  expect(later.items.find(i => i.id === input.itemId)!.alreadyReviewed).toBe(false);
  expect(f.repository.submit({ ...input, requestId: "later-evidence", evidenceVersion: later.evidenceVersion }).status).toBe("pending");
});

test("edited proposals require a fresh preview and record the accepted edits", () => {
  const f = fixture();
  const input = f.decision({ disposition: "propose" });
  const proposal = f.repository.submit(input);
  const action = structuredClone(input.action);
  if (action.type !== "create") throw new Error("fixture");
  action.input.name = "My streaming subscription";
  const oldPreview = f.repository.preview(proposal.id);
  expect(() => f.repository.approve(proposal.id, oldPreview.evidenceVersion, oldPreview.previewToken, action)).toThrow("edits changed");
  const preview = f.repository.preview(proposal.id, action);
  const result = f.repository.approve(proposal.id, preview.evidenceVersion, preview.previewToken, action);
  expect(result.request.action).toEqual(input.action);
  expect(result.appliedAction).toEqual(action);
  expect(f.payments.snapshotSync().payments[0].name).toBe(action.input.name);
  expect(f.repository.approve(proposal.id, preview.evidenceVersion, preview.previewToken, action)).toEqual(result);
});

test("undo removes only agent tracking and preserves imported evidence; later edits block undo", () => {
  const f = fixture();
  const original = f.payments.snapshotSync().transactions;
  const result = f.repository.submit(f.decision());
  f.repository.undo(result.id);
  expect(f.payments.snapshotSync().payments).toHaveLength(0);
  expect(f.payments.snapshotSync().transactions).toEqual(original);
  expect(f.repository.undo(result.id).status).toBe("undone");
  expect(f.repository.queue().items[0].alreadyReviewed).toBe(true);
  const other = fixture();
  const created = other.repository.submit(other.decision());
  const payment = other.payments.snapshotSync().payments[0];
  other.payments.saveSync({ ...payment, name: "User edited name" }, payment.id);
  expect(() => other.repository.undo(created.id)).toThrow("later changes");
  expect(other.payments.snapshotSync().payments[0].name).toBe("User edited name");
});

test("an audit write failure rolls back the payment and decision together", () => {
  const f = fixture();
  f.db.run(sql.raw("CREATE TRIGGER fail_review_update BEFORE UPDATE ON recurring_review_decisions BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"));
  expect(() => f.repository.submit(f.decision())).toThrow("audit unavailable");
  expect(f.db.select().from(recurringPayments).all()).toHaveLength(0);
  expect(f.db.select().from(recurringReviewDecisions).all()).toHaveLength(0);
});

test("HTTP discovery, preview and input validation work without starting a server", async () => {
  const f = fixture();
  const routes = createRecurringAgentRoutes(f.repository);
  const post = (path: keyof typeof routes, body: unknown) => routes[path]["POST"](new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) }));
  const guide = await (await routes["/api/agent"].GET(new Request("http://localhost/api/agent"))).json();
  expect(guide.schemas.MethodInput).toBeDefined();
  const input = f.decision();
  const preview = await post("/api/agent/recurring-payments/preview", input);
  expect(preview.status).toBe(200);
  expect(f.payments.snapshotSync().payments).toHaveLength(0);
  expect((await post("/api/agent/recurring-payments/decisions", { ...input, evidenceTransactionIds: [9999] })).status).toBe(400);
  if (input.action.type !== "create") throw new Error("fixture");
  expect((await post("/api/agent/recurring-payments/decisions", { ...input, action: { ...input.action, input: { ...input.action.input, anchorDate: "2026-02-30" } } })).status).toBe(400);
  expect((await post("/api/agent/recurring-payments/decisions", { ...input, approved: true })).status).toBe(400);
  expect((await post("/api/agent/recurring-payments/decisions", input)).status).toBe(200);
  expect((await post("/api/agent/recurring-payments/decisions", { ...input, requestId: "stale" })).status).toBe(409);
});

test("evidence serialization ignores database row order", () => {
  expect(canonical({ rows: [{ id: 2, value: 3 }, { id: 1, value: 4 }] })).toBe(canonical({ rows: [{ value: 4, id: 1 }, { value: 3, id: 2 }] }));
});

test("approved transaction reassignment can be undone without losing its previous explicit link", () => {
  const f = fixture();
  f.repository.submit(f.decision());
  const first = f.payments.snapshotSync().payments[0];
  const second = f.payments.saveSync({ ...recurringInputSchema.parse(first) as RecurringPaymentInput, name: "Other service", description: "OTHER SERVICE" });
  f.payments.linkSync(f.rows[0].id, first.id);
  const queue = f.repository.queue();
  const proposal = f.repository.submit({ requestId: "link", itemId: `payment:${second.id}`, evidenceVersion: queue.evidenceVersion, disposition: "apply", reasoning: "This charge belongs to the other service; ask the user to confirm.", evidenceTransactionIds: [f.rows[0].id], action: { type: "link", paymentId: second.id, transactionId: f.rows[0].id } });
  expect(proposal.status).toBe("pending");
  const preview = f.repository.preview(proposal.id);
  expect(preview.preview.reassignedFrom).toBe(first.id);
  f.repository.approve(proposal.id, preview.evidenceVersion, preview.previewToken);
  expect(f.payments.snapshotSync().links[0].paymentId).toBe(second.id);
  f.repository.undo(proposal.id);
  expect(f.payments.snapshotSync().links[0].paymentId).toBe(first.id);
});

test("an existing payment's status or matching edits stay pending and dismissal preserves the record", () => {
  const f = fixture();
  f.repository.submit(f.decision());
  const payment = f.payments.snapshotSync().payments[0];
  const queue = f.repository.queue();
  const proposal = f.repository.submit({ requestId: "status", itemId: `payment:${payment.id}`, evidenceVersion: queue.evidenceVersion, disposition: "apply", reasoning: "A missing payment might indicate cancellation, so ask the user.", evidenceTransactionIds: [f.rows[2].id], action: { type: "update", paymentId: payment.id, input: { ...recurringInputSchema.parse(payment) as RecurringPaymentInput, status: "cancelled" } } });
  expect(proposal.status).toBe("pending");
  f.repository.dismiss(proposal.id);
  expect(f.payments.snapshotSync().payments[0].status).toBe("active");
  expect(f.repository.queue().items.find(i => i.id === `payment:${payment.id}`)?.alreadyReviewed).toBe(true);
  f.db.insert(transactions).values({ sourceId: f.source.id, accountId: f.account.id, transactionDate: "2026-04-01", description: payment.description, amountMinor: -1199, currencyCode: "GBP", transactionType: "purchase", economicType: "expense" }).run();
  const later = f.repository.queue();
  expect(later.items.find(i => i.id === `payment:${payment.id}`)?.alreadyReviewed).toBe(false);
  expect(f.repository.submit({ ...proposal.request, requestId: "later-change", evidenceVersion: later.evidenceVersion, disposition: "propose" }).status).toBe("pending");
});


test("discovery creates one reviewed ChatGPT history across accounts and descriptions, with undo", () => {
  const f = fixture();
  const second = f.db.insert(accounts).values({ sourceId: f.source.id, name: "Other card", kind: "bank_account", currencyCode: "GBP" }).returning().get();
  f.db.update(transactions).set({ description: "INT'L 123 OPENAI CHATGPT USD 24.00 @ 1.33 Visa Rate" }).where(eq(transactions.id, f.rows[0].id)).run();
  f.db.update(transactions).set({ description: "ChatGPT Subscription", accountId: second.id }).where(eq(transactions.id, f.rows[1].id)).run();
  f.db.update(transactions).set({ description: "Openai *Chatgpt Subscr, Openai.com", accountId: second.id }).where(eq(transactions.id, f.rows[2].id)).run();
  const q = f.repository.queue();
  expect(q.suggestions).toHaveLength(0);
  const input: ReviewDecisionInput = { requestId: crypto.randomUUID(), itemId: `discovery:${f.rows[0].id}`, evidenceVersion: q.evidenceVersion, disposition: "apply", reasoning: "Monthly ChatGPT history with description and account changes; explicit historical evidence reviewed together.", evidenceTransactionIds: f.rows.map(t => t.id), action: { type: "create", input: { name: "ChatGPT", kind: "subscription", accountId: f.account.id, currencyCode: "GBP", description: "INT'L 123 OPENAI CHATGPT USD 24.00 @ 1.33 VISA RATE", matchMode: "exact", amountMinor: 999, frequency: "monthly", anchorDate: "2026-01-01", status: "active" }, methods: [{ accountId: second.id, description: "OPENAI *CHATGPT SUBSCR, OPENAI.COM", matchMode: "exact", effectiveDate: "2026-03-01", anchorDate: null, frequency: null, amountMinor: null }], transactionIds: f.rows.map(t => t.id) } };
  const decision = f.repository.submit(input);
  expect(decision.status).toBe("pending");
  const preview = f.repository.preview(decision.id);
  expect(preview.preview.matching.rows.filter(t => t.outcome === "Included")).toHaveLength(3);
  f.repository.approve(decision.id, preview.evidenceVersion, preview.previewToken);
  expect(f.payments.snapshotSync().methods).toHaveLength(1);
  expect(f.payments.snapshotSync().links).toHaveLength(3);
  f.repository.undo(decision.id);
  expect(f.payments.snapshotSync().payments).toHaveLength(0);
  expect(f.payments.snapshotSync().links).toHaveLength(0);
});

test("cross-account detected history cannot be automatically reduced to the latest account", () => {
  const f = fixture();
  const second = f.db.insert(accounts).values({ sourceId: f.source.id, name: "Other", kind: "bank_account", currencyCode: "GBP" }).returning().get();
  f.db.update(transactions).set({ accountId: second.id }).where(eq(transactions.id, f.rows[2].id)).run();
  const result = f.repository.submit(f.decision());
  expect(result.status).toBe("pending");
  expect(result.automaticBlockers).toContain("Some supporting history is not included by this setup.");
});


test("inspection reports persist partial scope and unresolved cases without claiming a full audit", () => {
  const f = fixture();
  const input = { requestId: "partial-report", evidenceVersion: f.repository.queue().evidenceVersion, inspectedTransactionIds: [f.rows[0].id], unresolved: [{ transactionIds: [f.rows[0].id], reason: "Need the older statements." }], summary: "Only the first transaction was inspected." };
  const report = f.repository.report(input);
  expect(report.accounts[0]).toMatchObject({ inspectedCount: 1, eligibleCount: 3 });
  expect(f.repository.report(input)).toEqual(report);
  expect(new DrizzleRecurringReviewRepository(f.db).queue().latestReport).toEqual(report);
  expect(() => f.repository.report({ ...input, summary: "Different" })).toThrow("requestId");
  expect(() => f.repository.report({ ...input, requestId: "bad", unresolved: [{ transactionIds: [f.rows[1].id], reason: "Not inspected" }] })).toThrow("inspected");
  expect(() => f.repository.report({ ...input, requestId: "stale", evidenceVersion: "0".repeat(64) })).toThrow("Evidence changed");
});

test("complete existing-payment history edits need approval and undo together", () => {
  const f = fixture();
  const created = f.repository.submit(f.decision());
  const payment = f.payments.snapshotSync().payments[0];
  const q = f.repository.queue();
  const input: ReviewDecisionInput = { requestId: crypto.randomUUID(), itemId: `payment:${payment.id}`, evidenceVersion: q.evidenceVersion, disposition: "apply", reasoning: "Record dated billing changes and explicit historical evidence together.", evidenceTransactionIds: f.rows.map(t => t.id), action: { type: "update", paymentId: payment.id, input: payment, methods: [{ accountId: f.account.id, description: payment.description, matchMode: "exact", effectiveDate: "2026-02-01", anchorDate: null, frequency: null, amountMinor: 1099 }], transactionIds: [f.rows[0].id] } };
  const result = f.repository.submit(input);
  expect(result.status).toBe("pending");
  const preview = f.repository.preview(result.id);
  f.repository.approve(result.id, preview.evidenceVersion, preview.previewToken);
  expect(f.payments.snapshotSync().methods).toHaveLength(1);
  f.repository.undo(result.id);
  expect(f.payments.snapshotSync().methods).toHaveLength(0);
  expect(f.payments.snapshotSync().links).toHaveLength(0);
  expect(f.payments.snapshotSync().payments).toHaveLength(1);
});

test("related merchant charges remain visible and block fragmentary automatic creation", () => {
  const f = fixture();
  f.db.insert(transactions).values({ sourceId: f.source.id, accountId: f.account.id, transactionDate: "2026-03-10", description: "EXTRA STREAMING SERVICE", amountMinor: -7284, currencyCode: "GBP", transactionType: "purchase", economicType: "expense" }).run();
  const result = f.repository.submit(f.decision());
  expect(result.status).toBe("pending");
  expect(result.preview.relatedUnmatched).toHaveLength(1);
});


test("contains proposals validate, persist after approval, and require human review", () => {
  const f = fixture();
  const input = f.decision();
  if (input.action.type !== "create") throw new Error("fixture");
  input.action.input.matchMode = "contains";
  expect(recurringInputSchema.parse(input.action.input).matchMode).toBe("contains");
  const decision = f.repository.submit(input);
  expect(decision.status).toBe("pending");
  const preview = f.repository.preview(decision.id);
  f.repository.approve(decision.id, preview.evidenceVersion, preview.previewToken);
  expect(new DrizzleRecurringPaymentRepository(f.db).snapshotSync().payments[0].matchMode).toBe("contains");
});


test("transaction decisions invalidate review evidence and protect annotated payments from removal", async () => {
  const f = fixture();
  const applied = f.repository.submit(f.decision());
  const paymentId = f.payments.snapshotSync().payments[0].id;
  const before = f.repository.queue().evidenceVersion;
  const input = { paymentId, transactionId: f.rows[2].id, oneOff: false, priceWarningDismissed: true };
  await f.payments.setTransactionDecision(input);
  expect(f.repository.queue().evidenceVersion).not.toBe(before);
  expect(() => f.repository.undo(applied.id)).toThrow("transaction decisions");
  await f.payments.setTransactionDecision({ ...input, priceWarningDismissed: false });
  expect(f.payments.snapshotSync().transactionDecisions).toHaveLength(0);
  expect(f.repository.undo(applied.id).status).toBe("undone");
});
