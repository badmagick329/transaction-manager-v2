import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "../db/client";
import { DrizzleImportRepository } from "../db/drizzle-import-repository";
import { DrizzleDashboardQueryRepository } from "../db/drizzle-dashboard-query-repository";
import { DrizzleClassificationRepository } from "../db/drizzle-classification-repository";
import { correctHsbcDirectDebitTransfers } from "../db/correct-hsbc-direct-debits";
import { importStandardFile } from "../../app/use-cases/import-standard-file";
import { createDashboardQueries } from "../../app/use-cases/query-dashboard";
import { standardImportFileSchema } from "../../app/contracts/standard-import";
import { accounts, economicClassificationAudits, importAttempts, importBatches, rawRecords, sources, transactionTypeCorrections, transactions } from "../db/schema";
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

  test("imports credit-card records into a credit-card account", async () => {
    const { db, repository } = await createTestContext();
    const capitalOneImport = importFile([record({ externalId: "card-1", description: "Card purchase" })]);
    capitalOneImport.source = {
      ...capitalOneImport.source,
      slug: "capital-one",
      name: "Capital One",
      kind: "credit_card" as const,
      account: { externalId: null, name: "Capital One MasterCard ending 9724", currencyCode: "GBP" },
    };

    await importStandardFile(repository, { fileName: "capital-one.json", fileHash: "capital-one-file", importFile: capitalOneImport });
    expect((await db.select().from(accounts))[0]).toMatchObject({ name: "Capital One MasterCard ending 9724", kind: "credit_card" });
    expect((await db.select().from(transactions))[0]).toMatchObject({ description: "Card purchase", amountMinor: -450 });
  });

  test("imports Robinhood records into an investment portfolio account", async () => {
    const { db, repository } = await createTestContext();
    const robinhoodImport = importFile([record({ externalId: "robinhood-1", description: "Instant bank deposit", amountMinor: 64546, currencyCode: "USD", transactionType: "funding" })]);
    robinhoodImport.source = {
      ...robinhoodImport.source,
      slug: "robinhood",
      name: "Robinhood",
      kind: "robinhood" as const,
      account: { externalId: "211580585969", name: "Robinhood Individual Account", currencyCode: "USD" },
    };

    await importStandardFile(repository, { fileName: "2024-07-31_Robinhood.json", fileHash: "robinhood-file", importFile: robinhoodImport });
    expect((await db.select().from(accounts))[0]).toMatchObject({ name: "Robinhood Individual Account", kind: "investment_portfolio", currencyCode: "USD" });
    expect((await db.select().from(transactions))[0]).toMatchObject({ description: "Instant bank deposit", amountMinor: 64546, currencyCode: "USD", transactionType: "funding" });
  });

  test("imports Trading 212 activity into separate investment accounts", async () => {
    const { db, repository } = await createTestContext();
    const trading212Import = {
      source: {
        slug: "trading212",
        name: "Trading 212",
        kind: "trading212" as const,
        fileName: "activity.pdf",
        account: null,
      },
      records: [
        record({ externalId: "invest-card", description: "Card purchase", amountMinor: -2893, transactionType: "purchase", account: { externalId: "42368553", name: "Trading 212 Invest", currencyCode: "GBP" } }),
        record({ externalId: "isa-deposit", description: "TrueLayer", amountMinor: 10000, transactionType: "funding", rawPayload: { row: "2" }, account: { externalId: "42367172", name: "Trading 212 Stocks ISA", currencyCode: "GBP" } }),
      ],
    };

    await importStandardFile(repository, { fileName: "2026-07-23_Trading212.json", fileHash: "trading212-file", importFile: trading212Import });
    expect(await db.select().from(accounts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Trading 212 Invest", kind: "investment_portfolio" }),
      expect.objectContaining({ name: "Trading 212 Stocks ISA", kind: "investment_portfolio" }),
    ]));
    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["expense", "transfer"]);
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
    const secondPage = await queries.listTransactions({ limit: 1, offset: 1 });
    const unclassifiedTransactions = await queries.listTransactions({ economicType: "unclassified" });

    expect(latest).toMatchObject({ fileName: "statement.json", status: "processed", recordCount: 2 });
    expect(listedTransactions.map(transaction => transaction.description)).toEqual(["Newer", "Coffee shop"]);
    expect(secondPage.map(transaction => transaction.description)).toEqual(["Coffee shop"]);
    expect(unclassifiedTransactions).toHaveLength(2);
  });

  test("summarizes cash flow by date range, currency, and source without counting transfers in net cash flow", async () => {
    const { db, repository } = await createTestContext();
    await importStandardFile(repository, {
      fileName: "summary.json",
      fileHash: "monthly-summary",
      importFile: importFile([
        record({ externalId: "expense", description: "Groceries", amountMinor: -500, transactionDate: "2026-01-10", rawPayload: { row: "1" } }),
        record({ externalId: "income", description: "Salary", amountMinor: 1000, transactionDate: "2026-01-11", rawPayload: { row: "2" } }),
        record({ externalId: "transfer", description: "Investment", amountMinor: -200, transactionDate: "2026-01-12", rawPayload: { row: "3" } }),
        record({ externalId: "unknown", description: "Unknown", amountMinor: -100, transactionDate: "2026-01-13", rawPayload: { row: "4" } }),
      ]),
    });
    const source = (await db.select().from(sources))[0]!;
    const classifications = new DrizzleClassificationRepository(db);
    await classifications.saveRule({ sourceId: source.id, description: "Groceries", matchMode: "exact", direction: "outflow", economicType: "expense" });
    await classifications.saveRule({ sourceId: source.id, description: "Salary", matchMode: "exact", direction: "inflow", economicType: "income" });
    await classifications.saveRule({ sourceId: source.id, description: "Investment", matchMode: "exact", direction: "outflow", economicType: "transfer" });

    const robinhoodImport = importFile([record({ externalId: "usd-income", description: "Dividend", amountMinor: 125, currencyCode: "USD", transactionDate: "2026-01-14", rawPayload: { row: "5" } })]);
    robinhoodImport.source = {
      ...robinhoodImport.source,
      slug: "robinhood",
      name: "Robinhood",
      kind: "robinhood" as const,
      account: { externalId: "211580585969", name: "Robinhood Individual Account", currencyCode: "USD" },
    };
    await importStandardFile(repository, { fileName: "robinhood-summary.json", fileHash: "robinhood-summary", importFile: robinhoodImport });
    const robinhood = (await db.select().from(sources)).find(item => item.slug === "robinhood")!;
    await classifications.saveRule({ sourceId: robinhood.id, description: "Dividend", matchMode: "exact", direction: "inflow", economicType: "income" });

    expect(await createDashboardQueries(new DrizzleDashboardQueryRepository(db)).getCashFlowSummary({ startDate: "2026-01-01", endDate: "2026-01-31" })).toEqual([
      {
        currencyCode: "GBP",
        incomeMinor: 1000,
        expenseMinor: -500,
        netCashFlowMinor: 500,
        transferInflowMinor: 0,
        transferOutflowMinor: -200,
        unclassifiedTransactionCount: 1,
        sources: [{ sourceName: "Lloyds", incomeMinor: 1000, expenseMinor: -500, netCashFlowMinor: 500, transferInflowMinor: 0, transferOutflowMinor: -200 }],
      },
      {
        currencyCode: "USD",
        incomeMinor: 125,
        expenseMinor: 0,
        netCashFlowMinor: 125,
        transferInflowMinor: 0,
        transferOutflowMinor: 0,
        unclassifiedTransactionCount: 0,
        sources: [{ sourceName: "Robinhood", incomeMinor: 125, expenseMinor: 0, netCashFlowMinor: 125, transferInflowMinor: 0, transferOutflowMinor: 0 }],
      },
    ]);
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

  test("creates a local rule, reapplies it to history, and audits changes", async () => {
    const { db, repository } = await createTestContext();
    await importStandardFile(repository, {
      fileName: "first.json",
      fileHash: "classification-history",
      importFile: importFile([
        record({ externalId: "coffee-1", description: "Coffee   Shop", rawPayload: { row: "1" } }),
        record({ externalId: "coffee-2", description: " coffee shop ", rawPayload: { row: "2" } }),
        record({ externalId: "coffee-income", description: "Coffee Shop", amountMinor: 500, rawPayload: { row: "3" } }),
      ]),
    });
    const source = (await db.select().from(sources))[0]!;
    const classifications = new DrizzleClassificationRepository(db);

    expect((await classifications.listReviewGroups()).find(group => group.description === "Coffee   Shop")?.transactionCount).toBe(2);
    const created = await classifications.saveRule({
      sourceId: source.id,
      description: "COFFEE SHOP",
      matchMode: "exact",
      direction: "outflow",
      economicType: "expense",
    });
    expect(created.affectedTransactionCount).toBe(2);
    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["expense", "expense", "unclassified"]);
    expect(await db.select().from(economicClassificationAudits)).toHaveLength(2);

    const unchanged = await classifications.saveRule({
      sourceId: source.id,
      description: "coffee shop",
      matchMode: "exact",
      direction: "outflow",
      economicType: "expense",
    });
    expect(unchanged.affectedTransactionCount).toBe(0);
    expect(await db.select().from(economicClassificationAudits)).toHaveLength(2);

    await classifications.saveRule({
      sourceId: source.id,
      description: "coffee shop",
      matchMode: "exact",
      direction: "outflow",
      economicType: "transfer",
    });
    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["transfer", "transfer", "unclassified"]);

    await classifications.deleteRule(created.rule.id);
    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["unclassified", "unclassified", "unclassified"]);
    expect(await db.select().from(economicClassificationAudits)).toHaveLength(6);
  });

  test("applies a provider rule to future matching imports without crossing providers", async () => {
    const { db, repository } = await createTestContext();
    await importStandardFile(repository, {
      fileName: "first.json",
      fileHash: "classification-future-1",
      importFile: importFile([record({ externalId: "coffee-1", description: "Coffee Shop" })]),
    });
    const lloyds = (await db.select().from(sources))[0]!;
    const classifications = new DrizzleClassificationRepository(db);
    await classifications.saveRule({ sourceId: lloyds.id, description: "coffee shop", matchMode: "exact", direction: "outflow", economicType: "expense" });

    await importStandardFile(repository, {
      fileName: "second.json",
      fileHash: "classification-future-2",
      importFile: importFile([record({ externalId: "coffee-2", description: "  COFFEE   SHOP  ", rawPayload: { row: "2" } })]),
    });
    const hsbcFile = importFile([record({ externalId: "coffee-3", description: "Coffee Shop", rawPayload: { row: "3" } })]);
    hsbcFile.source.slug = "hsbc";
    hsbcFile.source.name = "HSBC";
    await importStandardFile(repository, { fileName: "third.json", fileHash: "classification-future-3", importFile: hsbcFile });

    const storedTransactions = await db.select().from(transactions);
    expect(storedTransactions.map(transaction => transaction.economicType)).toEqual(["expense", "expense", "unclassified"]);
    expect((await db.select().from(economicClassificationAudits)).map(audit => audit.reason)).toEqual(["rule_applied", "rule_applied_on_import"]);
    expect((await classifications.listReviewGroups()).some(group => group.sourceName === "HSBC" && group.description === "Coffee Shop")).toBe(true);
  });

  test("uses starts-with rules for variable references and prioritizes exact rules", async () => {
    const { db, repository } = await createTestContext();
    await importStandardFile(repository, {
      fileName: "first.json",
      fileHash: "classification-patterns-1",
      importFile: importFile([
        record({ externalId: "trading-1", description: "Trading 212 212TG0K4A212T", rawPayload: { row: "1" } }),
        record({ externalId: "trading-2", description: "Trading 212 212TH93A5212T", rawPayload: { row: "2" } }),
      ]),
    });
    const source = (await db.select().from(sources))[0]!;
    const classifications = new DrizzleClassificationRepository(db);
    await classifications.saveRule({ sourceId: source.id, description: "Trading 212", matchMode: "starts_with", direction: "outflow", economicType: "transfer" });
    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["transfer", "transfer"]);

    await classifications.saveRule({ sourceId: source.id, description: "Trading 212 212TH93A5212T", matchMode: "exact", direction: "outflow", economicType: "expense" });
    await importStandardFile(repository, {
      fileName: "second.json",
      fileHash: "classification-patterns-2",
      importFile: importFile([
        record({ externalId: "trading-3", description: "Trading 212 212TH93A5212T", rawPayload: { row: "3" } }),
        record({ externalId: "trading-4", description: "Trading 212 212TJ4P7V212T", rawPayload: { row: "4" } }),
      ]),
    });
    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["transfer", "expense", "expense", "transfer"]);
  });

  test("uses an all rule for every transaction from one source and direction", async () => {
    const { db, repository } = await createTestContext();
    const robinhoodImport = importFile([
      record({ externalId: "robinhood-in", description: "Interest Payment", amountMinor: 11, currencyCode: "USD" }),
      record({ externalId: "robinhood-out", description: "Bank withdrawal", amountMinor: -100, currencyCode: "USD", rawPayload: { row: "2" } }),
    ]);
    robinhoodImport.source = {
      ...robinhoodImport.source,
      slug: "robinhood",
      name: "Robinhood",
      kind: "robinhood" as const,
      account: { externalId: "211580585969", name: "Robinhood Individual Account", currencyCode: "USD" },
    };
    await importStandardFile(repository, { fileName: "robinhood.json", fileHash: "robinhood-all-rule", importFile: robinhoodImport });
    const robinhood = (await db.select().from(sources))[0]!;
    const classifications = new DrizzleClassificationRepository(db);

    await classifications.saveRule({ sourceId: robinhood.id, description: "*", matchMode: "all", direction: "inflow", economicType: "transfer" });
    await classifications.saveRule({ sourceId: robinhood.id, description: "*", matchMode: "all", direction: "outflow", economicType: "transfer" });

    expect((await db.select().from(transactions)).map(transaction => transaction.economicType)).toEqual(["transfer", "transfer"]);
  });

  test("rejects economic types that conflict with a transaction direction", async () => {
    const { db, repository } = await createTestContext();
    await importStandardFile(repository, { fileName: "direction.json", fileHash: "direction-rule", importFile: importFile([record()]) });
    const source = (await db.select().from(sources))[0]!;
    const classifications = new DrizzleClassificationRepository(db);

    await expect(classifications.saveRule({ sourceId: source.id, description: "Coffee shop", matchMode: "exact", direction: "inflow", economicType: "expense" })).rejects.toThrow("expense is not valid for a inflow transaction.");
    await expect(classifications.saveRule({ sourceId: source.id, description: "Coffee shop", matchMode: "exact", direction: "outflow", economicType: "income" })).rejects.toThrow("income is not valid for a outflow transaction.");
  });
});
