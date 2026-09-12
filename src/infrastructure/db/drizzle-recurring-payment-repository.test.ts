import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { DrizzleRecurringPaymentRepository } from "./drizzle-recurring-payment-repository";
import { accounts, cashFlowExclusions, sources, transactions } from "./schema";
import { createRecurringRoutes } from "../http/recurring-routes";
import { recurringOverview } from "../../app/recurring-payments";
import { DrizzleDashboardQueryRepository } from "./drizzle-dashboard-query-repository";

test("migration, persistence, exclusion changes, linking, and route validation", async () => {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "recurring-test-")), "app.db"));
  migrate(db, { migrationsFolder: "drizzle" });
  const source = db.insert(sources).values({ slug: "test", name: "Test", kind: "bank" }).returning().get();
  const account = db.insert(accounts).values({ sourceId: source.id, name: "Current", kind: "bank_account", currencyCode: "GBP" }).returning().get();
  const rows = db.insert(transactions).values(["2026-01-01", "2026-02-01", "2026-03-01"].map(transactionDate => ({ sourceId: source.id, accountId: account.id, transactionDate, description: "STREAMING", amountMinor: -999, currencyCode: "GBP", transactionType: "purchase" as const, economicType: "expense" as const }))).returning().all();
  const repository = new DrizzleRecurringPaymentRepository(db);
  const dashboard = new DrizzleDashboardQueryRepository(db);
  expect((await dashboard.listTransactions())[0].recurringPayment).toBeNull();
  const routes = createRecurringRoutes(repository);
  const post = (body: unknown) => routes["/api/recurring-payments"].POST(new Request("http://localhost/api/recurring-payments", { method: "POST", body: JSON.stringify(body) }));
  const suggestion = recurringOverview(await repository.snapshot()).suggestions[0];
  expect(suggestion.frequency).toBe("monthly");
  expect((await post({ ...suggestion, anchorDate: "2026-02-30" })).status).toBe(400);
  expect((await post({ ...suggestion, amountMinor: -999 })).status).toBe(400);
  expect((await post({ ...suggestion, accountId: 999 })).status).toBe(400);
  const response = await post(suggestion);
  expect(response.status).toBe(200);
  const saved = await response.json();
  await repository.save({ ...saved, name: "Streaming service", status: "paused" }, saved.id);
  expect((await new DrizzleRecurringPaymentRepository(db).snapshot()).payments[0].name).toBe("Streaming service");
  expect((await dashboard.listTransactions()).every(t => t.recurringPayment?.id === saved.id && t.recurringPayment.name === "Streaming service")).toBe(true);
  expect(recurringOverview(await repository.snapshot()).suggestions).toHaveLength(0);
  db.insert(cashFlowExclusions).values({ transactionId: rows[1].id }).run();
  db.update(transactions).set({ economicType: "transfer" }).where(eq(transactions.id, rows[2].id)).run();
  expect(recurringOverview(await repository.snapshot()).payments[0].transactions).toHaveLength(1);
  const afterExclusion = await dashboard.listTransactions();
  expect(afterExclusion.find(t => t.id === rows[1].id).recurringPayment).toBeNull();
  expect(afterExclusion.find(t => t.id === rows[2].id).recurringPayment).toBeNull();
  await expect(repository.link(rows[1].id, saved.id)).rejects.toThrow("eligible expense");
  await repository.link(rows[0].id, saved.id);
  expect((await repository.snapshot()).links).toEqual([{ transactionId: rows[0].id, paymentId: saved.id }]);
  const newAccount = db.insert(accounts).values({ sourceId: source.id, name: "HSBC", kind: "bank_account", currencyCode: "GBP" }).returning().get();
  const method = { matchMode: "exact", anchorDate: null, frequency: null, amountMinor: null, paymentId: saved.id, accountId: newAccount.id, description: "STREAMING HSBC", effectiveDate: "2026-04-01" };
  const change = (body: unknown) => routes["/api/recurring-payments/method"].POST(new Request("http://localhost/api/recurring-payments/method", { method: "POST", body: JSON.stringify(body) }));
  expect((await change({ ...method, effectiveDate: "2026-02-30" })).status).toBe(400);
  expect((await change({ ...method, accountId: 999 })).status).toBe(400);
  expect((await change(method)).status).toBe(200);
  db.insert(transactions).values({ sourceId: source.id, accountId: newAccount.id, transactionDate: "2026-04-01", description: "STREAMING HSBC", amountMinor: -999, currencyCode: "GBP", transactionType: "purchase", economicType: "expense" }).run();
  const reloaded = await new DrizzleRecurringPaymentRepository(db).snapshot();
  expect(reloaded.methods).toHaveLength(1);
  expect(recurringOverview(reloaded).payments[0].transactions).toHaveLength(2);
  expect((await dashboard.listTransactions({ description: "STREAMING HSBC" }))[0].recurringPayment).toEqual({ id: saved.id, name: "Streaming service" });
  expect(reloaded.payments[0].accountId).toBe(account.id);
  expect((await post({ ...saved, accountId: newAccount.id })).status).toBe(400);
  expect((await change({ ...method, description: "STREAMING corrected" })).status).toBe(200);
  expect((await repository.snapshot()).methods).toHaveLength(1);
  expect((await repository.snapshot()).methods[0].description).toBe("STREAMING CORRECTED");
  expect((await change({ ...method, previousEffectiveDate: method.effectiveDate, effectiveDate: "2026-03-31" })).status).toBe(200);
  expect((await repository.snapshot()).methods).toHaveLength(1);
  expect((await repository.snapshot()).methods[0].effectiveDate).toBe("2026-03-31");
  const previewRequest = new Request("http://localhost/api/recurring-payments/method/preview", { method: "POST", body: JSON.stringify({ ...method, effectiveDate: "2026-03-31", previousEffectiveDate: "2026-03-31", description: "STREAMING", matchMode: "starts_with", anchorDate: "2026-04-01", amountMinor: 1299 }) });
  const methodPreview = await routes["/api/recurring-payments/method/preview"].POST(previewRequest);
  expect(methodPreview.status).toBe(200);
  expect((await methodPreview.json()).rows.some(t => t.description === "STREAMING HSBC" && t.outcome === "Included")).toBe(true);
  expect((await repository.snapshot()).methods[0].matchMode).toBe("exact");
  expect((await change({ ...method, effectiveDate: "2026-03-31", description: "STREAMING", matchMode: "starts_with", anchorDate: "2026-04-01", amountMinor: 1299 })).status).toBe(200);
  expect((await repository.snapshot()).methods[0]).toMatchObject({ matchMode: "starts_with", anchorDate: "2026-04-01", amountMinor: 1299 });
  expect((await change({ ...method, matchMode: "contains" })).status).toBe(200);
  expect((await change({ ...method, matchMode: "regex" })).status).toBe(400);
  expect((await change({ ...method, description: " " })).status).toBe(400);
  db.$client.close();
});


