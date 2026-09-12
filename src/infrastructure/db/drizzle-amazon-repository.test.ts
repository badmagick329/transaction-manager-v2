import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "./client";
import { DrizzleAmazonRepository } from "./drizzle-amazon-repository";
import { DrizzleImportRepository } from "./drizzle-import-repository";
import { DrizzleDashboardQueryRepository } from "./drizzle-dashboard-query-repository";
import { accounts, sources, transactions, amazonRevisions, amazonOrders, amazonHistory } from "./schema";
import { sampleFile, sampleOrder } from "../../app/amazon-order-fixtures";
import { candidates } from "../../app/amazon-orders";
import { queryAmazonOrder, queryAmazonOrders } from "../../app/use-cases/query-amazon-orders";
import { createAmazonRoutes } from "../http/amazon-routes";
import { startWatchedImports } from "../imports/watched-imports";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "amazon-test-"));
  const db = createDb(join(root, "app.db")); migrate(db, { migrationsFolder: "drizzle" });
  const source = db.insert(sources).values({ slug: "sample", name: "Sample bank", kind: "bank" }).returning().get();
  const account = db.insert(accounts).values({ sourceId: source.id, name: "Current", kind: "bank_account", currencyCode: "GBP" }).returning().get();
  const bank = (amountMinor: number) => db.insert(transactions).values({ sourceId: source.id, accountId: account.id, transactionDate: "2026-08-09", description: "Amazon Marketplace", amountMinor, currencyCode: "GBP", transactionType: amountMinor < 0 ? "purchase" : "refund", economicType: amountMinor < 0 ? "expense" : "income" }).returning().get();
  const repository = new DrizzleAmazonRepository(db);
  const ingest = (file = sampleFile(), hash = "one") => repository.importFile({ fileName: `${hash}.json`, fileHash: hash, importFile: file });
  return { db, root, repository, ingest, bank, account };
}

test("migrations, imports, duplicate snapshots, reviewed links and unchanged cash flow", async () => {
  const { db, repository, ingest, bank } = setup();
  const t = bank(-2619);
  const dashboard = new DrizzleDashboardQueryRepository(db);
  const before = await dashboard.summarizeTransactions();
  await ingest(); await ingest(); await ingest(sampleFile(), "second");
  expect(db.select().from(amazonOrders).all()).toHaveLength(1);
  expect(db.select().from(amazonRevisions).all()).toHaveLength(1);
  expect(candidates(repository.snapshot())).toHaveLength(1);
  const orderId = repository.snapshot().orders[0]!.id;
  const link = { orderId, transactionId: t.id, kind: "purchase" as const, amountMinor: 2619, allocations: [], status: "confirmed" as const };
  repository.reviewLink(link);
  expect(queryAmazonOrder(repository, orderId).links[0]!.breakdown.items).toHaveLength(2);
  expect((await dashboard.listTransactions())[0]!.amazonOrderCount).toBe(1);
  expect(await dashboard.summarizeTransactions()).toEqual(before);
  expect(db.select().from(transactions).all()).toHaveLength(1);
  repository.reviewLink({ ...link, status: "unlinked" });
  repository.reviewLink({ ...link, status: "rejected" });
  expect(candidates(repository.snapshot())).toHaveLength(0);
  expect(db.select().from(amazonHistory).all().length).toBeGreaterThan(3);
});

test("refund additions preserve confirmation; conflicts require review and then invalidate affected links", async () => {
  const { db, repository, ingest, bank } = setup();
  const t = bank(-2619); await ingest();
  const orderId = repository.snapshot().orders[0]!.id;
  repository.reviewLink({ orderId, transactionId: t.id, kind: "purchase", amountMinor: 2619, allocations: [], status: "confirmed" });
  await ingest(sampleFile([sampleOrder({ refundMinor: 399, items: [{ ...sampleOrder().items![0]! }, { ...sampleOrder().items![1]!, returned: true }] })]), "refund");
  expect(repository.snapshot().links[0]!.status).toBe("confirmed");
  expect(queryAmazonOrder(repository, orderId).refundRemainingMinor).toBe(399);
  const refund = bank(399);
  repository.reviewLink({ orderId, transactionId: refund.id, kind: "refund", amountMinor: 399, allocations: [{ itemId: "lanyard", amountMinor: 399 }], status: "confirmed" });
  expect(queryAmazonOrder(repository, orderId).refundRemainingMinor).toBe(0);
  await ingest(sampleFile([sampleOrder({ items: [{ id: "drink", description: "Corrected description", amountMinor: 2220 }, sampleOrder().items![1]!] })]), "changed");
  const pending = db.select().from(amazonRevisions).all().find(r => r.status === "pending")!;
  expect(repository.snapshot().orders[0]!.data.items![0]!.description).not.toBe("Corrected description");
  repository.reviewRevision(pending.id, true);
  expect(repository.snapshot().orders[0]!.data.items![0]!.description).toBe("Corrected description");
  expect(repository.snapshot().orders[0]!.data.refundMinor).toBe(399);
  expect(repository.snapshot().links.every(l => l.status === "needs_review")).toBe(true);
});

test("file is atomic when a later order conflicts with preserved totals", async () => {
  const { db, ingest } = setup(); await ingest();
  const newOrder = sampleOrder({ orderId: "000-0000000-0000002" });
  const partial = sampleOrder({ items: [{ id: "different-item", description: "Conflicting item identity", amountMinor: 2619 }] });
  await expect(ingest(sampleFile([newOrder, partial]), "invalid-merge")).rejects.toThrow();
  expect(db.select().from(amazonOrders).all()).toHaveLength(1);
});

