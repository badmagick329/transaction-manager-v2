import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type {
  AccountListItem,
  DashboardQueryRepository,
  LatestImport,
  MonthlyCashFlowSummary,
  TransactionListItem,
} from "../../app/ports/dashboard-query-repository";
import type { EconomicType } from "../../core/finance/constants";
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

  async listTransactions(options?: { limit?: number; offset?: number; economicType?: EconomicType }): Promise<TransactionListItem[]> {
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
      .innerJoin(accounts, eq(transactions.accountId, accounts.id));
    const filteredQuery = options?.economicType ? query.where(eq(transactions.economicType, options.economicType)) : query;
    const orderedQuery = filteredQuery.orderBy(desc(transactions.transactionDate), desc(transactions.id));
    if (!options?.limit) return orderedQuery;
    return orderedQuery.limit(options.limit).offset(options.offset ?? 0);
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

  async getMonthlyCashFlowSummary(month: string): Promise<MonthlyCashFlowSummary> {
    const [year, monthNumber] = month.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
    const [summary] = await this.db
      .select({
        incomeMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'income' then ${transactions.amountMinor} else 0 end), 0)`,
        expenseMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)`,
        transferInflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} >= 0 then ${transactions.amountMinor} else 0 end), 0)`,
        transferOutflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} < 0 then ${transactions.amountMinor} else 0 end), 0)`,
        unclassifiedTransactionCount: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'unclassified' then 1 else 0 end), 0)`,
      })
      .from(transactions)
      .where(and(gte(transactions.transactionDate, `${month}-01`), lt(transactions.transactionDate, `${nextMonth}-01`)));
    return {
      incomeMinor: summary.incomeMinor,
      expenseMinor: summary.expenseMinor,
      netCashFlowMinor: summary.incomeMinor + summary.expenseMinor,
      transferInflowMinor: summary.transferInflowMinor,
      transferOutflowMinor: summary.transferOutflowMinor,
      unclassifiedTransactionCount: summary.unclassifiedTransactionCount,
    };
  }
}
