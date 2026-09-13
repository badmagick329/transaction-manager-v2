import { useEffect, useState } from "react";
import { amazonRequest } from "./AmazonOrdersPage";
import type { OrderRow, Link } from "../app/amazon-orders";
import { formatMoney } from "./formatters";

type Purchase = { order: OrderRow; link: Link };
// Mounted cards share one request instead of each scanning the order repository.
let pending: Array<{ id: number; resolve: (rows: Purchase[]) => void; reject: (error: Error) => void }> = [];
function loadPreview(id: number): Promise<Purchase[]> {
  return new Promise((resolve, reject) => {
    pending.push({ id, resolve, reject });
    if (pending.length !== 1) return;
    setTimeout(async () => {
      const batch = pending; pending = [];
      for (let offset = 0; offset < batch.length; offset += 100) {
        const group = batch.slice(offset, offset + 100);
        try {
          const result = await amazonRequest<Record<number, Purchase[]>>(`/previews?ids=${group.map(r => r.id).join(",")}`);
          group.forEach(r => r.resolve(result[r.id]!));
        } catch (error) { group.forEach(r => r.reject(error as Error)); }
      }
    }, 0);
  });
}
export function AmazonTransactionDetails({ transactionId, count }: { transactionId: number; count: number }) {
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [fullNames, setFullNames] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    if (count) loadPreview(transactionId).then(rows => { if (active) { setRows(rows); setError(""); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [transactionId, count]);
  if (!count) return null;
  if (error) return <p role="alert" className="px-1 pb-3 text-xs text-neutral-400">Could not load purchase items. {error}</p>;
  if (!rows) return <p className="px-1 pb-3 text-xs text-neutral-500">Loading purchased items...</p>;
  const items = rows.flatMap(r => (r.order.data.items ?? []).map(item => ({ item, order: r.order, key: `${r.order.id}:${item.id}` })));
  return <div className="px-1 pb-3 text-sm">
    <p className="mb-1 text-xs text-neutral-500">{rows.every(r => r.link.kind === "refund") ? "Items in refunded order" : "Purchased items"} <span className="text-neutral-500">(item prices)</span></p>
    <ul className="space-y-1.5">{(all ? items : items.slice(0, 3)).map(({ item, order, key }) => <li key={key} className="flex items-start justify-between gap-4">
      <button type="button" aria-expanded={!!fullNames[key]} title={item.description} className={`min-w-0 text-left text-sm text-neutral-300 hover:text-neutral-100 ${fullNames[key] ? "" : "line-clamp-1"}`} onClick={() => setFullNames(v => ({ ...v, [key]: !v[key] }))}>{item.description}</button>
      <span className="shrink-0 text-sm tabular-nums text-neutral-300">{formatMoney(item.amountMinor, order.data.currencyCode)}{item.returned && <span className="block text-right text-xs text-neutral-500">Returned</span>}</span>
    </li>)}</ul>
    {items.length > 3 && <button className="mt-2 text-xs text-neutral-400 hover:text-neutral-100" onClick={() => setAll(v => !v)}>{all ? "Show fewer items" : `Show all ${items.length} items`}</button>}
    {rows.map(({ order, link }) => <div key={link.id} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
      {!!order.data.giftCardMinor && <span>Amazon balance used: {formatMoney(order.data.giftCardMinor, order.data.currencyCode)}</span>}
      {!!order.data.refundMinor && <span>Order refunds: {formatMoney(order.data.refundMinor, order.data.currencyCode)}</span>}
      {link.kind === "purchase" && link.amountMinor !== order.data.cardMinor && <span>This payment covers part of the order.</span>}
      <a className="underline decoration-neutral-700 underline-offset-2 hover:text-neutral-200" href={`/amazon-orders?order=${order.id}`}>Order details</a>
    </div>)}
  </div>;
}
