export type AccountListItem = {
  id: number;
  name: string;
  kind: string;
  currencyCode: string;
  sourceName: string | null;
  sourceId: number | null;
};

export type TransactionListItem = {
  id: number;
  accountId: number;
  accountName: string;
  sourceId: number;
  sourceName: string;
  transactionDate: string;
  postedDate: string | null;
  description: string;
  amountMinor: number;
  currencyCode: string;
  transactionType: string;
  economicType: string;
  status: string;
  reconciliationLabel: string | null;
  isExcludedFromCashFlow: boolean;
  tags: Array<{ id: number; name: string; manual: boolean; automatic: boolean }>;
};

export type TransactionSummary = {
  currencyCode: string;
  transactionCount: number;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
};

export type TransactionFilters = {
  economicType?: EconomicType;
  sourceId?: number;
  accountId?: number;
  currencyCode?: string;
  transactionType?: TransactionType;
  description?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  startDate?: string;
  endDate?: string;
  hideTrading212InterestCashbackAndDividends?: boolean;
  hideTransfers?: boolean;
  cashFlowExcluded?: boolean;
  tagIds?: number[];
  untagged?: boolean;
};

export type TransactionListOptions = TransactionFilters & {
  limit?: number;
  offset?: number;
};

export type LatestImport = {
  id: number;
  fileName: string;
  status: string;
  recordCount: number;
  duplicateRecordCount: number;
  attemptCount: number;
  errorMessage: string | null;
  importedAt: string | null;
  createdAt: string;
} | null;

export type DataCoverageAccount = {
  accountId: number;
  accountName: string;
  currencyCode: string;
  sourceId: number;
  sourceName: string;
  required: boolean;
  earliestTransactionDate: string | null;
  latestTransactionDate: string | null;
  lastImportAt: string | null;
  coverageIntervals: CoverageInterval[];
  manualBaseline: CoverageInterval | null;
};

export type DataCoverage = {
  accounts: DataCoverageAccount[];
  commonIntervals: CoverageInterval[];
  commonCoveredThrough: string | null;
  blockingAccountIds: number[];
};

export type CoverageAccountSettings = {
  accountId: number;
  required: boolean;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
};

export type CashFlowSourceBreakdown = {
  sourceName: string;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
};

export type CashFlowSummary = {
  currencyCode: string;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
  unclassifiedTransactionCount: number;
  sources: CashFlowSourceBreakdown[];
};

export type CashFlowPeriod = {
  period: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  transferInflowMinor: number;
  transferOutflowMinor: number;
  unclassifiedTransactionCount: number;
};

export type CashFlowTrend = {
  currencyCode: string;
  periods: CashFlowPeriod[];
};

export type DashboardQueryRepository = {
  listAccounts(): Promise<AccountListItem[]>;
  listTransactions(options?: TransactionListOptions): Promise<TransactionListItem[]>;
  summarizeTransactions(options?: TransactionFilters): Promise<TransactionSummary[]>;
  setCashFlowExcluded(transactionId: number, excluded: boolean): Promise<void>;
  getCashFlowExclusionCount(): Promise<number>;
  getLatestImport(): Promise<LatestImport>;
  getDataCoverage(): Promise<DataCoverage>;
  updateCoverageAccountSettings(settings: CoverageAccountSettings): Promise<void>;
  getCashFlowSummary(range: { startDate: string; endDate: string }): Promise<CashFlowSummary[]>;
  getCashFlowTrend(range: { startDate: string; endDate: string; granularity: "month" | "year" }): Promise<CashFlowTrend[]>;
};
import type { EconomicType, TransactionType } from "../../core/finance/constants";
import type { CoverageInterval } from "../data-coverage";
