import { eq } from "drizzle-orm";
import { trading212DefaultClassificationRules } from "../../app/trading212-classification-policy";
import { normalizeDescription } from "../../app/classification";
import type { AppDatabase } from "./client";
import { classificationRules } from "./schema";

export async function ensureTrading212DefaultRules(db: AppDatabase, sourceId: number) {
  const existingRules = await db.select().from(classificationRules).where(eq(classificationRules.sourceId, sourceId));
  const missingRules = trading212DefaultClassificationRules.filter(rule => !existingRules.some(existing =>
    existing.direction === rule.direction &&
    existing.matchMode === rule.matchMode &&
    existing.normalizedDescription === normalizeDescription(rule.description),
  ));
  if (missingRules.length === 0) return false;

  const timestamp = new Date().toISOString();
  await db.insert(classificationRules).values(missingRules.map(rule => ({
    sourceId,
    normalizedDescription: normalizeDescription(rule.description),
    matchMode: rule.matchMode,
    direction: rule.direction,
    economicType: rule.economicType,
    createdAt: timestamp,
    updatedAt: timestamp,
  })));
  return true;
}