test("transaction decisions persist, validate ownership, and can be reversed through the API", async () => {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "recurring-decisions-")), "app.db"));
  migrate(db, { migrationsFolder: "drizzle" });
  try {
    const source = db.insert(sources).values({ slug: "test", name: "Test", kind: "bank" }).returning().get();
    const account = db.insert(accounts).values({ sourceId: source.id, name: "Current", kind: "bank_account", currencyCode: "GBP" }).returning().get();
    const charge = db.insert(transactions).values({ sourceId: source.id, accountId: account.id, transactionDate: "2026-04-01", description: "GYM", amountMinor: -4146, currencyCode: "GBP", transactionType: "purchase", economicType: "expense" }).returning().get();
    const repository = new DrizzleRecurringPaymentRepository(db);
    const payment = await repository.save({ name: "Gym", kind: "subscription", accountId: account.id, currencyCode: "GBP", description: "GYM", matchMode: "exact", amountMinor: 2899, frequency: "monthly", anchorDate: "2026-04-01", status: "active" });
    const route = createRecurringRoutes(repository)["/api/recurring-payments/transaction-decision"];
    const post = (body: unknown) => route.POST(new Request("http://localhost/api/recurring-payments/transaction-decision", { method: "POST", body: JSON.stringify(body) }));
    const decision = { paymentId: payment.id, transactionId: charge.id, oneOff: false, priceWarningDismissed: true };
    expect((await post({ ...decision, oneOff: "yes" })).status).toBe(400);
    expect((await post({ ...decision, paymentId: 999 })).status).toBe(400);
    expect((await post({ ...decision, transactionId: 999 })).status).toBe(400);
    expect((await post(decision)).status).toBe(200);
    const reloaded = new DrizzleRecurringPaymentRepository(db);
    expect((await reloaded.snapshot()).transactionDecisions).toEqual([decision]);
    expect(recurringOverview(await reloaded.snapshot()).payments[0]).toMatchObject({ priceChanged: false, nextDate: "2026-05-01" });
    expect((await post({ ...decision, oneOff: true, priceWarningDismissed: false })).status).toBe(200);
    expect(recurringOverview(await reloaded.snapshot()).payments[0]).toMatchObject({ priceChanged: false, nextDate: "2026-04-01" });
    expect((await reloaded.snapshot()).transactions[0].amountMinor).toBe(-4146);
    expect((await post({ ...decision, priceWarningDismissed: false })).status).toBe(200);
    expect(recurringOverview(await reloaded.snapshot()).payments[0]).toMatchObject({ priceChanged: true, nextDate: "2026-05-01" });
    db.insert(cashFlowExclusions).values({ transactionId: charge.id }).run();
    expect((await post(decision)).status).toBe(400);
  } finally { db.$client.close(); }
});


