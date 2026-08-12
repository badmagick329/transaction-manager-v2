import { and, asc, eq, inArray } from "drizzle-orm";
import { descriptionMatchesRule, economicDirectionForAmount, normalizeDescription } from "../../app/classification";
import type { SaveTagRuleInput, Tag, TaggingRepository, TagRule } from "../../app/ports/tagging-repository";
import type { AppDatabase } from "./client";
import { sources, tagRules, tags, transactionManualTags, transactionTagRuleMatches, transactions } from "./schema";

const now = () => new Date().toISOString();
type AppTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
type TagDatabase = AppDatabase | AppTransaction;

function cleanTagName(name: string) {
  const cleaned = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("Tag name is required.");
  if (cleaned.length > 50) throw new Error("Tag name must be 50 characters or fewer.");
  return cleaned;
}

function normalizeTagName(name: string) {
  return cleanTagName(name).toLocaleLowerCase();
}

function normalizedRuleDescription(input: SaveTagRuleInput) {
  if (input.matchMode === "all") return "*";
  const description = normalizeDescription(input.description);
  if (!description) throw new Error("Rule description is required.");
  if (description.length > 200) throw new Error("Rule description must be 200 characters or fewer.");
  return description;
}

function toRule(
  row: typeof tagRules.$inferSelect,
  tagName: string,
  sourceName: string,
): TagRule {
  return { ...row, tagName, sourceName };
}

export async function applyTagRulesForTransactions(db: TagDatabase, sourceId: number, transactionIds: number[]) {
  if (transactionIds.length === 0) return 0;
  const [rules, transactionRows] = await Promise.all([
    db.select().from(tagRules).where(eq(tagRules.sourceId, sourceId)),
    db.select({ id: transactions.id, description: transactions.description, amountMinor: transactions.amountMinor })
      .from(transactions)
      .where(and(eq(transactions.sourceId, sourceId), inArray(transactions.id, transactionIds))),
  ]);
  return insertRuleMatches(db, rules, transactionRows);
}

async function insertRuleMatches(
  db: TagDatabase,
  rules: Array<typeof tagRules.$inferSelect>,
  transactionRows: Array<{ id: number; description: string; amountMinor: number }>,
) {
  const timestamp = now();
  const matches = transactionRows.flatMap(transaction => rules
    .filter(rule => rule.direction === economicDirectionForAmount(transaction.amountMinor))
    .filter(rule => descriptionMatchesRule(transaction.description, rule.normalizedDescription, rule.matchMode))
    .map(rule => ({ transactionId: transaction.id, tagRuleId: rule.id, createdAt: timestamp })));
  if (matches.length === 0) return 0;
  const inserted = await db.insert(transactionTagRuleMatches).values(matches).onConflictDoNothing().returning({ id: transactionTagRuleMatches.id });
  return inserted.length;
}

export class DrizzleTaggingRepository implements TaggingRepository {
  constructor(private readonly db: AppDatabase) {}

  async listTags(): Promise<Tag[]> {
    const [tagRows, manualRows, automaticRows] = await Promise.all([
      this.db.select().from(tags).orderBy(asc(tags.name)),
      this.db.select({ tagId: transactionManualTags.tagId, transactionId: transactionManualTags.transactionId }).from(transactionManualTags),
      this.db.select({ tagId: tagRules.tagId, transactionId: transactionTagRuleMatches.transactionId })
        .from(transactionTagRuleMatches)
        .innerJoin(tagRules, eq(transactionTagRuleMatches.tagRuleId, tagRules.id)),
    ]);
    const transactionIdsByTag = new Map<number, Set<number>>();
    for (const assignment of [...manualRows, ...automaticRows]) {
      const ids = transactionIdsByTag.get(assignment.tagId) ?? new Set<number>();
      ids.add(assignment.transactionId);
      transactionIdsByTag.set(assignment.tagId, ids);
    }
    return tagRows.map(tag => ({ ...tag, transactionCount: transactionIdsByTag.get(tag.id)?.size ?? 0 }));
  }

  async createTag(name: string): Promise<Tag> {
    const cleanedName = cleanTagName(name);
    const normalizedName = normalizeTagName(name);
    const existing = await this.db.query.tags.findFirst({ where: eq(tags.normalizedName, normalizedName) });
    if (existing) throw new Error("A tag with that name already exists.");
    const timestamp = now();
    const [tag] = await this.db.insert(tags).values({ name: cleanedName, normalizedName, createdAt: timestamp, updatedAt: timestamp }).returning();
    return { ...tag, transactionCount: 0 };
  }

