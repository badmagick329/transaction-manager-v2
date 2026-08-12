import type { SaveTagRuleInput, TaggingRepository } from "../ports/tagging-repository";

export function createTaggingActions(repository: TaggingRepository) {
  return {
    listTags: () => repository.listTags(),
    createTag: (name: string) => repository.createTag(name),
    renameTag: (tagId: number, name: string) => repository.renameTag(tagId, name),
    deleteTag: (tagId: number) => repository.deleteTag(tagId),
    setManualTag: (transactionId: number, tagId: number, assigned: boolean) => repository.setManualTag(transactionId, tagId, assigned),
    listRules: () => repository.listRules(),
    saveRule: (input: SaveTagRuleInput) => repository.saveRule(input),
    deleteRule: (ruleId: number) => repository.deleteRule(ruleId),
  };
}
