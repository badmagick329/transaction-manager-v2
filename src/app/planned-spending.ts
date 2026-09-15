import { z } from "zod";

export const plannedSpendingInput = z.object({
  name: z.string().trim().min(1).max(200),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  priceMinor: z.number().int().min(0).max(100_000_000),
  quantity: z.number().int().min(1).max(100_000),
  interval: z.number().int().min(1).max(1200),
  unit: z.enum(["weeks", "months"]),
  included: z.boolean(),
}).strict();
export type PlannedSpendingInput = Required<z.infer<typeof plannedSpendingInput>>;
export type PlannedSpending = PlannedSpendingInput & { id: number };
export interface PlannedSpendingRepository {
  list(): PlannedSpending[];
  save(input: PlannedSpendingInput, id?: number): PlannedSpending;
  remove(id: number): void;
}
/** Planning intervals express an average allowance, never a scheduled bill or bank expense. */
export function plannedMonthly(item: PlannedSpendingInput) {
  return Math.round(item.priceMinor * item.quantity / item.interval * (item.unit === "weeks" ? 52 / 12 : 1));
}
export function plannedTotal(items: PlannedSpending[], currency: string) {
  return items.filter(i => i.included && i.currencyCode === currency).reduce((sum, item) => sum + plannedMonthly(item), 0);
}
