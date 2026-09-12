import { candidates, itemBreakdown, orderStatus, remaining } from "../amazon-orders";
import type { AmazonRepository } from "../ports/amazon-repository";

export function queryAmazonOrders(repository: AmazonRepository, filters: { q?: string; from?: string; to?: string; status?: string; offset?: number; limit?: number }) {
  const snapshot = repository.snapshot();
  const orders = snapshot.orders.map(o => ({ ...o, status: orderStatus(o, snapshot.links), remainingMinor: remaining(o, snapshot.links, "purchase") }));
  const filtered = orders.filter(o => (!filters.q || `${o.data.orderId} ${o.data.items?.map(i => i.description).join(" ")}`.toLowerCase().includes(filters.q.toLowerCase())) && (!filters.from || o.data.orderDate >= filters.from) && (!filters.to || o.data.orderDate <= filters.to) && (!filters.status || o.status === filters.status)).sort((a, b) => b.data.orderDate.localeCompare(a.data.orderDate) || b.id - a.id);
  const offset = filters.offset ?? 0;
  return { total: filtered.length, orders: filtered.slice(offset, offset + (filters.limit ?? 30)) };
}

export function queryAmazonOrder(repository: AmazonRepository, id: number) {
  const snapshot = repository.snapshot();
  const order = snapshot.orders.find(o => o.id === id);
  if (!order) throw new Error("Order not found");
  return { ...order, status: orderStatus(order, snapshot.links), remainingMinor: remaining(order, snapshot.links, "purchase"), refundRemainingMinor: remaining(order, snapshot.links, "refund"), candidates: candidates(snapshot).filter(c => c.orderId === id),
    links: snapshot.links.filter(l => l.orderId === id).map(l => ({ ...l, transaction: snapshot.transactions.find(t => t.id === l.transactionId)!, breakdown: itemBreakdown(order, l) })),
    mapping: order.data.card ? snapshot.mappings.find(m => m.brand === order.data.card!.brand && m.lastFour === order.data.card!.lastFour) : undefined,
    ...repository.evidence(id) };
}
export type AmazonOrderDetail = ReturnType<typeof queryAmazonOrder>;
export type AmazonOrderList = ReturnType<typeof queryAmazonOrders>;
