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
  listTransactions(options?: { limit?: number; offset?: number; economicType?: EconomicType; sourceId?: number; accountId?: number; currencyCode?: string; transactionType?: TransactionType; description?: string; minAmountMinor?: number; maxAmountMinor?: number; startDate?: string; endDate?: string; hideTrading212InterestCashbackAndDividends?: boolean; hideTransfers?: boolean; cashFlowExcluded?: boolean }): Promise<TransactionListItem[]>;
  summarizeTransactions(options?: { economicType?: EconomicType; sourceId?: number; accountId?: number; currencyCode?: string; transactionType?: TransactionType; description?: string; minAmountMinor?: number; maxAmountMinor?: number; startDate?: string; endDate?: string; hideTrading212InterestCashbackAndDividends?: boolean; hideTransfers?: boolean; cashFlowExcluded?: boolean }): Promise<TransactionSummary[]>;
  setCashFlowExcluded(transactionId: number, excluded: boolean): Promise<void>;
  getCashFlowExclusionCount(): Promise<number>;
  getLatestImport(): Promise<LatestImport>;
  getCashFlowSummary(range: { startDate: string; endDate: string }): Promise<CashFlowSummary[]>;
  getCashFlowTrend(range: { startDate: string; endDate: string; granularity: "month" | "year" }): Promise<CashFlowTrend[]>;
};
import type { EconomicType, TransactionType } from "../../core/finance/constants";
