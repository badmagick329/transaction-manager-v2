import { z } from "zod";

const money = z.number().int().safe().nonnegative();
export const amazonDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Invalid date");
const date = amazonDateSchema;
export const amazonItemSchema = z.object({
  id: z.string().min(1), description: z.string().min(1), amountMinor: money,
  quantity: z.number().int().positive().optional(), shipment: z.string().optional(), returned: z.boolean().optional(),
}).strict();
export const amazonOrderSchema = z.object({
  marketplace: z.string().min(1), orderId: z.string().regex(/^\d{3}-\d{7}-\d{7}$/), orderDate: date,
  currencyCode: z.string().regex(/^[A-Z]{3}$/), incomplete: z.boolean().default(false),
  items: z.array(amazonItemSchema).optional(),
  subtotalMinor: money.optional(), subtotalExcludesVat: z.boolean().optional(), vatMinor: money.optional(),
  deliveryMinor: money.optional(), discountMinor: money.optional(), totalMinor: money.optional(),
  giftCardMinor: money.optional(), cardMinor: money.optional(), refundMinor: money.optional(),
  card: z.object({ brand: z.string().min(1), lastFour: z.string().regex(/^\d{4}$/) }).strict().optional(),
  payments: z.array(z.object({ id: z.string().min(1), kind: z.enum(["charge", "refund"]), amountMinor: money, date: date.optional(), destination: z.string().optional(), itemIds: z.array(z.string()).optional() }).strict()).optional(),
}).strict().superRefine((o, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (o.items && new Set(o.items.map(i => i.id)).size !== o.items.length) fail("Item IDs must be unique within an order");
  if (o.payments && new Set(o.payments.map(p => p.id)).size !== o.payments.length) fail("Payment evidence IDs must be unique within an order");
  if (o.payments?.some(p => p.itemIds?.some(id => !o.items?.some(i => i.id === id))) && !o.incomplete) fail("Payment evidence must reference known item IDs");
  if (!o.incomplete && (!o.items?.length || o.totalMinor === undefined || o.cardMinor === undefined || o.giftCardMinor === undefined)) fail("Complete orders require items, total, gift-card and card amounts");
  if (o.totalMinor !== undefined && o.cardMinor !== undefined && o.giftCardMinor !== undefined && o.totalMinor !== o.cardMinor + o.giftCardMinor) fail("Total must equal card plus gift-card funding");
  if (!o.incomplete && o.items && o.totalMinor !== o.items.reduce((n, i) => n + i.amountMinor, 0) + (o.deliveryMinor ?? 0) - (o.discountMinor ?? 0)) fail("Item line totals plus delivery minus discounts must equal total (item amounts include VAT)");
  if (o.subtotalMinor !== undefined && o.totalMinor !== undefined && o.subtotalExcludesVat !== undefined && (!o.subtotalExcludesVat || o.vatMinor !== undefined) && o.subtotalMinor + (o.subtotalExcludesVat ? o.vatMinor! : 0) + (o.deliveryMinor ?? 0) - (o.discountMinor ?? 0) !== o.totalMinor) fail("Subtotal/VAT reconciliation failed");
  if (o.refundMinor !== undefined && o.totalMinor !== undefined && o.refundMinor > o.totalMinor) fail("Refund exceeds order total");
});
export const amazonImportSchema = z.object({
  kind: z.literal("amazon-orders"), version: z.literal(1),
  source: z.object({ fileName: z.string().min(1), fileHash: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: z.string().datetime(), evidence: z.string().min(1) }).strict(),
  orders: z.array(amazonOrderSchema).min(1),
}).strict();
export type AmazonOrder = z.infer<typeof amazonOrderSchema>;
export type AmazonImport = z.infer<typeof amazonImportSchema>;
export const amazonLinkSchema = z.object({
  orderId: z.number().int().positive(), transactionId: z.number().int().positive(),
  kind: z.enum(["purchase", "refund"]), amountMinor: money.positive(),
  allocations: z.array(z.object({ itemId: z.string().min(1), amountMinor: money.positive() }).strict()).default([]),
  status: z.enum(["confirmed", "rejected", "unlinked"]),
}).strict();
export type AmazonLinkInput = z.infer<typeof amazonLinkSchema>;
