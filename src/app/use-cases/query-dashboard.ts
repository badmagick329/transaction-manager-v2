import type { EconomicType } from "../../core/finance/constants";
import type { DashboardQueryRepository } from "../ports/dashboard-query-repository";

export function createDashboardQueries(repository: DashboardQueryRepository) {
  return {
    listAccounts: () => repository.listAccounts(),
    listTransactions: (options?: { limit?: number; offset?: number; economicType?: EconomicType }) => repository.listTransactions(options),
    getLatestImport: () => repository.getLatestImport(),
    getCashFlowSummary: (range: { startDate: string; endDate: string }) => repository.getCashFlowSummary(range),
  };
}
