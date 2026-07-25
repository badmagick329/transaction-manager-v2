import type { EconomicType, TransactionType } from "../../core/finance/constants";
import type { DashboardQueryRepository } from "../ports/dashboard-query-repository";

export function createDashboardQueries(repository: DashboardQueryRepository) {
  return {
    listAccounts: () => repository.listAccounts(),
    listTransactions: (options?: { limit?: number; offset?: number; economicType?: EconomicType; sourceId?: number; accountId?: number; currencyCode?: string; transactionType?: TransactionType; description?: string; minAmountMinor?: number; maxAmountMinor?: number; startDate?: string; endDate?: string }) => repository.listTransactions(options),
    getLatestImport: () => repository.getLatestImport(),
    getCashFlowSummary: (range: { startDate: string; endDate: string }) => repository.getCashFlowSummary(range),
    getCashFlowTrend: (range: { startDate: string; endDate: string; granularity: "month" | "year" }) => repository.getCashFlowTrend(range),
  };
}
