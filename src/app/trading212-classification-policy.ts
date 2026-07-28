import type { ClassificationMatchMode, EconomicDirection, EconomicType } from "../core/finance/constants";

export type SourceDefaultClassificationRule = {
  description: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
  economicType: EconomicType;
};

export const trading212DefaultClassificationRules: SourceDefaultClassificationRule[] = [
  { description: "*", matchMode: "all", direction: "inflow", economicType: "transfer" },
  { description: "*", matchMode: "all", direction: "outflow", economicType: "transfer" },
  { description: "Card purchase", matchMode: "starts_with", direction: "outflow", economicType: "expense" },
  { description: "Card cashback", matchMode: "starts_with", direction: "inflow", economicType: "income" },
  { description: "Spending cashback", matchMode: "starts_with", direction: "inflow", economicType: "income" },
  { description: "Spending cashback", matchMode: "starts_with", direction: "outflow", economicType: "expense" },
];

export function trading212AutomaticEconomicType(transactionType: string, amountMinor: number): EconomicType | undefined {
  if (transactionType === "purchase" && amountMinor < 0) return "expense";
  if (transactionType === "refund" && amountMinor > 0) return "income";
  return undefined;
}
