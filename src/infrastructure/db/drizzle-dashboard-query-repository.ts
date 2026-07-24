import { desc, eq } from "drizzle-orm";
import type {
  AccountListItem,
  DashboardQueryRepository,
  LatestImport,
  TransactionListItem,
} from "../../app/ports/dashboard-query-repository";
import type { AppDatabase } from "./client";
import { accounts, importBatches, sources, transactions } from "./schema";

export class DrizzleDashboardQueryRepository implements DashboardQueryRepository {
  constructor(private readonly db: AppDatabase) {}

  async listAccounts(): Promise<AccountListItem[]> {
    return this.db
      .select({
        id: accounts.id,
        name: accounts.name,
        kind: accounts.kind,
        currencyCode: accounts.currencyCode,
        sourceName: sources.name,
      })
      .from(accounts)
      .leftJoin(sources, eq(accounts.sourceId, sources.id))
      .orderBy(accounts.name);
  }

  async listTransactions(options?: { limit?: number; offset?: number }): Promise<TransactionListItem[]> {
    const query = this.db
      .select({
        id: transactions.id,
        accountId: accounts.id,
        accountName: accounts.name,
        transactionDate: transactions.transactionDate,
        postedDate: transactions.postedDate,
        description: transactions.description,
        amountMinor: transactions.amountMinor,
        currencyCode: transactions.currencyCode,
        transactionType: transactions.transactionType,
        economicType: transactions.economicType,
        status: transactions.status,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .orderBy(desc(transactions.transactionDate), desc(transactions.id));
    if (!options?.limit) return query;
    return query.limit(options.limit).offset(options.offset ?? 0);
  }

  async getLatestImport(): Promise<LatestImport> {
    const row = await this.db.query.importBatches.findFirst({ orderBy: [desc(importBatches.id)] });
    if (!row) return null;
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      recordCount: row.recordCount,
      duplicateRecordCount: row.duplicateRecordCount,
      attemptCount: row.attemptCount,
      errorMessage: row.errorMessage,
      importedAt: row.importedAt,
      createdAt: row.createdAt,
    };
  }
}
