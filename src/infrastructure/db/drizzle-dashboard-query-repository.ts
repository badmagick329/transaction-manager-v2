import { and, desc, eq, gte, inArray, like, lte, lt, or, sql } from "drizzle-orm";
import type {
  AccountListItem,
  CashFlowSourceBreakdown,
  CashFlowTrend,
  CashFlowSummary,
  DashboardQueryRepository,
  LatestImport,
  TransactionListItem,
  TransactionSummary,
} from "../../app/ports/dashboard-query-repository";
import type { EconomicType } from "../../core/finance/constants";
import type { AppDatabase } from "./client";
import { accounts, importBatches, sources, transactionLinks, transactions } from "./schema";

function periodsInRange(startDate: string, endDate: string, granularity: "month" | "year") {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  if (granularity === "year") return Array.from({ length: endYear - startYear + 1 }, (_, index) => String(startYear + index));

  const periods: string[] = [];
  let year = startYear;
  let month = Number(startDate.slice(5, 7));
  const endMonth = Number(endDate.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    periods.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

function periodLabel(period: string, granularity: "month" | "year") {
  if (granularity === "year") return period;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
}

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
        sourceId: sources.id,
      })
      .from(accounts)
      .leftJoin(sources, eq(accounts.sourceId, sources.id))
      .orderBy(accounts.name);
  }

  async listTransactions(options?: { limit?: number; offset?: number; economicType?: EconomicType; sourceId?: number; accountId?: number; currencyCode?: string; transactionType?: string; description?: string; minAmountMinor?: number; maxAmountMinor?: number; startDate?: string; endDate?: string; hideTrading212InterestCashbackAndDividends?: boolean; hideTransfers?: boolean }): Promise<TransactionListItem[]> {
    const query = this.db
      .select({
        id: transactions.id,
        accountId: accounts.id,
        accountName: accounts.name,
        sourceId: sources.id,
        sourceName: sources.name,
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
      .innerJoin(sources, eq(transactions.sourceId, sources.id));
    const conditions = [
      options?.economicType ? eq(transactions.economicType, options.economicType) : undefined,
      options?.sourceId ? eq(transactions.sourceId, options.sourceId) : undefined,
      options?.accountId ? eq(transactions.accountId, options.accountId) : undefined,
      options?.currencyCode ? eq(transactions.currencyCode, options.currencyCode) : undefined,
      options?.transactionType ? eq(transactions.transactionType, options.transactionType) : undefined,
      options?.description ? like(transactions.description, `%${options.description}%`) : undefined,
      options?.minAmountMinor !== undefined ? sql`${transactions.amountMinor} >= ${options.minAmountMinor}` : undefined,
      options?.maxAmountMinor !== undefined ? sql`${transactions.amountMinor} <= ${options.maxAmountMinor}` : undefined,
      options?.startDate ? gte(transactions.transactionDate, options.startDate) : undefined,
      options?.endDate ? lte(transactions.transactionDate, `${options.endDate}T99`) : undefined,
      options?.hideTrading212InterestCashbackAndDividends ? sql`not (${sources.slug} = 'trading212' and ${transactions.transactionType} in ('interest', 'cashback', 'dividend'))` : undefined,
      options?.hideTransfers ? sql`${transactions.economicType} <> 'transfer'` : undefined,
    ].filter(Boolean);
    const filteredQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
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

  async summarizeTransactions(options?: { economicType?: EconomicType; sourceId?: number; accountId?: number; currencyCode?: string; transactionType?: string; description?: string; minAmountMinor?: number; maxAmountMinor?: number; startDate?: string; endDate?: string; hideTrading212InterestCashbackAndDividends?: boolean; hideTransfers?: boolean }): Promise<TransactionSummary[]> {
    const query = this.db
      .select({
        currencyCode: transactions.currencyCode,
        transactionCount: sql<number>`count(*)`,
        receivedMinor: sql<number>`coalesce(sum(case when ${transactions.amountMinor} > 0 then ${transactions.amountMinor} else 0 end), 0)`,
        spentMinor: sql<number>`coalesce(sum(case when ${transactions.amountMinor} < 0 then -${transactions.amountMinor} else 0 end), 0)`,
        netMinor: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(sources, eq(transactions.sourceId, sources.id));
    const conditions = [
      options?.economicType ? eq(transactions.economicType, options.economicType) : undefined,
      options?.sourceId ? eq(transactions.sourceId, options.sourceId) : undefined,
      options?.accountId ? eq(transactions.accountId, options.accountId) : undefined,
      options?.currencyCode ? eq(transactions.currencyCode, options.currencyCode) : undefined,
      options?.transactionType ? eq(transactions.transactionType, options.transactionType) : undefined,
      options?.description ? like(transactions.description, `%${options.description}%`) : undefined,
      options?.minAmountMinor !== undefined ? sql`${transactions.amountMinor} >= ${options.minAmountMinor}` : undefined,
      options?.maxAmountMinor !== undefined ? sql`${transactions.amountMinor} <= ${options.maxAmountMinor}` : undefined,
      options?.startDate ? gte(transactions.transactionDate, options.startDate) : undefined,
      options?.endDate ? lte(transactions.transactionDate, `${options.endDate}T99`) : undefined,
      options?.hideTrading212InterestCashbackAndDividends ? sql`not (${sources.slug} = 'trading212' and ${transactions.transactionType} in ('interest', 'cashback', 'dividend'))` : undefined,
      options?.hideTransfers ? sql`${transactions.economicType} <> 'transfer'` : undefined,
    ].filter(Boolean);
    const filteredQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
    return filteredQuery.groupBy(transactions.currencyCode).orderBy(transactions.currencyCode);
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

  async getCashFlowTrend({ startDate, endDate, granularity }: { startDate: string; endDate: string; granularity: "month" | "year" }): Promise<CashFlowTrend[]> {
    const endExclusive = new Date(`${endDate}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const periodExpression = granularity === "month"
      ? sql<string>`substr(${transactions.transactionDate}, 1, 7)`
      : sql<string>`substr(${transactions.transactionDate}, 1, 4)`;
    const rows = await this.db
      .select({
        currencyCode: transactions.currencyCode,
        period: periodExpression,
        incomeMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'income' then ${transactions.amountMinor} else 0 end), 0)`,
        expenseMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)`,
        transferInflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} >= 0 then ${transactions.amountMinor} else 0 end), 0)`,
        transferOutflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} < 0 then ${transactions.amountMinor} else 0 end), 0)`,
        unclassifiedTransactionCount: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'unclassified' then 1 else 0 end), 0)`,
      })
      .from(transactions)
      .where(and(
        gte(transactions.transactionDate, startDate),
        lt(transactions.transactionDate, endExclusive.toISOString().slice(0, 10)),
        sql`not exists (select 1 from ${transactionLinks} where ${transactionLinks.fromTransactionId} = ${transactions.id} and ${transactionLinks.linkType} = 'funds' and ${transactionLinks.status} = 'confirmed')`,
      ))
      .groupBy(transactions.currencyCode, periodExpression)
      .orderBy(transactions.currencyCode, periodExpression);

    const periods = periodsInRange(startDate, endDate, granularity);
    const rowsByCurrency = new Map<string, Map<string, typeof rows[number]>>();
    for (const row of rows) {
      const currencyRows = rowsByCurrency.get(row.currencyCode) ?? new Map<string, typeof row>();
      currencyRows.set(row.period, row);
      rowsByCurrency.set(row.currencyCode, currencyRows);
    }
    return [...rowsByCurrency.entries()].map(([currencyCode, currencyRows]) => ({
      currencyCode,
      periods: periods.map(period => {
        const row = currencyRows.get(period);
        const incomeMinor = row?.incomeMinor ?? 0;
        const expenseMinor = row?.expenseMinor ?? 0;
        return {
          period,
          label: periodLabel(period, granularity),
          incomeMinor,
          expenseMinor,
          netCashFlowMinor: incomeMinor + expenseMinor,
          transferInflowMinor: row?.transferInflowMinor ?? 0,
          transferOutflowMinor: row?.transferOutflowMinor ?? 0,
          unclassifiedTransactionCount: row?.unclassifiedTransactionCount ?? 0,
        };
      }),
    }));
  }
}
