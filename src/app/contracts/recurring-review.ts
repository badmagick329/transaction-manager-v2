import { z } from "zod";
import { frequencies, recurringDescription, type RecurringPaymentInput, type PaymentMethodChange } from "../recurring-payments";

export type ReviewAction =
  | { type: "create"; input: RecurringPaymentInput; methods?: Omit<PaymentMethodChange, "paymentId">[]; transactionIds?: number[] }
  | { type: "update"; paymentId: number; input: RecurringPaymentInput; methods?: Omit<PaymentMethodChange, "paymentId">[]; transactionIds?: number[] }
  | { type: "method"; input: PaymentMethodChange }
  | { type: "link"; paymentId: number; transactionId: number };
export type ReviewDecisionInput = {
  requestId: string; itemId: string; evidenceVersion: string; disposition: "apply" | "propose";
  reasoning: string; evidenceTransactionIds: number[]; action: ReviewAction;
};

const id = z.number().int().positive();
export const recurringInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["subscription", "bill", "instalment"]),
  accountId: id,
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().trim().min(1).max(500).transform(recurringDescription),
  matchMode: z.enum(["exact", "starts_with"]),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  frequency: z.enum(frequencies),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  status: z.enum(["active", "paused", "cancelled", "dismissed"]),
});
export const recurringMethodSchema = z.object({
  paymentId: id, accountId: id, description: recurringInputSchema.shape.description,
  matchMode: recurringInputSchema.shape.matchMode, effectiveDate: recurringInputSchema.shape.anchorDate,
  previousEffectiveDate: recurringInputSchema.shape.anchorDate.optional(),
  anchorDate: recurringInputSchema.shape.anchorDate.nullable(),
  frequency: recurringInputSchema.shape.frequency.nullable(),
  amountMinor: recurringInputSchema.shape.amountMinor.nullable(),
});
export const reviewActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), input: recurringInputSchema.strict(), methods: z.array(recurringMethodSchema.omit({ paymentId: true, previousEffectiveDate: true }).strict()).max(100).optional(), transactionIds: z.array(id).max(1000).refine(ids => new Set(ids).size === ids.length).optional() }).strict(),
  z.object({ type: z.literal("update"), paymentId: id, input: recurringInputSchema.strict(), methods: z.array(recurringMethodSchema.omit({ paymentId: true, previousEffectiveDate: true }).strict()).max(100).optional(), transactionIds: z.array(id).max(1000).refine(ids => new Set(ids).size === ids.length).optional() }).strict(),
  z.object({ type: z.literal("method"), input: recurringMethodSchema.strict() }).strict(),
  z.object({ type: z.literal("link"), paymentId: id, transactionId: id }).strict(),
]) as z.ZodType<ReviewAction>;
export const reviewDecisionSchema = z.object({
  requestId: z.string().trim().min(1).max(100),
  itemId: z.string().min(1).max(200), evidenceVersion: z.string().length(64),
  disposition: z.enum(["apply", "propose"]),
  reasoning: z.string().trim().min(10).max(4000),
  evidenceTransactionIds: z.array(id).min(1).max(1000).refine(ids => new Set(ids).size === ids.length),
  action: reviewActionSchema,
}).strict() as z.ZodType<ReviewDecisionInput>;
export const reviewResolutionSchema = z.object({
  decisionId: id, action: reviewActionSchema.optional(),
}).strict();

export const reviewReportSchema = z.object({
  requestId: z.string().trim().min(1).max(100), evidenceVersion: z.string().length(64),
  inspectedTransactionIds: z.array(id).max(100000).refine(ids => new Set(ids).size === ids.length),
  unresolved: z.array(z.object({ transactionIds: z.array(id).min(1).max(1000), reason: z.string().trim().min(1).max(2000) }).strict()).max(1000),
  summary: z.string().trim().min(1).max(4000),
}).strict();
export type ReviewReportInput = z.infer<typeof reviewReportSchema>;
