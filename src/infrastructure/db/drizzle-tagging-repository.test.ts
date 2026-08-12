import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { importStandardFile } from "../../app/use-cases/import-standard-file";
import { createDashboardQueries } from "../../app/use-cases/query-dashboard";
import { createDb } from "./client";
import { DrizzleDashboardQueryRepository } from "./drizzle-dashboard-query-repository";
import { DrizzleImportRepository } from "./drizzle-import-repository";
import { DrizzleTaggingRepository } from "./drizzle-tagging-repository";
import { sources } from "./schema";

const migrationsFolder = join(process.cwd(), "drizzle");

async function createContext() {
  const root = await mkdtemp(join(tmpdir(), "transaction-tags-"));
  const db = createDb(join(root, "app.db"));
  migrate(db, { migrationsFolder });
  const importer = new DrizzleImportRepository(db);
  await importStandardFile(importer, {
    fileName: "tags.json",
    fileHash: "tags-fixture",
    importFile: {
      source: { slug: "lloyds", name: "Lloyds", kind: "bank", fileName: "statement.json", account: { externalId: null, name: "Current", currencyCode: "GBP" } },
      records: [
        { externalId: "one", transactionDate: "2026-08-01", description: "House Deposit August", amountMinor: -10000, currencyCode: "GBP", transactionType: "transfer", status: "posted", rawPayload: {} },
        { externalId: "two", transactionDate: "2026-08-02", description: "House Deposit September", amountMinor: -11000, currencyCode: "GBP", transactionType: "transfer", status: "posted", rawPayload: {} },
        { externalId: "three", transactionDate: "2026-08-03", description: "Salary", amountMinor: 200000, currencyCode: "GBP", transactionType: "transfer", status: "posted", rawPayload: {} },
      ],
    },
  });
  return { db, importer, tagging: new DrizzleTaggingRepository(db), queries: createDashboardQueries(new DrizzleDashboardQueryRepository(db)) };
}

describe("transaction tags", () => {
  test("validates names and keeps manual and automatic provenance separate", async () => {
    const { db, tagging, queries } = await createContext();
    const tag = await tagging.createTag(" House deposit ");
    await expect(tagging.createTag("house DEPOSIT")).rejects.toThrow("already exists");
    await expect(tagging.createTag("   ")).rejects.toThrow("required");
    const source = (await db.select().from(sources))[0]!;
    const [first] = await queries.listTransactions({ description: "August" });

    await tagging.setManualTag(first!.id, tag.id, true);
    const created = await tagging.saveRule({ tagId: tag.id, sourceId: source.id, direction: "outflow", matchMode: "starts_with", description: "House Deposit" });

    expect(created.affectedTransactionCount).toBe(2);
    expect((await queries.listTransactions({ description: "August" }))[0]!.tags).toEqual([{ id: tag.id, name: "House deposit", manual: true, automatic: true }]);
    expect((await queries.listTransactions({ description: "September" }))[0]!.tags).toEqual([{ id: tag.id, name: "House deposit", manual: false, automatic: true }]);

    await tagging.deleteRule(created.rule.id);
    expect((await queries.listTransactions({ description: "August" }))[0]!.tags[0]).toMatchObject({ manual: true, automatic: false });
    expect((await queries.listTransactions({ description: "September" }))[0]!.tags).toEqual([]);
  });

  test("edits rule matches, applies rules to future imports, and filters list and summary identically", async () => {
    const { db, importer, tagging, queries } = await createContext();
    const tag = await tagging.createTag("Savings");
    const source = (await db.select().from(sources))[0]!;
    const created = await tagging.saveRule({ tagId: tag.id, sourceId: source.id, direction: "outflow", matchMode: "exact", description: "House Deposit August" });
    expect((await queries.listTransactions({ tagIds: [tag.id] })).map(transaction => transaction.description)).toEqual(["House Deposit August"]);

    await tagging.saveRule({ ruleId: created.rule.id, tagId: tag.id, sourceId: source.id, direction: "outflow", matchMode: "starts_with", description: "House Deposit" });
    expect((await queries.listTransactions({ tagIds: [tag.id] })).map(transaction => transaction.description)).toEqual(["House Deposit September", "House Deposit August"]);
    expect((await queries.summarizeTransactions({ tagIds: [tag.id] }))[0]!.transactionCount).toBe(2);
    expect((await queries.listTransactions({ untagged: true })).map(transaction => transaction.description)).toEqual(["Salary"]);
    expect((await queries.listTransactions({ tagIds: [tag.id], untagged: true }))).toHaveLength(3);

    await importStandardFile(importer, {
      fileName: "future.json",
      fileHash: "future-tag-fixture",
      importFile: {
        source: { slug: "lloyds", name: "Lloyds", kind: "bank", fileName: "future.json", account: { externalId: null, name: "Current", currencyCode: "GBP" } },
        records: [{ externalId: "four", transactionDate: "2026-08-04", description: "House Deposit October", amountMinor: -12000, currencyCode: "GBP", transactionType: "transfer", status: "posted", rawPayload: {} }],
      },
    });
    expect((await queries.listTransactions({ description: "October" }))[0]!.tags[0]).toMatchObject({ id: tag.id, automatic: true });
  });

  test("renames and deletes a tag everywhere", async () => {
    const { db, tagging, queries } = await createContext();
    const tag = await tagging.createTag("Old name");
    const source = (await db.select().from(sources))[0]!;
    const [transaction] = await queries.listTransactions();
    await tagging.setManualTag(transaction!.id, tag.id, true);
    await tagging.saveRule({ tagId: tag.id, sourceId: source.id, direction: "outflow", matchMode: "all", description: "*" });
    expect((await tagging.renameTag(tag.id, "New name")).name).toBe("New name");
    await tagging.deleteTag(tag.id);
    expect(await tagging.listTags()).toEqual([]);
    expect((await queries.listTransactions()).every(item => item.tags.length === 0)).toBe(true);
  });
});
