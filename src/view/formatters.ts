import type { EconomicDirection, EconomicType } from "./types";

export const economicTypeOptions: EconomicType[] = ["expense", "income", "transfer", "unclassified"];
export const matchModeOptions = ["exact", "starts_with", "contains", "all"] as const;

export function economicTypeOptionsForDirection(direction: EconomicDirection): EconomicType[] {
  return direction === "inflow" ? ["income", "transfer", "unclassified"] : ["expense", "transfer", "unclassified"];
}

export function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, minimumFractionDigits: 2 }).format(amountMinor / 100);
}

export function formatCompactMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, notation: "compact", maximumFractionDigits: 1 }).format(amountMinor / 100);
}

export function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export function formatTransactionDate(transactionDate: string) {
  return transactionDate.slice(0, 10);
}
