import { amazonOrderSchema, type AmazonOrder, type AmazonLinkInput } from "./contracts/amazon-orders";

export type OrderRow = { id: number; data: AmazonOrder; revisionId: number; needsReview: boolean };
export type Link = Omit<AmazonLinkInput, "status"> & { id: number; status: AmazonLinkInput["status"] | "needs_review" };
export type BankRow = { id: number; accountId: number; accountName: string; description: string; amountMinor: number; currencyCode: string; transactionDate: string; status: string };
export type Mapping = { brand: string; lastFour: string; accountId: number };
export type AmazonSnapshot = { orders: OrderRow[]; links: Link[]; transactions: BankRow[]; mappings: Mapping[] };
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export function remaining(order: OrderRow, links: Link[], kind: "purchase" | "refund") {
  const total = kind === "purchase" ? order.data.cardMinor : order.data.refundMinor;
  return total === undefined ? undefined : total - sum(links.filter(l => l.orderId === order.id && l.kind === kind && l.status === "confirmed").map(l => l.amountMinor));
}
export function orderStatus(order: OrderRow, links: Link[]) {
  if (order.needsReview || order.data.incomplete || links.some(l => l.orderId === order.id && l.status === "needs_review")) return "needs-review";
  const left = remaining(order, links, "purchase");
  return left === 0 ? "matched" : left === order.data.cardMinor ? "unmatched" : "partially-matched";
}

/** Missing source fields preserve evidence; changed known facts require a human revision decision. */
export function mergeOrder(previous: AmazonOrder, incoming: AmazonOrder) {
  let conflict = false;
  const merged: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (key === "items" || key === "payments") {
      const before = (previous[key] ?? []) as Array<{ id: string } & Record<string, unknown>>;
      const next = value as Array<{ id: string } & Record<string, unknown>>;
      merged[key] = [...before.map(old => {
        const found = next.find(n => n.id === old.id);
        if (!found) return old;
        for (const [k, v] of Object.entries(found)) if (k in old && JSON.stringify(old[k]) !== JSON.stringify(v) && !(k === "returned" && v === true)) conflict = true;
        return { ...old, ...found };
      }), ...next.filter(n => !before.some(old => old.id === n.id))];
      continue;
    }
    if (key in previous && JSON.stringify(previous[key as keyof AmazonOrder]) !== JSON.stringify(value) && !(key === "refundMinor" && Number(value) >= (previous.refundMinor ?? 0)) && !(key === "incomplete" && value === false)) conflict = true;
    merged[key] = value;
  }
  return { data: amazonOrderSchema.parse(merged), conflict };
}

export function candidates(snapshot: AmazonSnapshot) {
  const pairs = snapshot.orders.flatMap(order => {
    const amount = remaining(order, snapshot.links, "purchase");
    if (!amount || order.needsReview) return [];
    const end = new Date(`${order.data.orderDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
    const mapping = order.data.card && snapshot.mappings.find(m => m.brand === order.data.card!.brand && m.lastFour === order.data.card!.lastFour);
    return snapshot.transactions.filter(t => t.status === "posted" && /amazon/i.test(t.description) && t.amountMinor < 0 && t.currencyCode === order.data.currencyCode
      && (!mapping || t.accountId === mapping.accountId) && t.transactionDate.slice(0, 10) >= order.data.orderDate && t.transactionDate.slice(0, 10) <= end.toISOString().slice(0, 10)
      && Math.abs(t.amountMinor) - sum(snapshot.links.filter(l => l.transactionId === t.id && l.status === "confirmed").map(l => l.amountMinor)) === amount
      && !snapshot.links.some(l => l.orderId === order.id && l.transactionId === t.id && (l.status === "rejected" || l.status === "confirmed" || l.status === "needs_review")))
      .map(transaction => ({ orderId: order.id, transaction, amountMinor: amount, reason: "Exact remaining amount, same currency, Amazon description, within seven days" }));
  });
  return pairs.map(p => ({ ...p, unique: pairs.filter(q => q.orderId === p.orderId).length === 1 && pairs.filter(q => q.transaction.id === p.transaction.id).length === 1 }));
}

/** Allocation limits protect both sides of a many-to-many relationship without changing bank evidence. */
export function validateLink(snapshot: AmazonSnapshot, input: AmazonLinkInput) {
  const order = snapshot.orders.find(o => o.id === input.orderId);
  const transaction = snapshot.transactions.find(t => t.id === input.transactionId);
  if (!order || !transaction) throw new Error("Order or transaction not found");
  if (input.status !== "confirmed") return;
  if (transaction.status !== "posted" || order.data.currencyCode !== transaction.currencyCode || (input.kind === "purchase" ? transaction.amountMinor >= 0 : transaction.amountMinor <= 0)) throw new Error("Choose a posted transaction with matching currency and direction");
  const others = snapshot.links.filter(l => !(l.orderId === input.orderId && l.transactionId === input.transactionId && l.kind === input.kind));
  const left = remaining(order, others, input.kind);
  if (left === undefined || input.amountMinor > left) throw new Error("Allocation exceeds remaining order amount or order amount is unknown");
  if (input.amountMinor + sum(others.filter(l => l.transactionId === input.transactionId && l.status === "confirmed").map(l => l.amountMinor)) > Math.abs(transaction.amountMinor)) throw new Error("Allocation exceeds transaction amount");
  if (new Set(input.allocations.map(a => a.itemId)).size !== input.allocations.length || sum(input.allocations.map(a => a.amountMinor)) > input.amountMinor) throw new Error("Invalid item allocation total");
  for (const allocation of input.allocations) {
    const item = order.data.items?.find(i => i.id === allocation.itemId);
    const used = sum(others.filter(l => l.orderId === input.orderId && l.kind === input.kind && l.status === "confirmed").flatMap(l => l.allocations).filter(a => a.itemId === allocation.itemId).map(a => a.amountMinor));
    if (!item || allocation.amountMinor + used > item.amountMinor || (input.kind === "refund" && !item.returned)) throw new Error("Item allocation exceeds item amount or item is not marked returned");
  }
}

export function itemBreakdown(order: OrderRow, link: Link) {
  const whole = !order.data.incomplete && link.kind === "purchase" && link.amountMinor === order.data.totalMinor && !order.data.giftCardMinor;
  return { items: whole ? order.data.items ?? [] : (order.data.items ?? []).filter(i => link.allocations.some(a => a.itemId === i.id)).map(i => ({ ...i, amountMinor: link.allocations.find(a => a.itemId === i.id)!.amountMinor })), deliveryMinor: whole ? order.data.deliveryMinor ?? 0 : 0, discountMinor: whole ? order.data.discountMinor ?? 0 : 0, unresolvedMinor: whole && !order.data.incomplete ? 0 : link.amountMinor - sum(link.allocations.map(a => a.amountMinor)) };
}
