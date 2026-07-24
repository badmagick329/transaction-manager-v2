import type { ClassificationMatchMode, EconomicDirection, EconomicType } from "../../core/finance/constants";

export type ClassificationRule = {
  id: number;
  sourceId: number;
  sourceName: string;
  normalizedDescription: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
  economicType: EconomicType;
  createdAt: string;
  updatedAt: string;
};

export type ClassificationReviewGroup = {
  sourceId: number;
  sourceName: string;
  description: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
  transactionCount: number;
  latestTransactionDate: string;
  samples: Array<{
    id: number;
    transactionDate: string;
    amountMinor: number;
    currencyCode: string;
  }>;
};

export type SaveClassificationRuleInput = {
  sourceId: number;
  description: string;
  direction: EconomicDirection;
  economicType: EconomicType;
};

export type ClassificationRuleResult = {
  rule: ClassificationRule;
  affectedTransactionCount: number;
};

export type ClassificationRepository = {
  listReviewGroups(): Promise<ClassificationReviewGroup[]>;
  listRules(): Promise<ClassificationRule[]>;
  saveRule(input: SaveClassificationRuleInput): Promise<ClassificationRuleResult>;
  deleteRule(ruleId: number): Promise<{ affectedTransactionCount: number }>;
};
