import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "../db/client";
import { DrizzleImportRepository } from "../db/drizzle-import-repository";
import { DrizzleDashboardQueryRepository } from "../db/drizzle-dashboard-query-repository";
import { correctHsbcDirectDebitTransfers } from "../db/correct-hsbc-direct-debits";
import { importStandardFile } from "../../app/use-cases/import-standard-file";
import { createDashboardQueries } from "../../app/use-cases/query-dashboard";
import { standardImportFileSchema } from "../../app/contracts/standard-import";
import { accounts, importAttempts, importBatches, rawRecords, transactionTypeCorrections, transactions } from "../db/schema";
import { startWatchedImports } from "./watched-imports";

const migrationsFolder = join(process.cwd(), "drizzle");

async function createTestContext() {
  const root = await mkdtemp(join(tmpdir(), "transaction-manager-import-"));
  const db = createDb(join(root, "app.db"));
  migrate(db, { migrationsFolder });
  return { root, db, repository: new DrizzleImportRepository(db) };
}

function importFile(records: object[]) {
  return {
    source: {
      slug: "lloyds",
      name: "Lloyds",
      kind: "bank" as const,
      fileName: "statement.pdf",
      account: { externalId: null, name: "Current Account", currencyCode: "GBP" },
    },
    records,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    externalId: null,
    transactionDate: "2026-06-01",
    postedDate: null,
    description: "Coffee shop",
    amountMinor: -450,
    currencyCode: "GBP",
    transactionType: null,
    rawPayload: { row: "1" },
    ...overrides,
  };
}

