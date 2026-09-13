import { balanceRefund, purchaseSpending, candidates, itemBreakdown, orderStatus, remaining } from "../amazon-orders";
import type { AmazonRepository } from "../ports/amazon-repository";

export function queryAmazonOrders(repository: AmazonRepository, filters: { q?: string; from?: string; to?: string; status?: string; offset?: number; limit?: number; includeOlder?: boolean }) {
  const snapshot = repository.snapshot();
  const trackingStart = repository.trackingStart();
  const suggested = new Set(candidates({ ...snapshot, orders: snapshot.orders.filter(o => o.data.orderDate >= trackingStart) }).filter(c => c.unique).map(c => c.orderId));
  const orders = snapshot.orders.map(o => ({ ...o, hasSuggestion: suggested.has(o.id), spendingMinor: purchaseSpending(o.data), status: o.data.orderDate < trackingStart ? "outside-tracking" : orderStatus(o, snapshot.links), remainingMinor: remaining(o, snapshot.links, "purchase") }));
  const filtered = orders.filter(o => (filters.includeOlder || o.data.orderDate >= trackingStart) && (!filters.q || `${o.data.orderId} ${o.data.items?.map(i => i.description).join(" ")}`.toLowerCase().includes(filters.q.toLowerCase())) && (!filters.from || o.data.orderDate >= filters.from) && (!filters.to || o.data.orderDate <= filters.to) && (!filters.status || o.status === filters.status)).sort((a, b) => b.data.orderDate.localeCompare(a.data.orderDate) || b.id - a.id);
  const offset = filters.offset ?? 0;
  const currencies = [...new Set(filtered.map(o => o.data.currencyCode))];
  const spending = currencies.map(currencyCode => {
    const group = filtered.filter(o => o.data.currencyCode === currencyCode);
    return { currencyCode, amountMinor: group.reduce((n, o) => n + (o.spendingMinor ?? 0), 0), refundsMinor: group.reduce((n, o) => n + (o.data.refundMinor ?? 0), 0), unknownOrders: group.filter(o => o.spendingMinor === undefined).length };
  });
  return { trackingStart, spending, total: filtered.length, orders: filtered.slice(offset, offset + (filters.limit ?? 30)) };
}

export function queryAmazonOrder(repository: AmazonRepository, id: number) {
  const snapshot = repository.snapshot();
  const trackingStart = repository.trackingStart();
  const order = snapshot.orders.find(o => o.id === id);
  if (!order) throw new Error("Order not found");
  return { ...order, spendingMinor: purchaseSpending(order.data), balanceRefundMinor: balanceRefund(order.data), status: orderStatus(order, snapshot.links), remainingMinor: remaining(order, snapshot.links, "purchase"), refundRemainingMinor: remaining(order, snapshot.links, "refund"), outsideTracking: order.data.orderDate < trackingStart, candidates: candidates({ ...snapshot, orders: snapshot.orders.filter(o => o.data.orderDate >= trackingStart) }).filter(c => c.orderId === id),
    links: snapshot.links.filter(l => l.orderId === id).map(l => ({ ...l, transaction: { ...snapshot.transactions.find(t => t.id === l.transactionId)!, availableMinor: Math.abs(snapshot.transactions.find(t => t.id === l.transactionId)!.amountMinor) - snapshot.links.filter(other => other.transactionId === l.transactionId && other.id !== l.id && other.status === "confirmed").reduce((n, other) => n + other.amountMinor, 0) }, breakdown: itemBreakdown(order, l) })),
    mapping: order.data.card ? snapshot.mappings.find(m => m.brand === order.data.card!.brand && m.lastFour === order.data.card!.lastFour) : undefined,
    ...repository.evidence(id) };
}
export type AmazonOrderDetail = ReturnType<typeof queryAmazonOrder>;
export type AmazonOrderList = ReturnType<typeof queryAmazonOrders>;
