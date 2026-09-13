import { amazonOrderSchema, type AmazonOrder, type AmazonLinkInput, type AmazonMoneyReview } from "./contracts/amazon-orders";

export type OrderRow = { id: number; data: AmazonOrder; revisionId: number; needsReview: boolean };
export type Link = Omit<AmazonLinkInput, "status"> & { id: number; status: AmazonLinkInput["status"] | "needs_review" };
export type BankRow = { id: number; accountId: number; accountName: string; description: string; amountMinor: number; currencyCode: string; transactionDate: string; status: string };
export type Mapping = { brand: string; lastFour: string; accountId: number };
export type AmazonSnapshot = { orders: OrderRow[]; links: Link[]; transactions: BankRow[]; mappings: Mapping[] };
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export function remaining(order: OrderRow, links: Link[], kind: "purchase" | "refund") {
  const total = kind === "purchase" ? order.data.cardMinor : (order.data.refundMinor === undefined ? undefined : order.data.refundMinor - balanceRefund(order.data));
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
    // A less detailed export does not make already-reconciled PDF evidence incomplete.
    if (key === "incomplete" && value === true && previous.incomplete === false) continue;
    if (key === "items" || key === "payments") {
      const before = (previous[key] ?? []) as Array<{ id: string } & Record<string, unknown>>;
      // PDF and CSV adapters can identify the same line differently. Reuse a known ID only
      // for an unambiguous exact description, keeping allocations attached to that item.
      const next = (value as Array<{ id: string } & Record<string, unknown>>).map(item => {
        if (key !== "items" || before.some(old => old.id === item.id)) return item;
        const matches = before.filter(old => old.description === item.description);
        const incomingMatches = (value as typeof before).filter(other => other.description === item.description);
        return matches.length === 1 && incomingMatches.length === 1 && !(value as typeof before).some(other => other.id === matches[0]!.id) ? { ...item, id: matches[0]!.id } : item;
      });
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
  if (previous.refundBalanceMinor !== undefined && incoming.refundBalanceMinor === undefined) {
    const importedBalance = (payments: AmazonOrder["payments"]) => sum((payments ?? []).filter(p => p.kind === "refund" && p.destination === "ElectronicGiftCertificate").map(p => p.amountMinor));
    const recorded = importedBalance(merged.payments as AmazonOrder["payments"]);
    const newEvidence = Math.max(0, recorded - importedBalance(previous.payments));
    const refundGrowth = Math.max(0, Number(merged.refundMinor ?? 0) - (previous.refundMinor ?? 0));
    // An export may catch up with a manually recorded refund. Only growth beyond the
    // reviewed total can add credit; otherwise the same refund would be counted twice.
    merged.refundBalanceMinor = Math.max(previous.refundBalanceMinor, recorded, previous.refundBalanceMinor + Math.min(newEvidence, refundGrowth));
    if (recorded > previous.refundBalanceMinor + refundGrowth) conflict = true;
  }
  return { data: amazonOrderSchema.parse(merged), conflict };
}

export function candidates(snapshot: AmazonSnapshot) {
  const allocated = new Map<number, number>();
  const blocked = new Set<string>();
  for (const link of snapshot.links) {
    if (link.status === "confirmed") allocated.set(link.transactionId, (allocated.get(link.transactionId) ?? 0) + link.amountMinor);
    if (["confirmed", "rejected", "needs_review"].includes(link.status)) blocked.add(`${link.orderId}:${link.transactionId}`);
  }
  const byAmount = new Map<string, BankRow[]>();
  for (const transaction of snapshot.transactions) {
    if (transaction.status !== "posted" || transaction.amountMinor >= 0 || !isAmazonDescription(transaction.description)) continue;
    const key = `${transaction.currencyCode}:${Math.abs(transaction.amountMinor) - (allocated.get(transaction.id) ?? 0)}`;
    const bucket = byAmount.get(key) ?? []; bucket.push(transaction); byAmount.set(key, bucket);
  }
  const pairs = snapshot.orders.flatMap(order => {
    const amount = remaining(order, snapshot.links, "purchase");
    if (!amount || order.needsReview) return [];
    const end = new Date(`${order.data.orderDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
    const lastDate = end.toISOString().slice(0, 10);
    const mapping = order.data.card && snapshot.mappings.find(m => m.brand === order.data.card!.brand && m.lastFour === order.data.card!.lastFour);
    return (byAmount.get(`${order.data.currencyCode}:${amount}`) ?? []).filter(t => (!mapping || t.accountId === mapping.accountId)
      && t.transactionDate.slice(0, 10) >= order.data.orderDate && t.transactionDate.slice(0, 10) <= lastDate && !blocked.has(`${order.id}:${t.id}`))
      .map(transaction => ({ orderId: order.id, transaction, amountMinor: amount, reason: "Exact remaining amount, same currency, Amazon description, within seven days" }));
  });
  const orderCounts = new Map<number, number>(), transactionCounts = new Map<number, number>();
  for (const pair of pairs) {
    orderCounts.set(pair.orderId, (orderCounts.get(pair.orderId) ?? 0) + 1);
    transactionCounts.set(pair.transaction.id, (transactionCounts.get(pair.transaction.id) ?? 0) + 1);
  }
  return pairs.map(p => ({ ...p, unique: orderCounts.get(p.orderId) === 1 && transactionCounts.get(p.transaction.id) === 1 }));
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
  if (left === undefined || input.amountMinor > left) throw new Error(left === undefined ? "Record the order funding or issued refund amount before linking a bank transaction" : "Link exceeds the remaining amount available for bank matching");
  if (input.amountMinor + sum(others.filter(l => l.transactionId === input.transactionId && l.status === "confirmed").map(l => l.amountMinor)) > Math.abs(transaction.amountMinor)) throw new Error("Allocation exceeds transaction amount");
  if (new Set(input.allocations.map(a => a.itemId)).size !== input.allocations.length || sum(input.allocations.map(a => a.amountMinor)) > input.amountMinor) throw new Error("Invalid item allocation total");
  for (const allocation of input.allocations) {
    const item = order.data.items?.find(i => i.id === allocation.itemId);
    const used = sum(others.filter(l => l.orderId === input.orderId && l.kind === input.kind && l.status === "confirmed").flatMap(l => l.allocations).filter(a => a.itemId === allocation.itemId).map(a => a.amountMinor));
    if (!item || allocation.amountMinor + used > item.amountMinor || (input.kind === "refund" && !item.returned)) throw new Error("Item allocation exceeds item amount or item is not marked returned");
  }
}

export function itemBreakdown(order: OrderRow, link: Link) {
  const whole = !order.data.incomplete && link.kind === "purchase" && link.amountMinor === order.data.cardMinor;
  return { wholeOrder: whole, balanceMinor: whole ? order.data.giftCardMinor ?? 0 : 0, items: whole ? order.data.items ?? [] : (order.data.items ?? []).filter(i => link.allocations.some(a => a.itemId === i.id)).map(i => ({ ...i, amountMinor: link.allocations.find(a => a.itemId === i.id)!.amountMinor })), deliveryMinor: whole ? order.data.deliveryMinor ?? 0 : 0, giftWrapMinor: whole ? order.data.giftWrapMinor ?? 0 : 0, discountMinor: whole ? order.data.discountMinor ?? 0 : 0, unresolvedMinor: whole && !order.data.incomplete ? 0 : link.amountMinor - sum(link.allocations.map(a => a.amountMinor)) };
}

/** Balance refunds reduce purchase spending, but cannot satisfy a bank-receipt link. */
export function balanceRefund(order: AmazonOrder) {
  return order.refundBalanceMinor ?? sum((order.payments ?? []).filter(p => p.kind === "refund" && p.destination === "ElectronicGiftCertificate").map(p => p.amountMinor));
}
export function purchaseSpending(order: AmazonOrder) {
  return order.totalMinor === undefined ? undefined : order.totalMinor - (order.refundMinor ?? 0);
}
export function reviewedMoney(order: AmazonOrder, input: AmazonMoneyReview): AmazonOrder {
  const next = { ...order };
  if (input.funding) {
    if (order.totalMinor === undefined) throw new Error("Record the order value before reviewing funding");
    if (input.funding.balanceMinor > order.totalMinor) throw new Error("Amazon balance funding exceeds the order value");
    next.giftCardMinor = input.funding.balanceMinor;
    next.cardMinor = order.totalMinor - input.funding.balanceMinor;
    // Funding review clears incompleteness only when the purchased items and adjustments reconcile too.
    if (next.items?.length && next.deliveryMinor !== undefined && next.discountMinor !== undefined && sum(next.items.map(i => i.amountMinor)) + next.deliveryMinor + (next.giftWrapMinor ?? 0) - next.discountMinor === next.totalMinor) next.incomplete = false;
  }
  if (input.refunds) {
    next.refundMinor = input.refunds.totalMinor;
    if (input.refunds.balanceMinor !== undefined) next.refundBalanceMinor = input.refunds.balanceMinor;
  }
  return amazonOrderSchema.parse(next);
}


export const isAmazonDescription = (description: string) => /amazon|amzn/i.test(description);

/** Rank manual choices near the order without excluding combined payments or other merchants. */
export function searchOrderTransactions(snapshot: AmazonSnapshot, orderId: number, q = "", offset = 0) {
  const order = snapshot.orders.find(o => o.id === orderId);
  if (!order) throw new Error("Order not found");
  const allocated = new Map<number, number>();
  for (const link of snapshot.links) if (link.status === "confirmed") allocated.set(link.transactionId, (allocated.get(link.transactionId) ?? 0) + link.amountMinor);
  const query = q.trim().toLowerCase();
  const day = (date: string) => Date.parse(date.slice(0, 10)) / 86400000;
  const rank = (t: BankRow) => {
    const delta = day(t.transactionDate) - day(order.data.orderDate);
    return [isAmazonDescription(t.description) && delta >= 0 && delta <= 7 ? 0 : Math.abs(delta) <= 14 ? 1 : 2, Math.abs(delta), isAmazonDescription(t.description) ? 0 : 1];
  };
  const rows = snapshot.transactions.filter(t => !query || `${t.id} ${t.description} ${t.accountName} ${t.transactionDate} ${(t.amountMinor / 100).toFixed(2)}`.toLowerCase().includes(query) || (/^(amazon|amzn)$/.test(query) && isAmazonDescription(t.description))).sort((a,b) => {
    const x = rank(a), y = rank(b);
    return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! || b.id-a.id;
  }).map(t => ({ ...t, availableMinor: Math.abs(t.amountMinor) - (allocated.get(t.id) ?? 0) }));
  return { total: rows.length, transactions: rows.slice(offset, offset + 30) };
}
