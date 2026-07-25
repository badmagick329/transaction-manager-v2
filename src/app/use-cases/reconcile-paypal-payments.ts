import type { LinkStatus } from "../../core/finance/constants";
import type { ReconciliationRepository } from "../ports/reconciliation-repository";

export function createPayPalPaymentReconciliation(repository: ReconciliationRepository) {
  return {
    proposeLinks: () => repository.proposePayPalPaymentLinks(),
    listLinks: () => repository.listPayPalPaymentLinks(),
    setLinkStatus: (linkId: number, status: LinkStatus) => repository.setPayPalPaymentLinkStatus(linkId, status),
  };
}
