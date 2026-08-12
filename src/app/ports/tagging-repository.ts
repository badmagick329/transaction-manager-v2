import type { ClassificationMatchMode, EconomicDirection } from "../../core/finance/constants";

export type Tag = {
  id: number;
  name: string;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TagRule = {
  id: number;
  tagId: number;
  tagName: string;
  sourceId: number;
  sourceName: string;
  normalizedDescription: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
  createdAt: string;
  updatedAt: string;
};

export type SaveTagRuleInput = {
  ruleId?: number;
  tagId: number;
  sourceId: number;
  description: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
};

export type TaggingRepository = {
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  renameTag(tagId: number, name: string): Promise<Tag>;
  deleteTag(tagId: number): Promise<void>;
  setManualTag(transactionId: number, tagId: number, assigned: boolean): Promise<void>;
  listRules(): Promise<TagRule[]>;
  saveRule(input: SaveTagRuleInput): Promise<{ rule: TagRule; affectedTransactionCount: number }>;
  deleteRule(ruleId: number): Promise<{ affectedTransactionCount: number }>;
};
