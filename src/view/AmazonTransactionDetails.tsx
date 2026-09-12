import { useState } from "react";
import { amazonRequest } from "./AmazonOrdersPage";
import type { OrderRow, Link } from "../app/amazon-orders";
import { formatMoney } from "./formatters";

export function AmazonTransactionDetails({ transactionId, count }: { transactionId: number; count: number }) {
  const [rows, setRows] = useState<Array<{ order: OrderRow; link: Link; breakdown: { items: Array<{ id: string; description: string; amountMinor: number }>; unresolvedMinor: number; deliveryMinor: number; discountMinor: number } }> | null>(null);
  const [error, setError] = useState("");
  if (!count) return null;
  return <details className="mt-2 text-sm" onToggle={async e => { if (e.currentTarget.open && !rows) { try { setRows(await amazonRequest(`/transaction?id=${transactionId}`)); } catch (e) { setError((e as Error).message); } } }}><summary className="cursor-pointer text-sky-400">Amazon purchase details · {count} {count === 1 ? "order" : "orders"}</summary>{error && <p role="alert">{error}</p>}{rows?.map(r => <div key={r.link.id} className="my-2 rounded border border-neutral-800 p-2"><a className="text-sky-400 underline" href={`/amazon-orders?order=${r.order.id}`}>{r.order.data.orderId}</a><p>{formatMoney(r.link.amountMinor, r.order.data.currencyCode)} · {r.link.kind}</p>{r.breakdown.items.map(i => <p key={i.id}>{i.description} · {formatMoney(i.amountMinor, r.order.data.currencyCode)}</p>)}{!!r.breakdown.deliveryMinor && <p>Delivery: {formatMoney(r.breakdown.deliveryMinor, r.order.data.currencyCode)}</p>}{!!r.breakdown.discountMinor && <p>Discount: -{formatMoney(r.breakdown.discountMinor, r.order.data.currencyCode)}</p>}{!!r.breakdown.unresolvedMinor && <p className="text-amber-300">Item allocation unresolved: {formatMoney(r.breakdown.unresolvedMinor, r.order.data.currencyCode)}. Open the order to see all items.</p>}</div>)}</details>;
}
