export type AccountListItem = {
  id: number;
  name: string;
  kind: string;
  currencyCode: string;
  sourceName: string | null;
};

export type TransactionListItem = {
  id: number;
  accountId: number;
  accountName: string;
  transactionDate: string;
  postedDate: string | null;
  description: string;
  amountMinor: number;
  currencyCode: string;
  transactionType: string;
  economicType: string;
  status: string;
  reconciliationLabel: string | null;
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

export type DashboardQueryRepository = {
  listAccounts(): Promise<AccountListItem[]>;
  listTransactions(options?: { limit?: number; offset?: number; economicType?: EconomicType }): Promise<TransactionListItem[]>;
  getLatestImport(): Promise<LatestImport>;
  getCashFlowSummary(range: { startDate: string; endDate: string }): Promise<CashFlowSummary[]>;
};
import type { EconomicType } from "../../core/finance/constants";
