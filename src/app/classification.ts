import type { ClassificationMatchMode, EconomicDirection, EconomicType } from "../core/finance/constants";

export function economicTypesForDirection(direction: EconomicDirection): EconomicType[] {
  return direction === "inflow" ? ["income", "transfer", "unclassified"] : ["expense", "transfer", "unclassified"];
}

export function isEconomicTypeAllowedForDirection(economicType: EconomicType, direction: EconomicDirection) {
  return economicTypesForDirection(direction).includes(economicType);
}

export function normalizeDescription(description: string) {
  return description.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function economicDirectionForAmount(amountMinor: number): EconomicDirection {
  return amountMinor < 0 ? "outflow" : "inflow";
}

export function descriptionMatchesRule(description: string, matchValue: string, matchMode: ClassificationMatchMode) {
  const normalizedDescription = normalizeDescription(description);
  switch (matchMode) {
    case "all":
      return true;
    case "exact":
      return normalizedDescription === matchValue;
    case "starts_with":
      return normalizedDescription.startsWith(matchValue);
    case "contains":
      return normalizedDescription.includes(matchValue);
  }
}

export function ruleMatchPriority(matchMode: ClassificationMatchMode) {
  return matchMode === "exact" ? 4 : matchMode === "starts_with" ? 3 : matchMode === "contains" ? 2 : 1;
}

export function automaticEconomicType(sourceSlug: string, transactionType: string, amountMinor: number): EconomicType | undefined {
  if (sourceSlug !== "trading212") return undefined;
  if (transactionType === "purchase" && amountMinor < 0) return "expense";
  if (transactionType === "refund" && amountMinor > 0) return "income";
  return undefined;
}
