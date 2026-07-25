import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type {
  AccountListItem,
  CashFlowSourceBreakdown,
  CashFlowSummary,
  DashboardQueryRepository,
  LatestImport,
  TransactionListItem,
} from "../../app/ports/dashboard-query-repository";
import type { EconomicType } from "../../core/finance/constants";
import type { AppDatabase } from "./client";
import { accounts, importBatches, sources, transactionLinks, transactions } from "./schema";

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
    const transactionRows = options?.limit ? await orderedQuery.limit(options.limit).offset(options.offset ?? 0) : await orderedQuery;
    if (transactionRows.length === 0) return [];
    const transactionIds = transactionRows.map(transaction => transaction.id);
    const links = await this.db.select().from(transactionLinks).where(and(
      eq(transactionLinks.linkType, "funds"),
      eq(transactionLinks.createdBy, "system_rule"),
      or(inArray(transactionLinks.fromTransactionId, transactionIds), inArray(transactionLinks.toTransactionId, transactionIds)),
    ));
    return transactionRows.map(transaction => {
      const fromLink = links.find(link => link.fromTransactionId === transaction.id && link.status !== "rejected");
      const toLink = links.find(link => link.toTransactionId === transaction.id && link.status !== "rejected");
      const reconciliationLabel = fromLink
        ? fromLink.status === "confirmed" ? "Linked to PayPal purchase" : "PayPal match pending"
        : toLink ? toLink.status === "confirmed" ? "Funded by HSBC PayPal payment" : "HSBC match pending" : null;
      return { ...transaction, reconciliationLabel };
    });
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

  async getCashFlowSummary({ startDate, endDate }: { startDate: string; endDate: string }): Promise<CashFlowSummary[]> {
    const endExclusive = new Date(`${endDate}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const dateRange = and(
      gte(transactions.transactionDate, startDate),
      lt(transactions.transactionDate, endExclusive.toISOString().slice(0, 10)),
      sql`not exists (select 1 from ${transactionLinks} where ${transactionLinks.fromTransactionId} = ${transactions.id} and ${transactionLinks.linkType} = 'funds' and ${transactionLinks.status} = 'confirmed')`,
    );
    const [summaries, sourceRows] = await Promise.all([
      this.db
      .select({
        currencyCode: transactions.currencyCode,
        incomeMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'income' then ${transactions.amountMinor} else 0 end), 0)`,
        expenseMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)`,
        transferInflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} >= 0 then ${transactions.amountMinor} else 0 end), 0)`,
        transferOutflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} < 0 then ${transactions.amountMinor} else 0 end), 0)`,
        unclassifiedTransactionCount: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'unclassified' then 1 else 0 end), 0)`,
      })
      .from(transactions)
      .where(dateRange)
      .groupBy(transactions.currencyCode)
      .orderBy(transactions.currencyCode),
      this.db
        .select({
          currencyCode: transactions.currencyCode,
          sourceName: sources.name,
          incomeMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'income' then ${transactions.amountMinor} else 0 end), 0)`,
          expenseMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)`,
          transferInflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} >= 0 then ${transactions.amountMinor} else 0 end), 0)`,
          transferOutflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} < 0 then ${transactions.amountMinor} else 0 end), 0)`,
        })
        .from(transactions)
        .innerJoin(sources, eq(transactions.sourceId, sources.id))
        .where(dateRange)
        .groupBy(transactions.currencyCode, sources.name)
        .orderBy(transactions.currencyCode, sources.name),
    ]);
    const sourceBreakdownByCurrency = new Map<string, CashFlowSourceBreakdown[]>();
    for (const row of sourceRows) {
      const breakdown = sourceBreakdownByCurrency.get(row.currencyCode) ?? [];
      breakdown.push({
        sourceName: row.sourceName,
        incomeMinor: row.incomeMinor,
        expenseMinor: row.expenseMinor,
        netCashFlowMinor: row.incomeMinor + row.expenseMinor,
        transferInflowMinor: row.transferInflowMinor,
        transferOutflowMinor: row.transferOutflowMinor,
      });
      sourceBreakdownByCurrency.set(row.currencyCode, breakdown);
    }
    return summaries.map(summary => ({
      currencyCode: summary.currencyCode,
      incomeMinor: summary.incomeMinor,
      expenseMinor: summary.expenseMinor,
      netCashFlowMinor: summary.incomeMinor + summary.expenseMinor,
      transferInflowMinor: summary.transferInflowMinor,
      transferOutflowMinor: summary.transferOutflowMinor,
      unclassifiedTransactionCount: summary.unclassifiedTransactionCount,
      sources: sourceBreakdownByCurrency.get(summary.currencyCode) ?? [],
    }));
  }
}