  async renameTag(tagId: number, name: string): Promise<Tag> {
    const cleanedName = cleanTagName(name);
    const normalizedName = normalizeTagName(name);
    const existing = await this.db.query.tags.findFirst({ where: eq(tags.normalizedName, normalizedName) });
    if (existing && existing.id !== tagId) throw new Error("A tag with that name already exists.");
    const [tag] = await this.db.update(tags).set({ name: cleanedName, normalizedName, updatedAt: now() }).where(eq(tags.id, tagId)).returning();
    if (!tag) throw new Error("Tag not found.");
    const listed = await this.listTags();
    return listed.find(item => item.id === tag.id)!;
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.db.transaction(async tx => {
      const ruleRows = await tx.select({ id: tagRules.id }).from(tagRules).where(eq(tagRules.tagId, tagId));
      const ruleIds = ruleRows.map(rule => rule.id);
      if (ruleIds.length > 0) await tx.delete(transactionTagRuleMatches).where(inArray(transactionTagRuleMatches.tagRuleId, ruleIds));
      await tx.delete(transactionManualTags).where(eq(transactionManualTags.tagId, tagId));
      await tx.delete(tagRules).where(eq(tagRules.tagId, tagId));
      const deleted = await tx.delete(tags).where(eq(tags.id, tagId)).returning({ id: tags.id });
      if (deleted.length === 0) throw new Error("Tag not found.");
    });
  }

  async setManualTag(transactionId: number, tagId: number, assigned: boolean): Promise<void> {
    const [transaction, tag] = await Promise.all([
      this.db.query.transactions.findFirst({ where: eq(transactions.id, transactionId) }),
      this.db.query.tags.findFirst({ where: eq(tags.id, tagId) }),
    ]);
    if (!transaction) throw new Error("Transaction not found.");
    if (!tag) throw new Error("Tag not found.");
    if (assigned) {
      await this.db.insert(transactionManualTags).values({ transactionId, tagId }).onConflictDoNothing();
      return;
    }
    await this.db.delete(transactionManualTags).where(and(eq(transactionManualTags.transactionId, transactionId), eq(transactionManualTags.tagId, tagId)));
  }

  async listRules(): Promise<TagRule[]> {
    const rows = await this.db
      .select({ rule: tagRules, tagName: tags.name, sourceName: sources.name })
      .from(tagRules)
      .innerJoin(tags, eq(tagRules.tagId, tags.id))
      .innerJoin(sources, eq(tagRules.sourceId, sources.id))
      .orderBy(asc(tags.name), asc(sources.name), asc(tagRules.normalizedDescription));
    return rows.map(({ rule, tagName, sourceName }) => toRule(rule, tagName, sourceName));
  }

  async saveRule(input: SaveTagRuleInput): Promise<{ rule: TagRule; affectedTransactionCount: number }> {
    const normalizedDescription = normalizedRuleDescription(input);
    return this.db.transaction(async tx => {
      const [tag, source] = await Promise.all([
        tx.query.tags.findFirst({ where: eq(tags.id, input.tagId) }),
        tx.query.sources.findFirst({ where: eq(sources.id, input.sourceId) }),
      ]);
      if (!tag) throw new Error("Tag not found.");
      if (!source) throw new Error("Source not found.");
      const timestamp = now();
      let rule: typeof tagRules.$inferSelect;
      if (input.ruleId) {
        const existing = await tx.query.tagRules.findFirst({ where: eq(tagRules.id, input.ruleId) });
        if (!existing) throw new Error("Tag rule not found.");
        await tx.delete(transactionTagRuleMatches).where(eq(transactionTagRuleMatches.tagRuleId, input.ruleId));
        [rule] = await tx.update(tagRules).set({
          tagId: input.tagId,
          sourceId: input.sourceId,
          normalizedDescription,
          matchMode: input.matchMode,
          direction: input.direction,
          updatedAt: timestamp,
        }).where(eq(tagRules.id, input.ruleId)).returning();
      } else {
        const duplicate = await tx.query.tagRules.findFirst({ where: and(
          eq(tagRules.tagId, input.tagId),
          eq(tagRules.sourceId, input.sourceId),
          eq(tagRules.direction, input.direction),
          eq(tagRules.matchMode, input.matchMode),
          eq(tagRules.normalizedDescription, normalizedDescription),
        ) });
        if (duplicate) throw new Error("That tag rule already exists.");
        [rule] = await tx.insert(tagRules).values({
          tagId: input.tagId,
          sourceId: input.sourceId,
          normalizedDescription,
          matchMode: input.matchMode,
          direction: input.direction,
          createdAt: timestamp,
          updatedAt: timestamp,
        }).returning();
      }
      const sourceTransactions = await tx.select({ id: transactions.id, description: transactions.description, amountMinor: transactions.amountMinor }).from(transactions).where(eq(transactions.sourceId, rule.sourceId));
      const affectedTransactionCount = await insertRuleMatches(tx, [rule], sourceTransactions);
      return { rule: toRule(rule, tag.name, source.name), affectedTransactionCount };
    });
  }

  async deleteRule(ruleId: number): Promise<{ affectedTransactionCount: number }> {
    return this.db.transaction(async tx => {
      const matches = await tx.select({ id: transactionTagRuleMatches.id }).from(transactionTagRuleMatches).where(eq(transactionTagRuleMatches.tagRuleId, ruleId));
      await tx.delete(transactionTagRuleMatches).where(eq(transactionTagRuleMatches.tagRuleId, ruleId));
      const deleted = await tx.delete(tagRules).where(eq(tagRules.id, ruleId)).returning({ id: tagRules.id });
      if (deleted.length === 0) throw new Error("Tag rule not found.");
      return { affectedTransactionCount: matches.length };
    });
  }
}
