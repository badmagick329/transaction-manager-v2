export const sourceKinds = ["bank", "credit_card", "paypal", "trading212", "manual"] as const;
export type SourceKind = (typeof sourceKinds)[number];

export const accountKinds = [
  "bank_account",
  "credit_card",
  "wallet",
  "investment_cash",
  "investment_portfolio",
  "prepaid_card",
  "manual",
] as const;
export type AccountKind = (typeof accountKinds)[number];

export const economicTypes = ["expense", "income", "transfer", "unclassified"] as const;
export type EconomicType = (typeof economicTypes)[number];

export const economicDirections = ["inflow", "outflow"] as const;
export type EconomicDirection = (typeof economicDirections)[number];

export const classificationMatchModes = ["exact", "starts_with", "contains"] as const;
export type ClassificationMatchMode = (typeof classificationMatchModes)[number];

export const transactionTypes = [
  "unclassified",
  "purchase",
  "direct_debit",
  "transfer",
  "funding",
  "withdrawal",
  "card_payment",
  "refund",
  "fee",
  "cashback",
  "interest",
  "dividend",
  "adjustment",
] as const;
export type TransactionType = (typeof transactionTypes)[number];

export const transactionStatuses = ["pending", "posted", "cancelled"] as const;
export type TransactionStatus = (typeof transactionStatuses)[number];

export const linkTypes = [
  "transfer_to",
  "transfer_from",
  "settles",
  "refund_for",
  "fee_for",
  "cashback_for",
  "proceeds_from",
  "funds",
  "reversal_of",
] as const;
export type LinkType = (typeof linkTypes)[number];

export const linkStatuses = ["pending", "confirmed", "rejected"] as const;
export type LinkStatus = (typeof linkStatuses)[number];

export const linkCreatedBy = ["system_rule", "manual"] as const;
export type LinkCreatedBy = (typeof linkCreatedBy)[number];

export const importBatchStatuses = ["pending", "processed", "failed", "duplicate"] as const;
export type ImportBatchStatus = (typeof importBatchStatuses)[number];

export const importAttemptStatuses = ["pending", "processed", "failed"] as const;
export type ImportAttemptStatus = (typeof importAttemptStatuses)[number];
