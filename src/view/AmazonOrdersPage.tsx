import { useEffect, useState } from "react";
import type { AmazonOrderDetail, AmazonOrderList } from "../app/use-cases/query-amazon-orders";
import type { BankRow } from "../app/amazon-orders";
import type { AmazonEvidence } from "../app/ports/amazon-repository";
import type { AmazonOrder } from "../app/contracts/amazon-orders";
import type { AmazonLinkInput } from "../app/contracts/amazon-orders";
import type { Account } from "./types";
import { Button } from "../components/ui/button";
import { formatMoney } from "./formatters";

const field = "rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100";
export async function amazonRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/amazon-orders${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const amountInput = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter a positive amount with at most two decimal places");
  return Math.round(Number(value) * 100);
};

export function AmazonOrdersPage({ accounts }: { accounts: Account[] }) {
  const [search, setSearch] = useState(() => window.location.pathname === "/amazon-orders" ? window.location.search : "");
  const [list, setList] = useState<AmazonOrderList>({ orders: [], total: 0 });
  const [detail, setDetail] = useState<AmazonOrderDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const query = new URLSearchParams(search);
  const selected = query.get("order");
  useEffect(() => { const restore = () => setSearch(window.location.search); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, []);
  function change(key: string, value: string, push = false) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "offset" && key !== "order") next.delete("offset");
    const url = `/amazon-orders${next.size ? `?${next}` : ""}`;
    window.history[push ? "pushState" : "replaceState"]({}, "", url); setSearch(next.size ? `?${next}` : "");
  }
  useEffect(() => {
    let active = true; const filters = new URLSearchParams(search); filters.delete("order");
    setError("");
    amazonRequest<AmazonOrderList>(`?${filters}`).then(v => { if (active) setList(v); }).catch(e => { if (active) setError(e.message); });
    setDetail(null);
    if (selected) amazonRequest<AmazonOrderDetail>(`/detail?id=${selected}`).then(v => { if (active) setDetail(v); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [search, version]);
  async function action(path: string, body: unknown) {
    setBusy(true); setError("");
    try { await amazonRequest(path, body); setVersion(v => v + 1); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const offset = Number(query.get("offset") ?? 0);
  return <section className="space-y-5">
    <div className="flex justify-between gap-3"><div><h1 className="text-2xl font-semibold">Amazon orders</h1><p className="text-sm text-neutral-400">What you bought, and the payments behind it.</p></div><Button variant="outline" onClick={() => setVersion(v => v + 1)}>Refresh</Button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <input aria-label="Search orders or items" className={field} placeholder="Search orders or items" value={query.get("q") ?? ""} onChange={e => change("q", e.target.value)} />
      <label className="text-sm">From <input aria-label="Orders from" type="date" className={field} value={query.get("from") ?? ""} onChange={e => change("from", e.target.value)} /></label>
      <label className="text-sm">To <input aria-label="Orders to" type="date" className={field} value={query.get("to") ?? ""} onChange={e => change("to", e.target.value)} /></label>
      <select aria-label="Matching status" className={field} value={query.get("status") ?? ""} onChange={e => change("status", e.target.value)}><option value="">All statuses</option>{["unmatched", "partially-matched", "matched", "needs-review"].map(s => <option key={s} value={s}>{s.replaceAll("-", " ")}</option>)}</select>
    </div>
    {!list.total && <p className="rounded-xl border border-neutral-800 p-6 text-neutral-400">No orders found. Supply order-details PDFs through the agent-assisted import workflow.</p>}
    <div className="grid gap-2">{list.orders.map(o => <button key={o.id} className={`rounded-xl border p-4 text-left ${String(o.id) === selected ? "border-sky-500" : "border-neutral-800"}`} onClick={() => change("order", String(o.id), true)}>
      <span className="flex flex-wrap justify-between gap-2"><strong>{o.data.orderId}</strong><span>{o.data.totalMinor === undefined ? "Total unknown" : formatMoney(o.data.totalMinor, o.data.currencyCode)}</span></span>
      <span className="block text-sm text-neutral-400">{o.data.orderDate} · {o.status.replaceAll("-", " ")}{o.data.cardMinor === 0 ? " · No card payment expected" : ""}</span>
      <span className="block truncate text-sm">{o.data.items?.map(i => i.description).join(" · ")}</span>
    </button>)}</div>
    {list.total > 30 && <div className="flex items-center gap-3"><Button variant="outline" disabled={!offset} onClick={() => change("offset", String(Math.max(0, offset - 30)))}>Previous</Button><span>{offset + 1}–{Math.min(offset + 30, list.total)} of {list.total}</span><Button variant="outline" disabled={offset + 30 >= list.total} onClick={() => change("offset", String(offset + 30))}>Next</Button></div>}
    {detail && <OrderDetail key={`${detail.id}-${version}`} order={detail} accounts={accounts} busy={busy} action={action} />}
  </section>;
}

function OrderDetail({ order, accounts, busy, action }: { order: AmazonOrderDetail; accounts: Account[]; busy: boolean; action: (path: string, body: unknown) => Promise<void> }) {
  const data = order.data;
  const money = (v: number | undefined) => v === undefined ? "Unknown" : formatMoney(v, data.currencyCode);
  const [accountId, setAccountId] = useState(String(order.mapping?.accountId ?? ""));
  const [manualQuery, setManualQuery] = useState("");
  const [results, setResults] = useState<BankRow[]>([]);
  const [resultOffset, setResultOffset] = useState(0);
  const [resultTotal, setResultTotal] = useState(0);
  const [selected, setSelected] = useState<BankRow | null>(null);
  const [kind, setKind] = useState<"purchase" | "refund">("purchase");
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  async function search(offset = 0) {
    try { const result = await amazonRequest<{ transactions: BankRow[]; total: number }>(`/transactions?q=${encodeURIComponent(manualQuery)}&offset=${offset}`); setResults(result.transactions); setResultTotal(result.total); setResultOffset(offset); setError(""); } catch (e) { setError((e as Error).message); }
  }
  function select(t: BankRow) { setSelected(t); setKind(t.amountMinor > 0 ? "refund" : "purchase"); setAmount((Math.abs(t.amountMinor) / 100).toFixed(2)); setAllocations({}); }
  function review(link: AmazonLinkInput, status: AmazonLinkInput["status"]) { return action("/link", { orderId: link.orderId, transactionId: link.transactionId, kind: link.kind, amountMinor: link.amountMinor, allocations: link.allocations, status }); }
  async function confirm() {
    try {
      if (!selected) throw new Error("Select a transaction");
      const input = { orderId: order.id, transactionId: selected.id, kind, amountMinor: amountInput(amount), allocations: Object.entries(allocations).filter(([, v]) => v).map(([itemId, v]) => ({ itemId, amountMinor: amountInput(v) })), status: "confirmed" as const };
      await action("/link", input);
    } catch (e) { setError((e as Error).message); }
  }
  return <article className="space-y-5 rounded-xl border border-neutral-700 p-4 sm:p-6">
    <h2 className="text-xl font-semibold">Order {data.orderId}</h2>
    <p className="text-sm text-neutral-400">{data.marketplace} · {data.orderDate} · Payment: {order.status.replaceAll("-", " ")}</p>
    <ul className="divide-y divide-neutral-800">{data.items?.map(i => <li key={i.id} className="flex justify-between gap-4 py-3"><span>{i.description}{i.quantity !== undefined && <span className="text-neutral-400"> · Quantity {i.quantity}</span>}{i.shipment && <small className="block text-neutral-400">Shipment: {i.shipment}</small>}{i.returned && <small className="block text-amber-300">Returned</small>}</span><span className="whitespace-nowrap">{money(i.amountMinor)}</span></li>)}</ul>
    <dl className="grid grid-cols-2 gap-2 text-sm">{([
      [data.subtotalExcludesVat ? "Subtotal (excluding VAT)" : "Subtotal", data.subtotalMinor], ["VAT (already included in item prices)", data.vatMinor], ["Delivery", data.deliveryMinor], ["Discount", data.discountMinor], ["Order value", data.totalMinor], ["Gift-card funding", data.giftCardMinor], ["Expected card amount", data.cardMinor], ["Unmatched card amount", order.remainingMinor], ["Reported refunds", data.refundMinor],
    ] as Array<[string, number | undefined]>).map(([label, value]) => <div key={label} className="contents"><dt className="text-neutral-400">{label}</dt><dd>{money(value)}</dd></div>)}</dl>
    {data.cardMinor === 0 && <p className="text-emerald-300">No card payment expected</p>}
    {!!order.refundRemainingMinor && <p className="text-amber-300">Reported by Amazon — bank receipt unconfirmed: {money(order.refundRemainingMinor)}</p>}
    {data.payments?.map(p => <p key={p.id} className="text-sm">{p.kind}: {money(p.amountMinor)} · {p.date ?? "Date unknown"} · {p.destination ?? "Destination unknown"}</p>)}
    {data.card && <div className="flex flex-wrap items-center gap-2"><span>{data.card.brand} ••••{data.card.lastFour}</span><select aria-label="Map Amazon card to account" className={field} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Choose account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}</select><Button disabled={busy || !accountId} onClick={() => action("/mapping", { ...data.card, accountId: Number(accountId) })}>Confirm account mapping</Button></div>}
    <h3 className="font-semibold">Suggested payments</h3>
    {!order.candidates.length && <p className="text-sm text-neutral-400">No exact candidates. Use manual search below for split payments or refunds.</p>}
    {order.candidates.map(c => <div key={c.transaction.id} className="space-y-2 rounded border border-neutral-800 p-3"><p>{c.transaction.transactionDate.slice(0, 10)} · {c.transaction.accountName} · {money(c.amountMinor)}</p><p className="text-sm text-neutral-400">{c.unique ? "Unique candidate" : "Ambiguous candidate"} · {c.reason}</p><div className="flex gap-2"><Button disabled={busy} onClick={() => review({ orderId: order.id, transactionId: c.transaction.id, amountMinor: c.amountMinor, kind: "purchase", allocations: [], status: "confirmed" }, "confirmed")}>Confirm</Button><Button variant="outline" disabled={busy} onClick={() => review({ orderId: order.id, transactionId: c.transaction.id, amountMinor: c.amountMinor, kind: "purchase", allocations: [], status: "rejected" }, "rejected")}>Reject</Button></div></div>)}
    <h3 className="font-semibold">Payment links</h3>
    {order.links.map(l => <div key={l.id} className="space-y-2 rounded border border-neutral-800 p-3"><p>{l.transaction.transactionDate.slice(0, 10)} · {l.transaction.accountName} · {l.kind} · {money(l.amountMinor)} · {l.status.replaceAll("_", " ")}</p><p className="text-sm text-neutral-400">{l.breakdown.unresolvedMinor ? `Item allocation unresolved: ${money(l.breakdown.unresolvedMinor)}` : "Item allocation complete"}</p>{l.breakdown.items.map(i => <p key={i.id} className="text-sm">{i.description} · {money(i.amountMinor)}</p>)}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { select(l.transaction); setAmount((l.amountMinor / 100).toFixed(2)); setKind(l.kind); setAllocations(Object.fromEntries(l.allocations.map(a => [a.itemId, (a.amountMinor / 100).toFixed(2)]))); }}>Review / edit</Button>{l.status !== "unlinked" && <Button variant="outline" disabled={busy} onClick={() => review({ ...l, status: "unlinked" }, "unlinked")}>{l.status === "rejected" ? "Reconsider" : "Unlink"}</Button>}</div></div>)}
    <h3 className="font-semibold">Find a payment or refund</h3>
    <div className="flex gap-2"><input className={`${field} min-w-0 flex-1`} aria-label="Search bank transactions" placeholder="Description, account, date, amount or transaction ID" value={manualQuery} onChange={e => setManualQuery(e.target.value)} /><Button variant="outline" onClick={() => search()}>Search</Button></div>
    <div className="max-h-60 overflow-auto">{results.map(t => <button className="block w-full border-b border-neutral-800 p-2 text-left text-sm hover:bg-neutral-800" key={t.id} onClick={() => select(t)}>#{t.id} · {t.transactionDate.slice(0, 10)} · {t.accountName} · {t.description} · {formatMoney(t.amountMinor, t.currencyCode)}</button>)}</div>
    {resultTotal > 30 && <div className="flex gap-2"><Button variant="outline" disabled={!resultOffset} onClick={() => search(resultOffset - 30)}>Previous results</Button><Button variant="outline" disabled={resultOffset + 30 >= resultTotal} onClick={() => search(resultOffset + 30)}>More results</Button></div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {selected && <div className="space-y-3 rounded border border-sky-800 p-3"><p>#{selected.id} · {selected.description} · {selected.accountName}</p><label className="block">{kind === "purchase" ? "Purchase" : "Refund"} amount ({data.currencyCode}) <input aria-label="Link amount" className={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><p className="text-sm text-neutral-400">Optional item allocations. Leave blank when the payment’s item split is unknown.</p>{data.items?.filter(i => kind === "purchase" || i.returned).map(i => <label key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">{i.description}<input aria-label={`Allocation for ${i.description}`} className={`${field} w-28`} inputMode="decimal" value={allocations[i.id] ?? ""} onChange={e => setAllocations(a => ({ ...a, [i.id]: e.target.value }))} /></label>)}<Button disabled={busy} onClick={confirm}>Confirm link and allocations</Button></div>}
    <details><summary className="cursor-pointer font-semibold">Evidence and review history</summary><div className="space-y-3 pt-3">{order.revisions.map(value => <div key={value.id} className="rounded border border-neutral-800 p-3"><p>Revision {value.id} · {value.status} · {value.source.fileName} · {value.source.capturedAt}</p><RevisionDetails revision={value} current={data} />{value.status === "pending" && <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => action("/revision", { revisionId: value.id, accept: true })}>Accept revision</Button><Button variant="outline" disabled={busy} onClick={() => action("/revision", { revisionId: value.id, accept: false })}>Reject revision</Button></div>}</div>)}{order.history.map(h => <details key={h.id}><summary className="text-sm">{h.createdAt} · {h.action}</summary><HistoryDetail event={h} currency={data.currencyCode} /></details>)}</div></details>
  </article>;
}


function RevisionDetails({ revision, current }: { revision: AmazonEvidence["revisions"][number]; current: AmazonOrder }) {
  const fields: Array<[keyof AmazonOrder, string]> = [["orderDate", "Order date"], ["currencyCode", "Currency"], ["totalMinor", "Order value"], ["cardMinor", "Card amount"], ["giftCardMinor", "Gift-card funding"], ["refundMinor", "Reported refunds"], ["deliveryMinor", "Delivery"], ["discountMinor", "Discount"], ["vatMinor", "VAT"]];
  const display = (data: AmazonOrder, key: keyof AmazonOrder) => data[key] === undefined ? "Unknown" : typeof data[key] === "number" ? formatMoney(data[key] as number, data.currencyCode) : String(data[key]);
  return <details><summary className="cursor-pointer">View order evidence{revision.status === "pending" ? " and proposed changes" : ""}</summary>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Detail</th>{revision.status === "pending" && <th>Current</th>}<th>{revision.status === "pending" ? "Proposed" : "This revision"}</th></tr></thead><tbody>{fields.map(([key, label]) => <tr key={key} className="border-b border-neutral-800"><td className="py-2 text-neutral-400">{label}</td>{revision.status === "pending" && <td>{display(current, key)}</td>}<td className={revision.status === "pending" && display(current, key) !== display(revision.data, key) ? "text-amber-300" : ""}>{display(revision.data, key)}</td></tr>)}</tbody></table></div>
    <p className="mt-3 font-medium">Items in this revision</p>{revision.data.items?.map(item => <p key={item.id} className="py-1 text-sm">{item.description} · {formatMoney(item.amountMinor, revision.data.currencyCode)}{item.returned ? " · Returned" : ""}</p>)}
    <p className="mt-3 font-medium">Source text</p><pre className="whitespace-pre-wrap break-words text-xs text-neutral-400">{revision.source.evidence}</pre>
  </details>;
}

function HistoryDetail({ event, currency }: { event: AmazonEvidence["history"][number]; currency: string }) {
  if (event.action.startsWith("link-")) {
    const change = event.detail as { before: AmazonLinkInput | null; after: AmazonLinkInput };
    return <p className="py-2 text-sm text-neutral-400">Transaction #{change.after.transactionId} · {change.after.kind} · {formatMoney(change.after.amountMinor, currency)} · {change.before?.status ?? "New link"} → {change.after.status} · {change.after.allocations.length} item allocations</p>;
  }
  const change = event.detail as { revisionId: number };
  return <p className="py-2 text-sm text-neutral-400">Revision {change.revisionId}</p>;
}
