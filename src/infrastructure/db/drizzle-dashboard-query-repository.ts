import { and, desc, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import type {
  AccountListItem,
  CoverageAccountSettings,
  CashFlowSourceBreakdown,
  CashFlowTrend,
  CashFlowSummary,
  DataCoverage,
  DashboardQueryRepository,
  LatestImport,
  TransactionListItem,
  TransactionFilters,
  TransactionListOptions,
  TransactionSummary,
} from "../../app/ports/dashboard-query-repository";
import { intersectCoverageFromActivation, mergeCoverageIntervals } from "../../app/data-coverage";
import { exclusiveEndDate } from "../../app/date-range";
import type { AppDatabase } from "./client";
import { accountCoveragePeriods, accounts, cashFlowExclusions, importBatches, rawRecords, sources, tagRules, tags, transactionLinks, transactionManualTags, transactionTagRuleMatches, transactions } from "./schema";

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

function transactionFilterConditions(filters?: TransactionFilters): SQL[] {
  const selectedTagCondition = filters?.tagIds?.length ? or(
    sql`exists (select 1 from ${transactionManualTags} where ${transactionManualTags.transactionId} = ${transactions.id} and ${inArray(transactionManualTags.tagId, filters.tagIds)})`,
    sql`exists (select 1 from ${transactionTagRuleMatches} inner join ${tagRules} on ${tagRules.id} = ${transactionTagRuleMatches.tagRuleId} where ${transactionTagRuleMatches.transactionId} = ${transactions.id} and ${inArray(tagRules.tagId, filters.tagIds)})`,
  ) : undefined;
  const untaggedCondition = filters?.untagged ? and(
    sql`not exists (select 1 from ${transactionManualTags} where ${transactionManualTags.transactionId} = ${transactions.id})`,
    sql`not exists (select 1 from ${transactionTagRuleMatches} where ${transactionTagRuleMatches.transactionId} = ${transactions.id})`,
  ) : undefined;
  return [
    filters?.economicType ? eq(transactions.economicType, filters.economicType) : undefined,
    filters?.sourceId ? eq(transactions.sourceId, filters.sourceId) : undefined,
    filters?.accountId ? eq(transactions.accountId, filters.accountId) : undefined,
    filters?.currencyCode ? eq(transactions.currencyCode, filters.currencyCode) : undefined,
    filters?.transactionType ? eq(transactions.transactionType, filters.transactionType) : undefined,
    filters?.description ? like(transactions.description, `%${filters.description}%`) : undefined,
    filters?.minAmountMinor !== undefined ? sql`${transactions.amountMinor} >= ${filters.minAmountMinor}` : undefined,
    filters?.maxAmountMinor !== undefined ? sql`${transactions.amountMinor} <= ${filters.maxAmountMinor}` : undefined,
    filters?.startDate ? gte(transactions.transactionDate, filters.startDate) : undefined,
    filters?.endDate ? lt(transactions.transactionDate, exclusiveEndDate(filters.endDate)) : undefined,
    filters?.hideTrading212InterestCashbackAndDividends ? sql`not (${sources.slug} = 'trading212' and ${transactions.transactionType} in ('interest', 'cashback', 'dividend'))` : undefined,
    filters?.hideTransfers ? sql`${transactions.economicType} <> 'transfer'` : undefined,
    filters?.cashFlowExcluded === true ? sql`exists (select 1 from ${cashFlowExclusions} where ${cashFlowExclusions.transactionId} = ${transactions.id})` : undefined,
    filters?.cashFlowExcluded === false ? sql`not exists (select 1 from ${cashFlowExclusions} where ${cashFlowExclusions.transactionId} = ${transactions.id})` : undefined,
    selectedTagCondition && untaggedCondition ? or(selectedTagCondition, untaggedCondition) : selectedTagCondition ?? untaggedCondition,
  ].filter((condition): condition is SQL => condition !== undefined);
}

function cashFlowScopeConditions(): SQL[] {
  return [
    sql`not exists (select 1 from ${transactionLinks} where ${transactionLinks.fromTransactionId} = ${transactions.id} and ${transactionLinks.linkType} = 'funds' and ${transactionLinks.status} = 'confirmed')`,
    sql`not exists (select 1 from ${cashFlowExclusions} where ${cashFlowExclusions.transactionId} = ${transactions.id})`,
  ];
}

function cashFlowAggregateFields() {
  return {
    incomeMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'income' then ${transactions.amountMinor} else 0 end), 0)`,
    expenseMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'expense' then ${transactions.amountMinor} else 0 end), 0)`,
    netCashFlowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} in ('income', 'expense') then ${transactions.amountMinor} else 0 end), 0)`,
    transferInflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} >= 0 then ${transactions.amountMinor} else 0 end), 0)`,
    transferOutflowMinor: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'transfer' and ${transactions.amountMinor} < 0 then ${transactions.amountMinor} else 0 end), 0)`,
    unclassifiedTransactionCount: sql<number>`coalesce(sum(case when ${transactions.economicType} = 'unclassified' then 1 else 0 end), 0)`,
  };
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

  async listTransactions(options?: TransactionListOptions): Promise<TransactionListItem[]> {
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
    const conditions = transactionFilterConditions(options);
    const filteredQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
    const orderedQuery = filteredQuery.orderBy(desc(transactions.transactionDate), desc(transactions.id));
    const transactionRows = options?.limit ? await orderedQuery.limit(options.limit).offset(options.offset ?? 0) : await orderedQuery;
    if (transactionRows.length === 0) return [];
    const transactionIds = transactionRows.map(transaction => transaction.id);
    const [links, exclusions, manualTagRows, automaticTagRows] = await Promise.all([
      this.db.select().from(transactionLinks).where(and(
        eq(transactionLinks.linkType, "funds"),
        eq(transactionLinks.createdBy, "system_rule"),
        or(inArray(transactionLinks.fromTransactionId, transactionIds), inArray(transactionLinks.toTransactionId, transactionIds)),
      )),
      this.db.select({ transactionId: cashFlowExclusions.transactionId }).from(cashFlowExclusions).where(inArray(cashFlowExclusions.transactionId, transactionIds)),
      this.db.select({ transactionId: transactionManualTags.transactionId, tagId: tags.id, tagName: tags.name })
        .from(transactionManualTags)
        .innerJoin(tags, eq(transactionManualTags.tagId, tags.id))
        .where(inArray(transactionManualTags.transactionId, transactionIds)),
      this.db.select({ transactionId: transactionTagRuleMatches.transactionId, tagId: tags.id, tagName: tags.name })
        .from(transactionTagRuleMatches)
        .innerJoin(tagRules, eq(transactionTagRuleMatches.tagRuleId, tagRules.id))
        .innerJoin(tags, eq(tagRules.tagId, tags.id))
        .where(inArray(transactionTagRuleMatches.transactionId, transactionIds)),
    ]);
    const excludedTransactionIds = new Set(exclusions.map(exclusion => exclusion.transactionId));
    const tagsByTransaction = new Map<number, Map<number, { id: number; name: string; manual: boolean; automatic: boolean }>>();
    for (const assignment of manualTagRows) {
      const transactionTags = tagsByTransaction.get(assignment.transactionId) ?? new Map();
      transactionTags.set(assignment.tagId, { id: assignment.tagId, name: assignment.tagName, manual: true, automatic: transactionTags.get(assignment.tagId)?.automatic ?? false });
      tagsByTransaction.set(assignment.transactionId, transactionTags);
    }
    for (const assignment of automaticTagRows) {
      const transactionTags = tagsByTransaction.get(assignment.transactionId) ?? new Map();
      transactionTags.set(assignment.tagId, { id: assignment.tagId, name: assignment.tagName, manual: transactionTags.get(assignment.tagId)?.manual ?? false, automatic: true });
      tagsByTransaction.set(assignment.transactionId, transactionTags);
    }
    return transactionRows.map(transaction => {
      const fromLink = links.find(link => link.fromTransactionId === transaction.id && link.status !== "rejected");
      const toLink = links.find(link => link.toTransactionId === transaction.id && link.status !== "rejected");
      const reconciliationLabel = fromLink
        ? fromLink.status === "confirmed" ? "Linked to PayPal purchase" : "PayPal match pending"
        : toLink ? toLink.status === "confirmed" ? "Funded by HSBC PayPal payment" : "HSBC match pending" : null;
      const transactionTags = [...(tagsByTransaction.get(transaction.id)?.values() ?? [])].sort((left, right) => left.name.localeCompare(right.name));
      return { ...transaction, reconciliationLabel, isExcludedFromCashFlow: excludedTransactionIds.has(transaction.id), tags: transactionTags };
    });
  }

  async summarizeTransactions(options?: TransactionFilters): Promise<TransactionSummary[]> {
    const { unclassifiedTransactionCount: _unclassifiedTransactionCount, ...summaryAggregateFields } = cashFlowAggregateFields();
    const query = this.db
      .select({
        currencyCode: transactions.currencyCode,
        transactionCount: sql<number>`count(*)`,
        ...summaryAggregateFields,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(sources, eq(transactions.sourceId, sources.id));
    const conditions = [...transactionFilterConditions(options), ...cashFlowScopeConditions()];
    const filteredQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
    return filteredQuery.groupBy(transactions.currencyCode).orderBy(transactions.currencyCode);
  }

  async setCashFlowExcluded(transactionId: number, excluded: boolean) {
    if (excluded) {
      await this.db.insert(cashFlowExclusions).values({ transactionId }).onConflictDoNothing();
      return;
    }
    await this.db.delete(cashFlowExclusions).where(eq(cashFlowExclusions.transactionId, transactionId));
  }

  async getCashFlowExclusionCount() {
    const [row] = await this.db.select({ count: sql<number>`count(*)` }).from(cashFlowExclusions);
    return row?.count ?? 0;
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

  async getDataCoverage(): Promise<DataCoverage> {
    const [accountRows, coverageRows, activityRows, transactionImportRows, coverageImportRows] = await Promise.all([
      this.db
        .select({
          accountId: accounts.id,
          accountName: accounts.name,
          currencyCode: accounts.currencyCode,
          sourceId: sources.id,
          sourceName: sources.name,
          sourceKind: sources.kind,
          required: accounts.coverageRequired,
        })
        .from(accounts)
        .innerJoin(sources, eq(accounts.sourceId, sources.id))
        .orderBy(sources.name, accounts.name),
      this.db.select().from(accountCoveragePeriods).orderBy(accountCoveragePeriods.startDate, accountCoveragePeriods.endDate),
      this.db
        .select({
          accountId: transactions.accountId,
          earliestTransactionDate: sql<string | null>`min(${transactions.transactionDate})`,
          latestTransactionDate: sql<string | null>`max(${transactions.transactionDate})`,
        })
        .from(transactions)
        .groupBy(transactions.accountId),
      this.db
        .select({ accountId: transactions.accountId, lastImportAt: sql<string | null>`max(${importBatches.importedAt})` })
        .from(transactions)
        .innerJoin(rawRecords, eq(transactions.rawRecordId, rawRecords.id))
        .innerJoin(importBatches, eq(rawRecords.importBatchId, importBatches.id))
        .groupBy(transactions.accountId),
      this.db
        .select({ accountId: accountCoveragePeriods.accountId, lastImportAt: sql<string | null>`max(${importBatches.importedAt})` })
        .from(accountCoveragePeriods)
        .innerJoin(importBatches, eq(accountCoveragePeriods.importBatchId, importBatches.id))
        .where(eq(accountCoveragePeriods.origin, "import"))
        .groupBy(accountCoveragePeriods.accountId),
    ]);
    const activityByAccount = new Map(activityRows.map(row => [row.accountId, row]));
    const lastImportByAccount = new Map<number, string | null>();
    for (const row of [...transactionImportRows, ...coverageImportRows]) {
      const current = lastImportByAccount.get(row.accountId);
      if (row.lastImportAt && (!current || row.lastImportAt > current)) lastImportByAccount.set(row.accountId, row.lastImportAt);
    }
    const periodsByAccount = new Map<number, typeof coverageRows>();
    for (const period of coverageRows) {
      const periods = periodsByAccount.get(period.accountId) ?? [];
      periods.push(period);
      periodsByAccount.set(period.accountId, periods);
    }
    const rawCoverageAccounts = accountRows.map(account => {
      const periods = periodsByAccount.get(account.accountId) ?? [];
      const manual = periods.find(period => period.origin === "manual") ?? null;
      return {
        ...account,
        earliestTransactionDate: activityByAccount.get(account.accountId)?.earliestTransactionDate ?? null,
        latestTransactionDate: activityByAccount.get(account.accountId)?.latestTransactionDate ?? null,
        lastImportAt: lastImportByAccount.get(account.accountId) ?? null,
        coverageIntervals: mergeCoverageIntervals(periods.map(period => ({ startDate: period.startDate, endDate: period.endDate }))),
        manualBaseline: manual ? { startDate: manual.startDate, endDate: manual.endDate } : null,
      };
    });
    const recommendedBySource = new Map<number, { startDate: string; endDate: string }>();
    for (const account of rawCoverageAccounts) {
      if (!account.earliestTransactionDate || !account.latestTransactionDate) continue;
      const startDate = account.earliestTransactionDate.slice(0, 10);
      const endDate = account.latestTransactionDate.slice(0, 10);
      const current = recommendedBySource.get(account.sourceId);
      recommendedBySource.set(account.sourceId, {
        startDate: !current || startDate < current.startDate ? startDate : current.startDate,
        endDate: !current || endDate > current.endDate ? endDate : current.endDate,
      });
    }
    const paypalCoverageBySource = new Map<number, Array<{ startDate: string; endDate: string }>>();
    for (const account of rawCoverageAccounts.filter(account => account.sourceKind === "paypal")) {
      const intervals = paypalCoverageBySource.get(account.sourceId) ?? [];
      intervals.push(...account.coverageIntervals);
      paypalCoverageBySource.set(account.sourceId, intervals);
    }
    const coverageAccounts = rawCoverageAccounts.map(({ sourceKind, ...account }) => ({
      ...account,
      coverageIntervals: sourceKind === "paypal"
        ? mergeCoverageIntervals(paypalCoverageBySource.get(account.sourceId) ?? [])
        : account.coverageIntervals,
      recommendedBaseline: recommendedBySource.get(account.sourceId) ?? null,
    }));
    const requiredAccounts = coverageAccounts.filter(account => account.required);
    const blockingAccountIds = requiredAccounts.filter(account => account.coverageIntervals.length === 0).map(account => account.accountId);
    const commonIntervals = blockingAccountIds.length === 0 && requiredAccounts.length > 0
      ? intersectCoverageFromActivation(requiredAccounts.map(account => account.coverageIntervals))
      : [];
    return {
      accounts: coverageAccounts,
      commonIntervals,
      commonCoveredThrough: commonIntervals.at(-1)?.endDate ?? null,
      blockingAccountIds,
    };
  }

  async updateCoverageAccountSettings(settings: CoverageAccountSettings) {
    const existing = await this.db.query.accounts.findFirst({ where: eq(accounts.id, settings.accountId) });
    if (!existing) throw new Error("Account not found.");
    await this.db.transaction(async tx => {
      const timestamp = new Date().toISOString();
      await tx.update(accounts).set({ coverageRequired: settings.required, updatedAt: timestamp }).where(eq(accounts.id, settings.accountId));
      await tx.delete(accountCoveragePeriods).where(and(
        eq(accountCoveragePeriods.accountId, settings.accountId),
        eq(accountCoveragePeriods.origin, "manual"),
      ));
      if (settings.baselineStartDate && settings.baselineEndDate) {
        await tx.insert(accountCoveragePeriods).values({
          accountId: settings.accountId,
          importBatchId: null,
          origin: "manual",
          startDate: settings.baselineStartDate,
          endDate: settings.baselineEndDate,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    });
  }

  async getCashFlowSummary({ startDate, endDate }: { startDate: string; endDate: string }): Promise<CashFlowSummary[]> {
    const dateRange = and(
      gte(transactions.transactionDate, startDate),
      lt(transactions.transactionDate, exclusiveEndDate(endDate)),
      ...cashFlowScopeConditions(),
    );
    const [summaries, sourceRows] = await Promise.all([
      this.db
      .select({
        currencyCode: transactions.currencyCode,
        ...cashFlowAggregateFields(),
      })
      .from(transactions)
      .where(dateRange)
      .groupBy(transactions.currencyCode)
      .orderBy(transactions.currencyCode),
      this.db
        .select({
          currencyCode: transactions.currencyCode,
          sourceName: sources.name,
          ...cashFlowAggregateFields(),
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
    const periodExpression = granularity === "month"
      ? sql<string>`substr(${transactions.transactionDate}, 1, 7)`
      : sql<string>`substr(${transactions.transactionDate}, 1, 4)`;
    const rows = await this.db
      .select({
        currencyCode: transactions.currencyCode,
        period: periodExpression,
        ...cashFlowAggregateFields(),
      })
      .from(transactions)
      .where(and(
        gte(transactions.transactionDate, startDate),
        lt(transactions.transactionDate, exclusiveEndDate(endDate)),
        ...cashFlowScopeConditions(),
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
