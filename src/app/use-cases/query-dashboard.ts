import type { DashboardQueryRepository, TransactionFilters, TransactionListOptions } from "../ports/dashboard-query-repository";

export function createDashboardQueries(repository: DashboardQueryRepository) {
  return {
    listAccounts: () => repository.listAccounts(),
    listTransactions: (options?: TransactionListOptions) => repository.listTransactions(options),
    summarizeTransactions: (options?: TransactionFilters) => repository.summarizeTransactions(options),
    setCashFlowExcluded: (transactionId: number, excluded: boolean) => repository.setCashFlowExcluded(transactionId, excluded),
    getCashFlowExclusionCount: () => repository.getCashFlowExclusionCount(),
    getLatestImport: () => repository.getLatestImport(),
    getCashFlowSummary: (range: { startDate: string; endDate: string }) => repository.getCashFlowSummary(range),
    getCashFlowTrend: (range: { startDate: string; endDate: string; granularity: "month" | "year" }) => repository.getCashFlowTrend(range),
  };
}