test("many-to-many allocations reject excess and invalid routes without mutating evidence", async () => {
  const { repository, ingest, bank, account } = setup();
  await ingest(); const a = bank(-1000); const b = bank(-1619);
  const orderId = repository.snapshot().orders[0]!.id;
  repository.saveMapping({ brand: "MasterCard", lastFour: "1234", accountId: account.id });
  repository.reviewLink({ orderId, transactionId: a.id, kind: "purchase", amountMinor: 1000, allocations: [], status: "confirmed" });
  repository.reviewLink({ orderId, transactionId: b.id, kind: "purchase", amountMinor: 1619, allocations: [], status: "confirmed" });
  expect(queryAmazonOrder(repository, orderId).remainingMinor).toBe(0);
  expect(queryAmazonOrder(repository, orderId).links.every(l => l.breakdown.unresolvedMinor > 0)).toBe(true);
  const extra = bank(-500);
  expect(() => repository.reviewLink({ orderId, transactionId: extra.id, kind: "purchase", amountMinor: 1, allocations: [], status: "confirmed" })).toThrow();
  const routes = createAmazonRoutes(repository);
  const response = await routes["/api/amazon-orders/link"].POST(new Request("http://localhost/api/amazon-orders/link", { method: "POST", body: JSON.stringify({ orderId }) }));
  expect(response.status).toBe(400);
  const detail = await routes["/api/amazon-orders/detail"].GET(new Request(`http://localhost/api/amazon-orders/detail?id=${orderId}`));
  expect(detail.status).toBe(200);
});

test("watcher processes Amazon, recovers processing files and reports malformed imports", async () => {
  const { db, root, repository } = setup();
  const imports = join(root, "imports");
  await mkdir(join(imports, "processing"), { recursive: true });
  await mkdir(join(imports, "incoming"), { recursive: true });
  await writeFile(join(imports, "processing", "recovered.json"), JSON.stringify(sampleFile()));
  await writeFile(join(imports, "incoming", "bad.json"), JSON.stringify({ kind: "amazon-orders", version: 99 }));
  const watcher = await startWatchedImports({ repository: new DrizzleImportRepository(db), amazonRepository: repository, rootPath: imports, logger: { info() {}, error() {} } });
  await watcher.close();
  expect(repository.snapshot().orders).toHaveLength(1);
  expect(JSON.parse(await readFile(join(imports, "processed", "recovered.json"), "utf8")).kind).toBe("amazon-orders");
  expect(JSON.parse(await readFile(join(imports, "failed", "bad.json"), "utf8")).version).toBe(99);
  expect(db.select().from(transactions).all()).toHaveLength(0);
});

test("one bank charge can fund two orders without double allocation", async () => {
  const { repository, ingest, bank } = setup();
  await ingest(sampleFile([sampleOrder(), sampleOrder({ orderId: "000-0000000-0000002" })]));
  const t = bank(-5238);
  const [first, second] = repository.snapshot().orders;
  repository.reviewLink({ orderId: first!.id, transactionId: t.id, kind: "purchase", amountMinor: 2619, allocations: [], status: "confirmed" });
  repository.reviewLink({ orderId: second!.id, transactionId: t.id, kind: "purchase", amountMinor: 2619, allocations: [], status: "confirmed" });
  expect(repository.snapshot().links).toHaveLength(2);
  expect(queryAmazonOrders(repository, { status: "matched" }).total).toBe(2);
  await ingest(sampleFile([sampleOrder({ orderId: "000-0000000-0000003" })]), "third");
  expect(() => repository.reviewLink({ orderId: repository.snapshot().orders[2]!.id, transactionId: t.id, kind: "purchase", amountMinor: 1, allocations: [], status: "confirmed" })).toThrow("transaction amount");
});

test("gift-card orders browse independently and filtering/pagination never hides them for lack of a bank row", async () => {
  const { repository, ingest } = setup();
  await ingest(sampleFile([sampleOrder(), sampleOrder({ orderId: "000-0000000-0000002", items: [{ id: "gift", description: "Gift-funded toothbrush", amountMinor: 330 }], totalMinor: 330, giftCardMinor: 330, cardMinor: 0 })]));
  const result = queryAmazonOrders(repository, { q: "toothbrush", status: "matched", from: "2026-08-09", to: "2026-08-09" });
  expect(result.total).toBe(1);
  expect(result.orders[0]!.remainingMinor).toBe(0);
  expect(candidates(repository.snapshot())).toHaveLength(0);
  expect(queryAmazonOrders(repository, { offset: 1, limit: 1 }).orders).toHaveLength(1);
  const routes = createAmazonRoutes(repository);
  expect((await routes["/api/amazon-orders"].GET(new Request("http://localhost/api/amazon-orders?from=2026-02-30"))).status).toBe(400);
});

test("rejecting a pending revision preserves accepted data, links and an auditable decision", async () => {
  const { db, repository, ingest } = setup();
  await ingest(); await ingest(sampleFile([sampleOrder({ orderDate: "2026-08-10" })]), "date-conflict");
  const pending = db.select().from(amazonRevisions).all().find(r => r.status === "pending")!;
  repository.reviewRevision(pending.id, false);
  expect(repository.snapshot().orders[0]!.data.orderDate).toBe("2026-08-09");
  expect(repository.snapshot().orders[0]!.needsReview).toBe(false);
  expect(() => repository.reviewRevision(pending.id, true)).toThrow("pending revision");
});
