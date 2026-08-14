import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { standardImportFileSchema } from "../../app/contracts/standard-import";
import { importStandardFile } from "../../app/use-cases/import-standard-file";
import { createDb } from "./client";
import { DrizzleDashboardQueryRepository } from "./drizzle-dashboard-query-repository";
import { DrizzleImportRepository } from "./drizzle-import-repository";

const migrationsFolder = join(process.cwd(), "drizzle");

async function context() {
  const root = await mkdtemp(join(tmpdir(), "transaction-manager-coverage-"));
  const db = createDb(join(root, "app.db"));
  migrate(db, { migrationsFolder });
  return { imports: new DrizzleImportRepository(db), queries: new DrizzleDashboardQueryRepository(db) };
}

function account(name: string) {
  return { externalId: null, name, currencyCode: "GBP" };
}

function importFile(sourceAccount: ReturnType<typeof account> | null, coveragePeriods?: Array<{ startDate: string; endDate: string; account: ReturnType<typeof account> | null }>, records: object[] = []) {
  return standardImportFileSchema.parse({
    source: { slug: "provider", name: "Provider", kind: "bank", fileName: "statement.pdf", account: sourceAccount, coveragePeriods },
    records,
  });
}

async function runImport(repository: DrizzleImportRepository, importFileValue: ReturnType<typeof importFile>) {
  return importStandardFile(repository, { fileName: `${randomUUID()}.json`, fileHash: randomUUID(), importFile: importFileValue });
}

describe("verified data coverage", () => {
  test("stores account coverage for an empty statement", async () => {
    const { imports, queries } = await context();
    const current = account("Current Account");
    await runImport(imports, importFile(current, [{ startDate: "2026-01-01", endDate: "2026-01-31", account: current }]));

    const coverage = await queries.getDataCoverage();
    expect(coverage.accounts).toHaveLength(1);
    expect(coverage.accounts[0].latestTransactionDate).toBeNull();
    expect(coverage.accounts[0].coverageIntervals).toEqual([{ startDate: "2026-01-01", endDate: "2026-01-31" }]);
    expect(coverage.commonCoveredThrough).toBe("2026-01-31");
  });

  test("provider-wide coverage applies to existing accounts and advances despite duplicate records", async () => {
    const { imports, queries } = await context();
    const first = account("First Account");
    const second = account("Second Account");
    await runImport(imports, importFile(first));
    await runImport(imports, importFile(second));
    await runImport(imports, importFile(null, [{ startDate: "2026-01-01", endDate: "2026-01-31", account: null }]));
    const record = { externalId: "row-1", transactionDate: "2026-01-10", description: "Activity", amountMinor: -100, currencyCode: "GBP", rawPayload: {} };
    await runImport(imports, importFile(first, [{ startDate: "2026-02-01", endDate: "2026-02-28", account: first }], [record]));
    const duplicate = await runImport(imports, importFile(first, [{ startDate: "2026-03-01", endDate: "2026-03-31", account: first }], [record]));

    expect(duplicate).toMatchObject({ kind: "processed", duplicateRecordCount: 1 });
    const coverage = await queries.getDataCoverage();
    const firstCoverage = coverage.accounts.find(item => item.accountName === first.name)!;
    const secondCoverage = coverage.accounts.find(item => item.accountName === second.name)!;
    expect(firstCoverage.latestTransactionDate).toBe("2026-01-10");
    expect(firstCoverage.coverageIntervals).toEqual([{ startDate: "2026-01-01", endDate: "2026-03-31" }]);
    expect(secondCoverage.coverageIntervals).toEqual([{ startDate: "2026-01-01", endDate: "2026-01-31" }]);
    expect(coverage.commonCoveredThrough).toBe("2026-01-31");
  });

  test("manual baselines replace cleanly and required accounts control the common interval", async () => {
    const { imports, queries } = await context();
    await runImport(imports, importFile(account("Known Account"), [{ startDate: "2026-02-01", endDate: "2026-02-28", account: null }]));
    await runImport(imports, importFile(account("Unknown Account")));
    let coverage = await queries.getDataCoverage();
    const known = coverage.accounts.find(item => item.accountName === "Known Account")!;
    const unknown = coverage.accounts.find(item => item.accountName === "Unknown Account")!;
    expect(coverage.blockingAccountIds).toEqual([unknown.accountId]);

    await queries.updateCoverageAccountSettings({ accountId: unknown.accountId, required: true, baselineStartDate: "2026-02-10", baselineEndDate: "2026-02-20" });
    coverage = await queries.getDataCoverage();
    expect(coverage.commonIntervals).toEqual([{ startDate: "2026-02-10", endDate: "2026-02-20" }]);

    await queries.updateCoverageAccountSettings({ accountId: unknown.accountId, required: false, baselineStartDate: null, baselineEndDate: null });
    coverage = await queries.getDataCoverage();
    expect(coverage.accounts.find(item => item.accountId === unknown.accountId)?.manualBaseline).toBeNull();
    expect(coverage.commonIntervals).toEqual(known.coverageIntervals);
  });
});