describe("watched bank imports", () => {
  test("preserves known types, defaults missing types, and reuses fallback accounts", async () => {
    const { db, repository } = await createTestContext();
    const parsed = importFile([record({ transactionType: "purchase" }), record({ description: "Unknown", rawPayload: { row: "2" } })]);

    const result = await importStandardFile(repository, {
      fileName: "first.json",
      fileHash: randomUUID(),
      importFile: parsed,
    });

    expect(result.kind).toBe("processed");
    expect(await db.select().from(accounts)).toHaveLength(1);
    const storedTransactions = await db.select().from(transactions);
    expect(storedTransactions.map(item => item.transactionType)).toEqual(["purchase", "unclassified"]);
    expect(storedTransactions.map(item => item.economicType)).toEqual(["unclassified", "unclassified"]);
  });

  test("reuses accounts identified by an external account id", async () => {
    const { db, repository } = await createTestContext();
    const first = importFile([record({ externalId: "bank-1" })]);
    first.source.account!.externalId = "account-123";
    const second = importFile([record({ externalId: "bank-2", description: "Groceries", rawPayload: { row: "2" } })]);
    second.source.account!.externalId = "account-123";

    await importStandardFile(repository, { fileName: "first.json", fileHash: "external-file-1", importFile: first });
    await importStandardFile(repository, { fileName: "second.json", fileHash: "external-file-2", importFile: second });

    expect(await db.select().from(accounts)).toHaveLength(1);
  });

  test("skips identical files and only stores globally new overlapping records", async () => {
    const { db, repository } = await createTestContext();
    const first = importFile([record({ externalId: "bank-1" }), record({ externalId: "bank-2", description: "Groceries", rawPayload: { row: "2" } })]);
    const firstResult = await importStandardFile(repository, { fileName: "first.json", fileHash: "file-1", importFile: first });
    const duplicate = await importStandardFile(repository, { fileName: "same.json", fileHash: "file-1", importFile: first });
    const overlap = await importStandardFile(repository, {
      fileName: "overlap.json",
      fileHash: "file-2",
      importFile: importFile([record({ externalId: "bank-2", description: "Groceries", rawPayload: { row: "2" } }), record({ externalId: "bank-3", description: "Salary", amountMinor: 100000, rawPayload: { row: "3" } })]),
    });

    expect(firstResult.kind).toBe("processed");
    expect(duplicate.kind).toBe("duplicate");
    expect(overlap).toMatchObject({ kind: "processed", duplicateRecordCount: 1 });
    expect(await db.select().from(importBatches)).toHaveLength(2);
    expect(await db.select().from(rawRecords)).toHaveLength(3);
    expect(await db.select().from(transactions)).toHaveLength(3);
  });

  test("returns newest transactions and the latest import for the API", async () => {
    const { db, repository } = await createTestContext();
    await importStandardFile(repository, {
      fileName: "statement.json",
      fileHash: "dashboard-file",
      importFile: importFile([
        record({ externalId: "old", transactionDate: "2026-06-01" }),
        record({ externalId: "new", transactionDate: "2026-06-02", description: "Newer", rawPayload: { row: "2" } }),
      ]),
    });
    const queries = createDashboardQueries(new DrizzleDashboardQueryRepository(db));

    const latest = await queries.getLatestImport();
    const listedTransactions = await queries.listTransactions();

    expect(latest).toMatchObject({ fileName: "statement.json", status: "processed", recordCount: 2 });
    expect(listedTransactions.map(transaction => transaction.description)).toEqual(["Newer", "Coffee shop"]);
  });

  test("moves invalid files to failed without raw or transaction rows", async () => {
    const { root, db, repository } = await createTestContext();
    const incoming = join(root, "imports", "incoming");
    await mkdir(incoming, { recursive: true });
    await writeFile(join(incoming, "invalid.json"), "{ not json");

    const watcher = await startWatchedImports({ repository, rootPath: join(root, "imports"), logger: { info() {}, error() {} } });
    await watcher.close();

    expect(await readFile(join(root, "imports", "failed", "invalid.json"), "utf8")).toBe("{ not json");
    expect(await db.select().from(rawRecords)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect((await db.select().from(importBatches))[0]?.status).toBe("failed");
  });

  test("moves schema-invalid files to failed without raw or transaction rows", async () => {
    const { root, db, repository } = await createTestContext();
    const incoming = join(root, "imports", "incoming");
    await mkdir(incoming, { recursive: true });
    await writeFile(join(incoming, "invalid-schema.json"), JSON.stringify({ source: {} }));

    const watcher = await startWatchedImports({ repository, rootPath: join(root, "imports"), logger: { info() {}, error() {} } });
    await watcher.close();

    expect(await readFile(join(root, "imports", "failed", "invalid-schema.json"), "utf8")).toBe(JSON.stringify({ source: {} }));
    expect(await db.select().from(rawRecords)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  test("accepts a null record account when source.account provides the default", async () => {
    const { db, repository } = await createTestContext();
    const parsed = standardImportFileSchema.parse(importFile([record({ account: null })]));

    const result = await importStandardFile(repository, {
      fileName: "null-account.json",
      fileHash: "null-account-file",
      importFile: parsed,
    });

    expect(result.kind).toBe("processed");
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  test("retries a failed file only after it is explicitly placed in incoming", async () => {
    const { root, db, repository } = await createTestContext();
    const json = JSON.stringify(importFile([record({ account: null })]));
    const fileHash = createHash("sha256").update(json).digest("hex");
    await repository.recordFailure({ fileName: "retry.json", fileHash, errorMessage: "Previous validator rejected null." });

    const incoming = join(root, "imports", "incoming");
    await mkdir(incoming, { recursive: true });
    await writeFile(join(incoming, "retry.json"), json);
    const watcher = await startWatchedImports({ repository, rootPath: join(root, "imports"), logger: { info() {}, error() {} } });
    await watcher.close();

    const [batch] = await db.select().from(importBatches);
    const attempts = await db.select().from(importAttempts);
    expect(batch).toMatchObject({ status: "processed", attemptCount: 2 });
    expect(attempts.map(attempt => attempt.status)).toEqual(["failed", "processed"]);
    expect(await readFile(join(root, "imports", "processed", "retry.json"), "utf8")).toBe(json);
  });

  test("corrects only HSBC direct-debit records previously labelled as transfers", async () => {
    const { db, repository } = await createTestContext();
    const hsbcImport = importFile([
      record({
        externalId: "dd-1",
        transactionType: "transfer",
        rawPayload: { original_row: { paymentType: "DD" } },
      }),
      record({
        externalId: "transfer-1",
        description: "Bank transfer",
        transactionType: "transfer",
        rawPayload: { original_row: { paymentType: "OBP" } },
      }),
    ]);
    hsbcImport.source.slug = "hsbc";

    await importStandardFile(repository, { fileName: "hsbc.json", fileHash: "hsbc-correction", importFile: hsbcImport });
    expect(await correctHsbcDirectDebitTransfers(db)).toBe(1);

    expect((await db.select().from(transactions)).map(transaction => transaction.transactionType)).toEqual(["direct_debit", "transfer"]);
    expect(await db.select().from(transactionTypeCorrections)).toHaveLength(1);
    expect(await correctHsbcDirectDebitTransfers(db)).toBe(0);
  });

  test("recovers a processed file left in processing", async () => {
    const { root, repository } = await createTestContext();
    const json = JSON.stringify(importFile([record()]));
    const fileHash = createHash("sha256").update(json).digest("hex");
    await importStandardFile(repository, {
      fileName: "recovery.json",
      fileHash,
      importFile: JSON.parse(json),
    });
    const processing = join(root, "imports", "processing");
    await mkdir(processing, { recursive: true });
    await writeFile(join(processing, "recovery.json"), json);

    const watcher = await startWatchedImports({ repository, rootPath: join(root, "imports"), logger: { info() {}, error() {} } });
    await watcher.close();

    expect(await readFile(join(root, "imports", "processed", "recovery.json"), "utf8")).toBe(json);
  });
});
