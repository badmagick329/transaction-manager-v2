import { expect, test } from "bun:test";
import { amazonImportSchema, amazonOrderSchema, type AmazonOrder } from "./contracts/amazon-orders";
import { candidates, mergeOrder, validateLink, itemBreakdown, type AmazonSnapshot } from "./amazon-orders";

import { sampleOrder, sampleFile } from "./amazon-order-fixtures";
const snapshot = (): AmazonSnapshot => ({ orders: [{ id: 1, revisionId: 1, needsReview: false, data: sampleOrder() }], links: [], mappings: [], transactions: [{ id: 1, accountId: 1, accountName: "Current", description: "Amazon Marketplace", amountMinor: -2619, currencyCode: "GBP", transactionDate: "2026-08-09T15:00:00Z", status: "posted" }] });

test("six PDF scenarios preserve totals, discounts, VAT, refund and gift-card funding", () => {
  const orders = [sampleOrder({ subtotalMinor: 2182, subtotalExcludesVat: true, vatMinor: 437 }),
    sampleOrder({ items: [{ id: "clips", description: "Cable clips", amountMinor: 319 }], totalMinor: 319, cardMinor: 319, subtotalMinor: 266, subtotalExcludesVat: true, vatMinor: 53 }),
    sampleOrder({ items: [{ id: "massager", description: "Hand massager", amountMinor: 2999 }], totalMinor: 2999, cardMinor: 2999, deliveryMinor: 199, discountMinor: 199 }),
    sampleOrder({ items: [{ id: "hub", description: "USB hub", amountMinor: 628 }, { id: "key", description: "Security key", amountMinor: 5890, returned: true }], totalMinor: 6518, cardMinor: 6518, refundMinor: 5890 }),
    ...[1673, 330].map(n => sampleOrder({ items: [{ id: "gift", description: "Gift-funded item", amountMinor: n }], totalMinor: n, giftCardMinor: n, cardMinor: 0 }))];
  expect(amazonImportSchema.parse(sampleFile(orders)).orders).toHaveLength(6);
  expect(orders[3]!.cardMinor).toBe(6518);
  expect(orders[3]!.refundMinor).toBe(5890);
  expect(() => amazonOrderSchema.parse(sampleOrder({ totalMinor: 3000 }))).toThrow();
  expect(() => amazonOrderSchema.parse(sampleOrder({ orderDate: "2026-02-30" }))).toThrow();
  expect(() => amazonOrderSchema.parse(sampleOrder({ vatMinor: 437, subtotalExcludesVat: true, subtotalMinor: 2619 }))).toThrow();
});

test("revision merge retains missing facts and flags changes while accepting refund additions", () => {
  const before = sampleOrder();
  const after = mergeOrder(before, { ...before, items: undefined, refundMinor: 399 });
  // Parsers omit missing fields; explicit undefined is also omission.
  expect(after.data.refundMinor).toBe(399);
  expect(after.conflict).toBe(false);
  expect(mergeOrder(before, sampleOrder({ orderDate: "2026-08-10" })).conflict).toBe(true);
});

test("exact matching uses seven-day inclusive boundary, currency, mapping and bidirectional uniqueness", () => {
  const s = snapshot();
  expect(candidates(s)[0]!.unique).toBe(true);
  s.transactions[0]!.transactionDate = "2026-08-16";
  expect(candidates(s)).toHaveLength(1);
  s.transactions[0]!.transactionDate = "2026-08-17";
  expect(candidates(s)).toHaveLength(0);
  s.transactions[0]!.transactionDate = "2026-08-09";
  s.orders.push({ ...s.orders[0]!, id: 2 });
  expect(candidates(s).every(c => !c.unique)).toBe(true);
  s.orders.pop(); s.transactions.push({ ...s.transactions[0]!, id: 2 });
  expect(candidates(s).every(c => !c.unique)).toBe(true);
  s.transactions.pop(); s.transactions[0]!.currencyCode = "USD";
  expect(candidates(s)).toHaveLength(0);
  s.transactions[0]!.currencyCode = "GBP";
  s.orders[0]!.data.card = { brand: "MasterCard", lastFour: "1234" };
  s.mappings.push({ brand: "MasterCard", lastFour: "1234", accountId: 2 });
  expect(candidates(s)).toHaveLength(0);
});

test("partial allocation validates both sides, supports refunds and keeps unknown splits unresolved", () => {
  const s = snapshot();
  const input = { orderId: 1, transactionId: 1, kind: "purchase" as const, amountMinor: 1000, allocations: [], status: "confirmed" as const };
  validateLink(s, input);
  expect(itemBreakdown(s.orders[0]!, { ...input, id: 1 }).unresolvedMinor).toBe(1000);
  expect(itemBreakdown(s.orders[0]!, { ...input, id: 1, amountMinor: 2619 }).items).toHaveLength(2);
  expect(() => validateLink(s, { ...input, amountMinor: 2620 })).toThrow();
  expect(() => validateLink(s, { ...input, allocations: [{ itemId: "lanyard", amountMinor: 500 }] })).toThrow();
  s.links.push({ ...input, id: 1, amountMinor: 2000 });
  s.transactions.push({ ...s.transactions[0]!, id: 2 });
  expect(() => validateLink(s, { ...input, transactionId: 2 })).toThrow();
  s.links[0]!.status = "rejected";
  expect(candidates(s).some(c => c.transaction.id === 1)).toBe(false);
  s.links[0]!.status = "unlinked";
  expect(candidates(s).some(c => c.transaction.id === 1)).toBe(true);
  s.transactions[0]!.amountMinor = 399; s.orders[0]!.data.refundMinor = 399;
  s.orders[0]!.data.items![1]!.returned = true;
  validateLink(s, { ...input, kind: "refund", amountMinor: 399, allocations: [{ itemId: "lanyard", amountMinor: 399 }] });
});