test("spending control is explicitly chosen, persists across billing edits, and validates requests", async () => {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "recurring-control-")), "app.db"));
  migrate(db, { migrationsFolder: "drizzle" });
  try {
    const source = db.insert(sources).values({ slug: "test", name: "Test", kind: "bank" }).returning().get();
    const account = db.insert(accounts).values({ sourceId: source.id, name: "Current", kind: "bank_account", currencyCode: "GBP" }).returning().get();
    const repository = new DrizzleRecurringPaymentRepository(db);
    const payment = await repository.save({ name: "Gym", kind: "subscription", accountId: account.id, currencyCode: "GBP", description: "GYM", matchMode: "exact", amountMinor: 2899, frequency: "monthly", anchorDate: "2026-04-01", status: "active" });
    const post = (body: unknown) => createRecurringRoutes(repository)["/api/recurring-payments/spending-control"].POST(new Request("http://localhost/api/recurring-payments/spending-control", { method: "POST", body: JSON.stringify(body) }));
    expect(recurringOverview(await repository.snapshot()).payments[0].control).toBe("unclassified");
    expect((await post({ paymentId: payment.id, control: "reducible" })).status).toBe(200);
    await repository.changeMethod({ paymentId: payment.id, accountId: account.id, description: "GYM", matchMode: "exact", amountMinor: 2999, frequency: null, anchorDate: null, effectiveDate: "2026-05-01" });
    expect(recurringOverview(await new DrizzleRecurringPaymentRepository(db).snapshot()).payments[0].control).toBe("reducible");
    expect((await post({ paymentId: payment.id, control: "whatever" })).status).toBe(400);
    expect((await post({ paymentId: 9999, control: "fixed" })).status).toBe(400);
    expect((await post({ paymentId: payment.id, control: "unclassified" })).status).toBe(200);
    expect((await repository.snapshot()).spendingControls).toEqual([]);
  } finally { db.$client.close(); }
});
