import { eq } from "drizzle-orm";
import type { AppDatabase } from "./client";
import { DrizzleClassificationRepository } from "./drizzle-classification-repository";
import { sources } from "./schema";

export async function ensureTrading212SpendingCashbackIncome(db: AppDatabase) {
  const source = await db.query.sources.findFirst({ where: eq(sources.slug, "trading212") });
  if (!source) return 0;

  const repository = new DrizzleClassificationRepository(db);
  const incomeResult = await repository.saveRule({
    sourceId: source.id,
    description: "Spending cashback",
    matchMode: "starts_with",
    direction: "inflow",
    economicType: "income",
  });
  const reversalResult = await repository.saveRule({
    sourceId: source.id,
    description: "Spending cashback",
    matchMode: "starts_with",
    direction: "outflow",
    economicType: "expense",
  });
  return incomeResult.affectedTransactionCount + reversalResult.affectedTransactionCount;
}
