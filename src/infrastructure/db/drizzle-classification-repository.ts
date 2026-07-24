import { and, asc, eq, inArray } from "drizzle-orm";
import { descriptionMatchesRule, economicDirectionForAmount, normalizeDescription, ruleMatchPriority } from "../../app/classification";
import type {
  ClassificationRepository,
  ClassificationReviewGroup,
  ClassificationRule,
  ClassificationRuleResult,
  SaveClassificationRuleInput,
} from "../../app/ports/classification-repository";
import type { EconomicType } from "../../core/finance/constants";
import type { AppDatabase } from "./client";
import { classificationRules, economicClassificationAudits, sources, transactions } from "./schema";

const now = () => new Date().toISOString();

function toRule(row: typeof classificationRules.$inferSelect, sourceName: string): ClassificationRule {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName,
    normalizedDescription: row.normalizedDescription,
    matchMode: row.matchMode,
    direction: row.direction,
    economicType: row.economicType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleClassificationRepository implements ClassificationRepository {
  constructor(private readonly db: AppDatabase) {}

  async listReviewGroups(): Promise<ClassificationReviewGroup[]> {
    const [transactionRows, ruleRows] = await Promise.all([
      this.db
        .select({
          id: transactions.id,
          sourceId: transactions.sourceId,
          sourceName: sources.name,
          description: transactions.description,
          amountMinor: transactions.amountMinor,
          currencyCode: transactions.currencyCode,
          transactionDate: transactions.transactionDate,
        })
        .from(transactions)
        .innerJoin(sources, eq(transactions.sourceId, sources.id)),
      this.db.select().from(classificationRules),
    ]);
    const groups = new Map<string, ClassificationReviewGroup>();

    for (const transaction of transactionRows) {
      const direction = economicDirectionForAmount(transaction.amountMinor);
      const normalizedDescription = normalizeDescription(transaction.description);
      const key = this.ruleKey(transaction.sourceId, normalizedDescription, direction);
      if (ruleRows.some(rule => rule.sourceId === transaction.sourceId && this.matchesRule(rule, transaction.description, direction))) continue;

      const existing = groups.get(key);
      const sample = {
        id: transaction.id,
        transactionDate: transaction.transactionDate,
        amountMinor: transaction.amountMinor,
        currencyCode: transaction.currencyCode,
      };
      if (existing) {
        existing.transactionCount += 1;
        if (transaction.transactionDate > existing.latestTransactionDate) existing.latestTransactionDate = transaction.transactionDate;
        if (existing.samples.length < 3) existing.samples.push(sample);
        continue;
      }
      groups.set(key, {
        sourceId: transaction.sourceId,
        sourceName: transaction.sourceName,
        description: transaction.description,
        direction,
        transactionCount: 1,
        latestTransactionDate: transaction.transactionDate,
        samples: [sample],
      });
    }

    return [...groups.values()].sort(
      (left, right) => right.transactionCount - left.transactionCount || right.latestTransactionDate.localeCompare(left.latestTransactionDate),
    );
  }

  async listRules(): Promise<ClassificationRule[]> {
    const rows = await this.db
      .select({ rule: classificationRules, sourceName: sources.name })
      .from(classificationRules)
      .innerJoin(sources, eq(classificationRules.sourceId, sources.id))
      .orderBy(asc(sources.name), asc(classificationRules.normalizedDescription));
    return rows.map(({ rule, sourceName }) => toRule(rule, sourceName));
  }

  async saveRule(input: SaveClassificationRuleInput): Promise<ClassificationRuleResult> {
    const normalizedDescription = normalizeDescription(input.description);
    const timestamp = now();
    return this.db.transaction(async tx => {
      const existing = await tx.query.classificationRules.findFirst({
        where: and(
          eq(classificationRules.sourceId, input.sourceId),
          eq(classificationRules.normalizedDescription, normalizedDescription),
          eq(classificationRules.direction, input.direction),
          eq(classificationRules.matchMode, input.matchMode),
        ),
      });
      let rule: typeof classificationRules.$inferSelect;
      if (existing) {
        [rule] = await tx
          .update(classificationRules)
          .set({ economicType: input.economicType, updatedAt: timestamp })
          .where(eq(classificationRules.id, existing.id))
          .returning();
      } else {
        [rule] = await tx
          .insert(classificationRules)
          .values({
            sourceId: input.sourceId,
            normalizedDescription,
            matchMode: input.matchMode,
            direction: input.direction,
            economicType: input.economicType,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
      }
      const affectedTransactionCount = await this.reapplySourceRules(tx, rule.sourceId, "rule_applied");
      const source = await tx.query.sources.findFirst({ where: eq(sources.id, rule.sourceId) });
      if (!source) throw new Error("The classification rule source no longer exists.");
      return { rule: toRule(rule, source.name), affectedTransactionCount };
    });
  }

  async deleteRule(ruleId: number): Promise<{ affectedTransactionCount: number }> {
    return this.db.transaction(async tx => {
      const rule = await tx.query.classificationRules.findFirst({ where: eq(classificationRules.id, ruleId) });
      if (!rule) throw new Error("Classification rule not found.");
      await tx.delete(classificationRules).where(eq(classificationRules.id, ruleId));
      return { affectedTransactionCount: await this.reapplySourceRules(tx, rule.sourceId, "rule_removed") };
    });
  }

  private async reapplySourceRules(db: AppDatabase, sourceId: number, reason: string) {
    const [sourceRules, sourceTransactions] = await Promise.all([
      db.select().from(classificationRules).where(eq(classificationRules.sourceId, sourceId)),
      db.select().from(transactions).where(eq(transactions.sourceId, sourceId)),
    ]);
    const timestamp = now();
    const changes: Array<{
      transactionId: number;
      previousEconomicType: typeof transactions.$inferSelect.economicType;
      newEconomicType: typeof transactions.$inferSelect.economicType;
      classificationRuleId: number | null;
    }> = [];
    for (const transaction of sourceTransactions) {
      const matchingRule = sourceRules
        .filter(rule => this.matchesRule(rule, transaction.description, economicDirectionForAmount(transaction.amountMinor)))
        .sort(
          (left, right) =>
            ruleMatchPriority(right.matchMode) - ruleMatchPriority(left.matchMode) ||
            right.normalizedDescription.length - left.normalizedDescription.length ||
            right.id - left.id,
        )[0];
      const economicType = matchingRule?.economicType ?? "unclassified";
      if (transaction.economicType === economicType) continue;
      changes.push({
        transactionId: transaction.id,
        classificationRuleId: matchingRule?.id ?? null,
        previousEconomicType: transaction.economicType,
        newEconomicType: economicType,
      });
    }
    for (const economicType of ["expense", "income", "transfer", "unclassified"] as const) {
      const transactionIds = changes.filter(change => change.newEconomicType === economicType).map(change => change.transactionId);
      if (transactionIds.length === 0) continue;
      await db.update(transactions).set({ economicType, updatedAt: timestamp }).where(inArray(transactions.id, transactionIds));
    }
    if (changes.length > 0) {
      await db.insert(economicClassificationAudits).values(
        changes.map(change => ({
          transactionId: change.transactionId,
          classificationRuleId: change.classificationRuleId,
          previousEconomicType: change.previousEconomicType,
          newEconomicType: change.newEconomicType,
          reason,
          createdAt: timestamp,
        })),
      );
    }
    return changes.length;
  }

  private ruleKey(sourceId: number, normalizedDescription: string, direction: string) {
    return `${sourceId}:${direction}:${normalizedDescription}`;
  }

  private matchesRule(
    rule: typeof classificationRules.$inferSelect,
    description: string,
    direction: string,
  ) {
    return direction === rule.direction && descriptionMatchesRule(description, rule.normalizedDescription, rule.matchMode);
  }
}
