import { eq } from "drizzle-orm";
import type { PlannedSpendingInput, PlannedSpendingRepository } from "../../app/planned-spending";
import type { AppDatabase } from "./client";
import { plannedSpending } from "./schema";

export class DrizzlePlannedSpendingRepository implements PlannedSpendingRepository {
  constructor(private readonly db: AppDatabase) {}
  list() { return this.db.select().from(plannedSpending).orderBy(plannedSpending.id).all(); }
  save(input: PlannedSpendingInput, id?: number) {
    if (id === undefined) return this.db.insert(plannedSpending).values(input).returning().get()!;
    const saved = this.db.update(plannedSpending).set(input).where(eq(plannedSpending.id, id)).returning().get();
    if (!saved) throw new Error("Planned item not found.");
    return saved;
  }
  remove(id: number) { this.db.delete(plannedSpending).where(eq(plannedSpending.id, id)).run(); }
}
