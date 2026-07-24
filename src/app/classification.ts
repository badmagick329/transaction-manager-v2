import type { ClassificationMatchMode, EconomicDirection } from "../core/finance/constants";

export function normalizeDescription(description: string) {
  return description.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function economicDirectionForAmount(amountMinor: number): EconomicDirection {
  return amountMinor < 0 ? "outflow" : "inflow";
}

export function descriptionMatchesRule(description: string, matchValue: string, matchMode: ClassificationMatchMode) {
  const normalizedDescription = normalizeDescription(description);
  switch (matchMode) {
    case "exact":
      return normalizedDescription === matchValue;
    case "starts_with":
      return normalizedDescription.startsWith(matchValue);
    case "contains":
      return normalizedDescription.includes(matchValue);
  }
}

export function ruleMatchPriority(matchMode: ClassificationMatchMode) {
  return matchMode === "exact" ? 3 : matchMode === "starts_with" ? 2 : 1;
}
