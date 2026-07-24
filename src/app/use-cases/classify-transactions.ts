import type { ClassificationRepository, SaveClassificationRuleInput } from "../ports/classification-repository";

export function createClassificationActions(repository: ClassificationRepository) {
  return {
    listReviewGroups: () => repository.listReviewGroups(),
    listRules: () => repository.listRules(),
    saveRule: (input: SaveClassificationRuleInput) => repository.saveRule(input),
    deleteRule: (ruleId: number) => repository.deleteRule(ruleId),
  };
}
