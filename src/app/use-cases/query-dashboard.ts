import type { DashboardQueryRepository } from "../ports/dashboard-query-repository";

export function createDashboardQueries(repository: DashboardQueryRepository) {
  return {
    listAccounts: () => repository.listAccounts(),
    listTransactions: () => repository.listTransactions(),
    getLatestImport: () => repository.getLatestImport(),
  };
}
