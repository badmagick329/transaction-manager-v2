import type { LinkStatus } from "../../core/finance/constants";

export type PayPalPaymentLink = {
  id: number;
  status: LinkStatus;
  confidenceScore: number | null;
  matchReason: string | null;
  hsbcTransaction: { id: number; transactionDate: string; description: string; amountMinor: number; currencyCode: string };
  paypalTransaction: { id: number; transactionDate: string; description: string; amountMinor: number; currencyCode: string };
};

export type ReconciliationRepository = {
  proposePayPalPaymentLinks(): Promise<number>;
  listPayPalPaymentLinks(): Promise<PayPalPaymentLink[]>;
  setPayPalPaymentLinkStatus(linkId: number, status: LinkStatus): Promise<PayPalPaymentLink>;
};
