import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AmazonOrderDetail, AmazonOrderList } from "../app/use-cases/query-amazon-orders";
import type { BankRow } from "../app/amazon-orders";
import type { AmazonEvidence } from "../app/ports/amazon-repository";
import type { AmazonOrder } from "../app/contracts/amazon-orders";
import type { AmazonLinkInput } from "../app/contracts/amazon-orders";
import type { Account } from "./types";
import { Button } from "../components/ui/button";
import { formatMoney } from "./formatters";

const field = "min-w-0 max-w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100";
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
  const [list, setList] = useState<AmazonOrderList>({ orders: [], total: 0, spending: [], trackingStart: "2024-01-01" });
  const [detail, setDetail] = useState<AmazonOrderDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const query = new URLSearchParams(search);
  const selected = query.get("order");
  const opener = useRef<HTMLButtonElement | null>(null);
  const panelBody = useRef<HTMLDivElement | null>(null);
  useEffect(() => { panelBody.current?.scrollTo({ top: 0 }); }, [selected]);
  useEffect(() => { const restore = () => setSearch(window.location.search); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, []);
  function change(key: string, value: string, push = false) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "offset" && key !== "order") next.delete("offset");
    const url = `/amazon-orders${next.size ? `?${next}` : ""}`;
    window.history[push ? "pushState" : "replaceState"]({}, "", url); setSearch(next.size ? `?${next}` : "");
  }
  const listFilters = new URLSearchParams(search); listFilters.delete("order");
  const filterKey = listFilters.toString();
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      amazonRequest<AmazonOrderList>(`?${filterKey}`).then(v => { if (active) setList(v); }).catch(e => { if (active) setError(e.message); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filterKey, version]);
  useEffect(() => {
    let active = true;
    setError("");
    if (!selected) setDetail(null);
    if (selected) amazonRequest<AmazonOrderDetail>(`/detail?id=${selected}`).then(v => { if (active) setDetail(v); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [selected, version]);
  async function action(path: string, body: unknown) {
    setBusy(true); setError("");
    try { await amazonRequest(path, body); setVersion(v => v + 1); return undefined; }
    catch (e) { const message = (e as Error).message; setError(message); return message; }
    finally { setBusy(false); }
  }
  const offset = Number(query.get("offset") ?? 0);
  const selectedIndex = list.orders.findIndex(o => String(o.id) === selected);
  return <section className="min-w-0 space-y-5">
    <div className="flex justify-between gap-3"><div><h1 className="text-2xl font-semibold">Amazon orders</h1><p className="text-sm text-neutral-400">What you bought, and the payments behind it.</p></div><Button variant="outline" onClick={() => setVersion(v => v + 1)}>Refresh</Button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <input aria-label="Search orders or items" className={field} placeholder="Search orders or items" value={query.get("q") ?? ""} onChange={e => change("q", e.target.value)} />
      <label className="text-sm">From <input aria-label="Orders from" type="date" className={field} value={query.get("from") ?? ""} onChange={e => change("from", e.target.value)} /></label>
      <label className="text-sm">To <input aria-label="Orders to" type="date" className={field} value={query.get("to") ?? ""} onChange={e => change("to", e.target.value)} /></label>
      <select aria-label="Matching status" className={field} value={query.get("status") ?? ""} onChange={e => change("status", e.target.value)}><option value="">All statuses</option>{["unmatched", "partially-matched", "matched", "needs-review", "matching-skipped"].map(s => <option key={s} value={s}>{s.replaceAll("-", " ")}</option>)}</select>
    </div>
    <details className="text-sm text-neutral-400"><summary className="cursor-pointer">Tracking from {list.trackingStart}</summary><form className="mt-3 flex flex-wrap items-center gap-3" onSubmit={event => { event.preventDefault(); const date = String(new FormData(event.currentTarget).get("trackingStart")); void action("/settings", { trackingStart: date }); }}><label>Tracking starts on <input key={list.trackingStart} name="trackingStart" aria-label="Tracking starts on" type="date" required className={field} defaultValue={list.trackingStart} /></label><Button variant="outline" disabled={busy}>Save cutoff</Button><p className="w-full">Older orders stay in your history, outside the review queue and matching suggestions.</p></form><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={query.get("includeOlder") === "true"} onChange={e => change("includeOlder", e.target.checked ? "true" : "")} />Include older orders in this list and its totals</label></details>
    {list.spending.map(s => <div key={s.currencyCode} className="rounded border border-neutral-800 p-3 text-sm"><p>Purchase spending after recorded refunds: {formatMoney(s.amountMinor, s.currencyCode)}</p><p className="text-neutral-400">Issued refunds: {formatMoney(s.refundsMinor, s.currencyCode)}. Covers all filtered orders, across every page. Separate from bank cash flow.{s.unknownOrders > 0 && ` Excludes ${s.unknownOrders} orders with unknown values.`}</p></div>)}
    {!list.total && <p className="rounded-xl border border-neutral-800 p-6 text-neutral-400">No orders match these filters.</p>}
    <div className="grid grid-cols-1 gap-2">{list.orders.map(o => <button key={o.id} aria-haspopup="dialog" className={`min-w-0 w-full rounded-xl border p-4 text-left ${String(o.id) === selected ? "border-sky-500" : "border-neutral-800"}`} onClick={event => { opener.current = event.currentTarget; change("order", String(o.id), true); }}>
      <span className="flex flex-wrap justify-between gap-2"><strong>{o.data.orderId}</strong><span>{o.data.totalMinor === undefined ? "Total unknown" : formatMoney(o.data.totalMinor, o.data.currencyCode)}</span></span>
      {!!o.data.refundMinor && <span className="block text-sm text-emerald-300">Refunded {formatMoney(o.data.refundMinor, o.data.currencyCode)} · Spending after refund {o.spendingMinor === undefined ? "Unknown" : formatMoney(o.spendingMinor, o.data.currencyCode)}</span>}
      <span className="block text-sm text-neutral-400">{o.data.orderDate} · {o.status === "outside-tracking" ? "Historical order" : o.status === "matching-skipped" ? "Payment matching skipped — statement unavailable" : o.data.giftCardMinor === undefined ? "Amazon balance amount not recorded" : o.status === "needs-review" ? "Order details need attention" : o.data.cardMinor === 0 ? "Paid from Amazon balance" : o.status === "matched" ? "Payment matched" : o.hasSuggestion ? "Payment found - confirm" : "Find bank payment"}</span>
      <span className="mt-1 block break-words text-sm text-neutral-300">{o.data.items?.map(i => i.description).join(" · ")}</span>
    </button>)}</div>
    {list.total > 30 && <div className="flex items-center gap-3"><Button variant="outline" disabled={!offset} onClick={() => change("offset", String(Math.max(0, offset - 30)))}>Previous</Button><span>{offset + 1}–{Math.min(offset + 30, list.total)} of {list.total}</span><Button variant="outline" disabled={offset + 30 >= list.total} onClick={() => change("offset", String(offset + 30))}>Next</Button></div>}
    <Dialog.Root open={!!selected} onOpenChange={open => { if (!open) change("order", "", true); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus({ preventScroll: true }); }} className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-neutral-700 bg-neutral-950 text-neutral-100 shadow-2xl sm:max-w-3xl">
          <div className="shrink-0 space-y-3 border-b border-neutral-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-lg font-semibold">Order details</Dialog.Title>
              <Dialog.Close asChild><Button variant="outline">Back to orders</Button></Dialog.Close>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={busy || selectedIndex <= 0} onClick={() => change("order", String(list.orders[selectedIndex - 1]!.id), true)}>Previous order</Button>
              <Button variant="outline" disabled={busy || selectedIndex < 0 || selectedIndex >= list.orders.length - 1} onClick={() => change("order", String(list.orders[selectedIndex + 1]!.id), true)}>Next order</Button>
              {selectedIndex >= 0 && <span className="text-xs text-neutral-400">{offset + selectedIndex + 1} of {list.total}</span>}
            </div>
          </div>
          <div ref={panelBody} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
            {error && <p role="alert" className="mb-3 text-red-300">{error}</p>}
            {detail && String(detail.id) === selected ? <OrderDetail key={detail.id} order={detail} accounts={accounts} busy={busy} action={action} /> : !error && <p role="status" className="text-neutral-400">Loading order…</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}

function OrderDetail({ order, accounts, busy, action }: { order: AmazonOrderDetail; accounts: Account[]; busy: boolean; action: (path: string, body: unknown) => Promise<string | undefined> }) {
  const data = order.data;
  const paymentStatus = order.outsideTracking ? "Historical order" : order.matchingSkipped ? "Payment matching skipped — statement unavailable" : order.remainingMinor === undefined ? "Amazon balance amount not recorded" : data.cardMinor === 0 ? "Paid from Amazon balance - no bank match needed" : order.remainingMinor === 0 ? "Payment matched" : order.candidates.some(c => c.unique) ? "Payment found - confirm below" : "Find bank payment";
  const money = (v: number | undefined) => v === undefined ? "Not recorded" : formatMoney(v, data.currencyCode);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [accountId, setAccountId] = useState(String(order.mapping?.accountId ?? ""));
  const [manualQuery, setManualQuery] = useState("");
  const [results, setResults] = useState<Array<BankRow & { availableMinor: number }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [resultOffset, setResultOffset] = useState(0);
  const [resultTotal, setResultTotal] = useState(0);
  const [selected, setSelected] = useState<(BankRow & { availableMinor: number }) | null>(null);
  const [kind, setKind] = useState<"purchase" | "refund">("purchase");
  const [amount, setAmount] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  async function search(offset = 0) {
    try { const result = await amazonRequest<{ transactions: Array<BankRow & { availableMinor: number }>; total: number }>(`/transactions?orderId=${order.id}&q=${encodeURIComponent(manualQuery)}&offset=${offset}`); setResults(result.transactions); setResultTotal(result.total); setResultOffset(offset); setError(""); } catch (e) { setError((e as Error).message); }
  }
  function select(t: BankRow & { availableMinor: number }) { setSearchOpen(false); setError(""); setSelected(t); setKind(t.amountMinor > 0 ? "refund" : "purchase"); setAmount((Math.min(t.availableMinor, (t.amountMinor > 0 ? order.refundRemainingMinor : order.remainingMinor) ?? 0) / 100).toFixed(2)); setAllocations({}); }
  function review(link: AmazonLinkInput, status: AmazonLinkInput["status"]) { return action("/link", { orderId: link.orderId, transactionId: link.transactionId, kind: link.kind, amountMinor: link.amountMinor, allocations: link.allocations, status }); }
  async function confirm() {
    try {
      if (!selected) throw new Error("Select a transaction");
      if (selected.currencyCode !== data.currencyCode) throw new Error(`This order is in ${data.currencyCode}. Choose a transaction in that currency.`);
      if (amountInput(amount) <= 0) throw new Error("Enter the amount this transaction paid for the order.");
      if (amountInput(amount) > selected.availableMinor) throw new Error(`Only ${money(selected.availableMinor)} remains available on this bank transaction. Reduce the match amount or choose another transaction.`);
      const allocated = Object.values(allocations).filter(Boolean).reduce((n, v) => n + amountInput(v), 0);
      if (allocated > amountInput(amount)) throw new Error(`Item amounts total ${money(allocated)}, more than the ${money(amountInput(amount))} match. Clear the advanced item fields to link this order without splitting its payment.`);
      const input = { orderId: order.id, transactionId: selected.id, kind, amountMinor: amountInput(amount), allocations: Object.entries(allocations).filter(([, v]) => v).map(([itemId, v]) => ({ itemId, amountMinor: amountInput(v) })), status: "confirmed" as const };
      const failure = await action("/link", input);
      if (failure) throw new Error(failure);
      setSelected(null); setError("");
    } catch (e) { setError((e as Error).message); }
  }
  return <article className="min-w-0 space-y-6 break-words px-1 py-2 sm:px-2">
    <header className="space-y-1"><p className="text-sm text-neutral-400">{data.marketplace} · {data.orderDate}</p><h2 className="text-lg font-semibold">Order {data.orderId}</h2></header>
    {order.outsideTracking && <p className="text-sm text-neutral-400">Before your tracking start date. Kept as history; no payment review is required.</p>}
    {data.incomplete && !order.outsideTracking && <p className="text-sm text-amber-300">Order evidence is incomplete.{data.giftCardMinor === undefined ? " Record the Amazon balance amount below." : " Check the purchase amounts below; supply an updated order document for missing adjustments."}</p>}
    <section aria-label="Purchase" className="space-y-3">
      <h3 className="text-sm font-semibold text-neutral-400">Purchase</h3>
      <ul className="divide-y divide-neutral-800">{data.items?.map(i => <li key={i.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><ItemName description={i.description} /><p className="mt-1 text-xs text-neutral-400">{i.quantity !== undefined && `Qty ${i.quantity}`}{i.returned && <span className="ml-2 text-amber-300">Returned</span>}{i.shipment && ` · Shipment ${i.shipment}`}</p></div><span className="shrink-0 text-sm tabular-nums">{money(i.amountMinor)}</span></li>)}</ul>
      <dl className="space-y-2 border-t border-neutral-800 pt-3 text-sm">{([
        ...(data.deliveryMinor ? [["Delivery", data.deliveryMinor] as [string, number]] : []),
        ...(data.giftWrapMinor ? [["Gift wrap", data.giftWrapMinor] as [string, number]] : []),
        ...(data.discountMinor ? [["Discount", -data.discountMinor] as [string, number]] : []),
        ["Order total", data.totalMinor],
        ...(data.refundMinor ? [["Refunded", -data.refundMinor], ["Cost after refunds", order.spendingMinor]] as Array<[string, number | undefined]> : []),
      ] as Array<[string, number | undefined]>).map(([label,value]) => <div key={label} className="flex justify-between gap-4"><dt className={label === "Order total" ? "font-semibold" : "text-neutral-400"}>{label}</dt><dd className="font-medium tabular-nums">{money(value)}</dd></div>)}</dl>
      {data.vatMinor !== undefined && <p className="text-xs text-neutral-500">Includes {money(data.vatMinor)} VAT{data.subtotalExcludesVat && data.subtotalMinor !== undefined ? ` · Subtotal before VAT ${money(data.subtotalMinor)}` : ""}</p>}
      {data.incomplete && <p className="text-xs text-neutral-400">Delivery: {money(data.deliveryMinor)} · Discount: {money(data.discountMinor)} · Gift wrap: {money(data.giftWrapMinor)}</p>}
    </section>
    <section className="space-y-3 border-t border-neutral-800 pt-5" aria-label="Payment and refund">
      <h3 className="text-sm font-semibold text-neutral-400">Payment and refund</h3>
      <MoneyReview key={order.revisionId} order={order} busy={busy} action={action} />
      {data.card && <div className="border-t border-neutral-800 pt-3"><div className="flex items-center justify-between gap-3"><div className="text-sm"><p>{data.card.brand} •••• {data.card.lastFour}</p><p className="text-xs text-neutral-400">{accounts.find(a => a.id === order.mapping?.accountId)?.name ?? "Bank account not assigned"}</p></div><Button size="sm" variant="ghost" aria-expanded={mappingOpen} onClick={() => setMappingOpen(!mappingOpen)}>{mappingOpen ? "Cancel" : "Edit account"}</Button></div>{mappingOpen && <div className="mt-3 space-y-3 rounded-lg bg-neutral-900 p-4"><p className="text-sm text-neutral-400">Choose which bank account this card belongs to. This helps future matching suggestions.</p><label className="block text-sm">Bank account<select aria-label="Map Amazon card to account" className={`${field} mt-1 block w-full`} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Choose account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}</select></label><Button disabled={busy || !accountId} onClick={async () => { if (!await action("/mapping", { ...data.card, accountId: Number(accountId) })) setMappingOpen(false); }}>Save card account</Button></div>}</div>}
    </section>
    <section aria-label="Next action" className="space-y-4 rounded-lg bg-neutral-900/60 p-4">
    <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{order.remainingMinor === 0 || order.matchingSkipped || order.outsideTracking ? "Matching status" : "Next action"}</p><h3 className="font-semibold">{paymentStatus}</h3></div>
    {order.matchingSkipped && <div className="space-y-2 text-sm"><p className="text-neutral-400">Statement unavailable. The purchase still counts in spending. Resume matching if you import the statement later.</p><Button variant="outline" disabled={busy} onClick={() => action("/matching", { orderId: order.id, skipped: false })}>Resume payment matching</Button></div>}
    {order.needsReview && <p className="text-amber-300">An imported document conflicts with the saved order. Review the proposed revision under Source documents and change history.</p>}

    {!order.matchingSkipped && !selected && !order.candidates.length && order.remainingMinor !== undefined && order.remainingMinor !== 0 && <p className="text-sm text-neutral-400">No exact match found. Choose Find bank payment to see transactions near this order date, including larger payments covering several orders.</p>}
    {order.candidates.map(c => <div key={c.transaction.id} className="space-y-2 border-t border-neutral-800 py-3"><p>{c.transaction.transactionDate.slice(0, 10)} · {c.transaction.accountName} · {money(c.amountMinor)}</p><p className="text-sm text-neutral-400">{c.unique ? "Suggested match" : "Possible match"} · {c.reason}</p><div className="flex gap-2"><Button disabled={busy} onClick={() => review({ orderId: order.id, transactionId: c.transaction.id, amountMinor: c.amountMinor, kind: "purchase", allocations: [], status: "confirmed" }, "confirmed")}>Confirm {money(c.amountMinor)} match</Button><Button variant="outline" disabled={busy} onClick={() => review({ orderId: order.id, transactionId: c.transaction.id, amountMinor: c.amountMinor, kind: "purchase", allocations: [], status: "rejected" }, "rejected")}>Reject</Button></div></div>)}
    {order.links.length > 0 && <h3 className="font-semibold">Linked transactions</h3>}
    {order.links.map(l => <div key={l.id} className="space-y-2 border-t border-neutral-800 py-3"><p>{l.transaction.transactionDate.slice(0, 10)} · {l.transaction.accountName} · {l.kind} · {money(l.amountMinor)} · {l.status.replaceAll("_", " ")}</p><p className="text-sm text-neutral-400">{l.breakdown.wholeOrder ? "Order linked. Its purchased items are shown above." : l.breakdown.unresolvedMinor ? `Linked to this order without splitting ${money(l.breakdown.unresolvedMinor)} across items. No item entry is required.` : "Item allocation complete"}</p>{l.breakdown.items.map(i => <p key={i.id} className="text-sm">{i.description} · {money(i.amountMinor)}</p>)}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { select(l.transaction); setAmount((l.amountMinor / 100).toFixed(2)); setKind(l.kind); setAllocations(Object.fromEntries(l.allocations.map(a => [a.itemId, (a.amountMinor / 100).toFixed(2)]))); }}>Review / edit</Button>{l.status !== "unlinked" && <Button variant="outline" disabled={busy} onClick={() => review({ ...l, status: "unlinked" }, "unlinked")}>{l.status === "rejected" ? "Reconsider" : "Unlink"}</Button>}</div></div>)}
    <div className="flex flex-wrap items-center gap-2">
    {((!order.matchingSkipped && order.remainingMinor !== 0) || !!order.refundRemainingMinor || searchOpen) && <Button variant="outline" onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) void search(); }}>{searchOpen ? "Close transaction search" : (selected ? "Choose a different transaction" : "Find bank payment or refund")}</Button>}
    {!order.matchingSkipped && !order.outsideTracking && order.remainingMinor !== 0 && <Button variant="ghost" disabled={busy} onClick={async () => { if (!await action("/matching", { orderId: order.id, skipped: true })) { setSelected(null); setSearchOpen(false); } }}>Skip matching</Button>}
    </div>
    {!order.matchingSkipped && !order.outsideTracking && order.remainingMinor !== 0 && <p className="text-xs text-neutral-500">Statement unavailable? Skip matching keeps the purchase and can be undone.</p>}
    {searchOpen && <div className="space-y-3"><p className="text-sm text-neutral-400">Amazon payments near {data.orderDate} appear first. Larger payments can cover several orders. Other transactions remain searchable.</p>
    <div className="flex gap-2"><input className={`${field} min-w-0 flex-1`} aria-label="Search bank transactions" placeholder="Description, account, date, amount or transaction ID" value={manualQuery} onChange={e => setManualQuery(e.target.value)} /><Button variant="outline" onClick={() => search()}>Search</Button></div>
    <div className="max-h-60 overflow-auto">{results.map(t => <button className="block w-full border-b border-neutral-800 p-2 text-left text-sm hover:bg-neutral-800" key={t.id} onClick={() => select(t)}>#{t.id} · {t.transactionDate.slice(0, 10)} · {t.accountName} · {t.description} · {formatMoney(t.amountMinor, t.currencyCode)}<span className="block text-neutral-400">Available to link: {formatMoney(t.availableMinor, t.currencyCode)}</span></button>)}</div>
    {resultTotal > 30 && <div className="flex gap-2"><Button variant="outline" disabled={!resultOffset} onClick={() => search(resultOffset - 30)}>Previous results</Button><Button variant="outline" disabled={resultOffset + 30 >= resultTotal} onClick={() => search(resultOffset + 30)}>More results</Button></div>}
    </div>}
    {error && <div role="alert" className="space-y-2 text-red-300"><p>{error}</p>{Object.values(allocations).some(Boolean) && <Button variant="outline" onClick={() => { setAllocations({}); setError(""); }}>Clear optional item amounts</Button>}</div>}
    {selected && <div className="space-y-3 border-t border-neutral-700 pt-4"><p>#{selected.id} · {selected.description} · {selected.accountName}</p><label className="block">Amount of this bank {kind === "purchase" ? "payment" : "refund"} for this order ({data.currencyCode}) <input aria-label="Link amount" className={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><p className="text-sm">Full bank transaction ({selected.currencyCode}): <strong>{money(Math.abs(selected.amountMinor))}</strong>. Available before this match: <strong>{money(selected.availableMinor)}</strong>.</p><p className="text-sm">Left for other orders: <strong>{money((selected.availableMinor) - Math.round(Number(amount || 0) * 100))}</strong></p><p className="text-sm text-neutral-400">The purchased items appear automatically. You do not need to enter their prices again.</p><div><Button size="sm" variant="ghost" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? "Close item allocation" : "Assign payment to items (optional)"}</Button>{advanced && <div className="space-y-2"><p className="my-2 text-sm text-neutral-400">Leave these empty for normal matching. These are portions of the bank payment, not the original item prices; their sum must not exceed the match amount.</p>{data.items?.filter(i => kind === "purchase" || i.returned).map(i => <label key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">{i.description}<input aria-label={`Allocation for ${i.description}`} className={`${field} w-28`} inputMode="decimal" value={allocations[i.id] ?? ""} onChange={e => setAllocations(a => ({ ...a, [i.id]: e.target.value }))} /></label>)}</div>}</div><Button disabled={busy || (kind === "purchase" && order.remainingMinor === undefined) || (kind === "refund" && data.refundMinor === undefined)} onClick={confirm}>Confirm {money(Math.round(Number(amount || 0) * 100))} match</Button></div>}
    </section>
    {!!order.refundRemainingMinor && <p className="text-sm text-amber-300">{data.refundBalanceMinor === undefined && !data.payments?.some(p => p.kind === "refund" && p.destination) ? "Refund destination not recorded. Check Amazon’s refund confirmation, then edit Refunds above." : `Refund still to link to a bank receipt: ${money(order.refundRemainingMinor)}`}</p>}
    <details className="border-t border-neutral-800 pt-4"><summary className="cursor-pointer text-sm text-neutral-400">Source documents and change history</summary><div className="space-y-3 pt-3">{order.revisions.map(value => <div key={value.id} className="rounded border border-neutral-800 p-3"><p>Revision {value.id} · {value.status} · {value.source.fileName} · {value.source.capturedAt}</p><RevisionDetails revision={value} current={data} />{value.status === "pending" && <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => action("/revision", { revisionId: value.id, accept: true })}>Accept revision</Button><Button variant="outline" disabled={busy} onClick={() => action("/revision", { revisionId: value.id, accept: false })}>Reject revision</Button></div>}</div>)}{order.history.map(h => <div key={h.id} className="border-t border-neutral-800 pt-3"><p className="text-xs text-neutral-500">{h.createdAt} · {h.action}</p><HistoryDetail event={h} currency={data.currencyCode} /></div>)}</div></details>
  </article>;
}


function RevisionDetails({ revision, current }: { revision: AmazonEvidence["revisions"][number]; current: AmazonOrder }) {
  const fields: Array<[keyof AmazonOrder, string]> = [["orderDate", "Order date"], ["currencyCode", "Currency"], ["totalMinor", "Order value"], ["cardMinor", "Card amount"], ["giftCardMinor", "Amazon balance used"], ["refundMinor", "Issued refunds"], ["refundBalanceMinor", "Refunded to Amazon balance"], ["deliveryMinor", "Delivery"], ["giftWrapMinor", "Gift wrap"], ["discountMinor", "Discount"], ["vatMinor", "VAT"]];
  const display = (data: AmazonOrder, key: keyof AmazonOrder) => data[key] === undefined ? "Unknown" : typeof data[key] === "number" ? formatMoney(data[key] as number, data.currencyCode) : String(data[key]);
  return <details><summary className="cursor-pointer">View order evidence{revision.status === "pending" ? " and proposed changes" : ""}</summary>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Detail</th>{revision.status === "pending" && <th>Current</th>}<th>{revision.status === "pending" ? "Proposed" : "This revision"}</th></tr></thead><tbody>{fields.map(([key, label]) => <tr key={key} className="border-b border-neutral-800"><td className="py-2 text-neutral-400">{label}</td>{revision.status === "pending" && <td>{display(current, key)}</td>}<td className={revision.status === "pending" && display(current, key) !== display(revision.data, key) ? "text-amber-300" : ""}>{display(revision.data, key)}</td></tr>)}</tbody></table></div>
    <p className="mt-3 font-medium">Items in this revision</p>{revision.data.items?.map(item => <p key={item.id} className="py-1 text-sm">{item.description} · {formatMoney(item.amountMinor, revision.data.currencyCode)}{item.returned ? " · Returned" : ""}</p>)}
    {revision.data.payments?.map(p => <p key={p.id} className="py-1 text-sm text-neutral-400">Imported {p.kind}: {formatMoney(p.amountMinor, revision.data.currencyCode)} · {p.date ?? "Date unknown"} · {p.destination === "ElectronicGiftCertificate" ? "Amazon balance" : p.destination ?? "Destination not recorded in this document"}</p>)}
    <p className="mt-3 font-medium">Source text</p><pre className="whitespace-pre-wrap break-words text-xs text-neutral-400">{revision.source.evidence}</pre>
  </details>;
}

function HistoryDetail({ event, currency }: { event: AmazonEvidence["history"][number]; currency: string }) {
  if (event.action.startsWith("payment-matching-")) return <p className="py-2 text-sm text-neutral-400">{event.action === "payment-matching-skipped" ? "Payment matching skipped: statement unavailable. Purchase spending unchanged." : "Payment matching resumed."}</p>;
  if (event.action.startsWith("link-")) {
    const change = event.detail as { before: AmazonLinkInput | null; after: AmazonLinkInput };
    return <p className="py-2 text-sm text-neutral-400">Transaction #{change.after.transactionId} · {change.after.kind} · {formatMoney(change.after.amountMinor, currency)} · {change.before?.status ?? "New link"} → {change.after.status} · {change.after.allocations.length} item allocations</p>;
  }
  const change = event.detail as { revisionId: number };
  return <p className="py-2 text-sm text-neutral-400">Revision {change.revisionId}</p>;
}

export function MoneyReview({ order, busy, action }: { order: AmazonOrderDetail; busy: boolean; action: (path: string, body: unknown) => Promise<string | undefined> }) {
  const [editing, setEditing] = useState<"funding" | "refunds" | null>(order.data.giftCardMinor === undefined ? "funding" : null);
  const [balance, setBalance] = useState(order.data.giftCardMinor === undefined ? "" : (order.data.giftCardMinor / 100).toFixed(2));
  const [refund, setRefund] = useState(order.data.refundMinor === undefined ? "" : (order.data.refundMinor / 100).toFixed(2));
  const [refundBalance, setRefundBalance] = useState(order.data.refundBalanceMinor !== undefined || order.balanceRefundMinor > 0 ? (order.balanceRefundMinor / 100).toFixed(2) : "");
  const [notes, setNotes] = useState({ funding: "", refunds: "" });
  const [messages, setMessages] = useState<Record<string, { error: boolean; text: string }>>({});
  const clear = (kind: string) => setMessages(current => ({ ...current, [kind]: { error: false, text: "" } }));
  const money = (value: number) => formatMoney(value, order.data.currencyCode);
  const balanceValue = /^\d+(\.\d{1,2})?$/.test(balance) ? Math.round(Number(balance) * 100) : undefined;
  const cardValue = balanceValue !== undefined && order.data.totalMinor !== undefined ? order.data.totalMinor - balanceValue : undefined;
  async function save(kind: "funding" | "refunds") {
    clear(kind);
    try {
      if (!notes[kind].trim()) throw new Error("Add an Amazon page link or a short note in the source field below.");
      const values = kind === "funding" ? { funding: { balanceMinor: amountInput(balance) } } : { refunds: { totalMinor: amountInput(refund), ...(refundBalance ? { balanceMinor: amountInput(refundBalance) } : {}) } };
      if (kind === "funding" && cardValue !== undefined && cardValue < 0) throw new Error("The amount paid from Amazon balance cannot exceed the order total.");
      if (kind === "refunds" && amountInput(refund) > (order.data.totalMinor ?? Infinity)) throw new Error("The refund total cannot exceed the order total.");
      if (kind === "refunds" && refundBalance && amountInput(refundBalance) > amountInput(refund)) throw new Error("The amount returned to Amazon balance cannot exceed the total refund.");
      const failure = await action("/money", { orderId: order.id, revisionId: order.revisionId, evidence: notes[kind].trim(), ...values });
      if (failure) throw new Error(failure);
      setEditing(null);
      setMessages(current => ({ ...current, [kind]: { error: false, text: kind === "funding" ? (cardValue === 0 ? "Payment details saved. All paid from Amazon balance; no bank payment to match." : "Payment details saved. You can now match the card payment below.") : "Refund details saved. The order cost has been updated." } }));
    } catch (e) { setMessages(current => ({ ...current, [kind]: { error: true, text: (e as Error).message } })); }
  }
  function source(kind: "funding" | "refunds") {
    return <label className="block space-y-1 text-sm"><span>Amazon page link or note <span className="text-neutral-400">(required)</span></span><textarea className={`${field} block w-full`} rows={2} value={notes[kind]} onChange={e => { setNotes(n => ({ ...n, [kind]: e.target.value })); clear(kind); }} placeholder={kind === "funding" ? "Paste the order page link, or describe the payment amounts shown by Amazon" : "Paste the refund confirmation link, or describe the refund Amazon has sent"} /></label>;
  }
  function message(kind: string) {
    const value = messages[kind];
    return value?.text && <p role={value.error ? "alert" : "status"} className={`text-sm ${value.error ? "text-red-300" : "text-emerald-300"}`}>{value.text}</p>;
  }
  return <div className="divide-y divide-neutral-800">
    <div className="pb-3"><div className="flex items-center justify-between gap-3"><div className="text-sm"><p>Original payment</p><p className="mt-1 text-neutral-400">{order.data.giftCardMinor === undefined ? "Amazon balance amount not recorded" : `${money(order.data.giftCardMinor)} Amazon balance · ${order.data.cardMinor === undefined ? "Unknown amount" : money(order.data.cardMinor)} by card`}</p></div><Button size="sm" variant="ghost" aria-expanded={editing === "funding"} onClick={() => setEditing(editing === "funding" ? null : "funding")}>{editing === "funding" ? "Cancel" : "Edit payment"}</Button></div>
    {editing === "funding" && <div className="mt-3 space-y-4 rounded-lg bg-neutral-900 p-4">
      <div><h3 id="amazon-payment-heading" className="font-semibold">Did you use Amazon balance for this order?</h3><p className="mt-1 text-sm text-neutral-400">On Amazon’s order summary, look for “Gift Card Amount”. A promotion is a discount, not Amazon balance. This asks about the original purchase, not a later refund.</p></div>
      <div className="rounded bg-neutral-900 p-3 text-sm">Order total: <strong>{order.data.totalMinor === undefined ? "Unknown" : money(order.data.totalMinor)}</strong></div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setBalance("0.00"); clear("funding"); }}>None - paid entirely by card</Button>
      <Button type="button" variant="outline" disabled={busy || order.data.totalMinor === undefined} onClick={() => { setBalance((order.data.totalMinor! / 100).toFixed(2)); clear("funding"); }}>Entire order - {order.data.totalMinor === undefined ? "amount unknown" : money(order.data.totalMinor)} from Amazon balance</Button>
      <label className="block space-y-1 text-sm"><span>Or enter the amount paid from Amazon balance ({order.data.currencyCode})</span><input className={`${field} block w-full sm:max-w-64`} inputMode="decimal" value={balance} onChange={e => { setBalance(e.target.value); clear("funding"); }} /><span className="block text-neutral-400">Use the Gift Card Amount shown on this order. Enter 0 if you paid entirely by card.</span></label>
      {cardValue !== undefined && cardValue >= 0 && <p className="text-sm">Remaining amount paid by card: <strong>{money(cardValue)}</strong></p>}
      {source("funding")}
      {message("funding")}
      <Button disabled={busy || !balance || order.data.totalMinor === undefined} onClick={() => save("funding")}>Save payment details</Button>
    </div>}</div>
    <div className="pt-3"><div className="flex items-center justify-between gap-3"><div className="text-sm"><p>Refunds</p><p className="mt-1 text-neutral-400">{order.data.refundMinor ? `${money(order.data.refundMinor)} refunded` : "No refund recorded"}{!!order.data.refundMinor && <span className="block text-xs">{order.data.refundBalanceMinor !== undefined || order.balanceRefundMinor > 0 ? `${money(order.balanceRefundMinor)} to Amazon balance${order.data.refundMinor === order.balanceRefundMinor ? "" : order.data.refundBalanceMinor !== undefined ? ` · ${money(order.data.refundMinor - order.balanceRefundMinor)} to bank` : " · Remaining destination not confirmed"}` : "Destination not recorded"}</span>}</p></div><Button size="sm" variant="ghost" aria-expanded={editing === "refunds"} onClick={() => setEditing(editing === "refunds" ? null : "refunds")}>{editing === "refunds" ? "Cancel" : order.data.refundMinor ? "Edit refund" : "Add refund"}</Button></div>
      {editing === "refunds" && <div className="mt-3 space-y-4 rounded-lg bg-neutral-900 p-4"><p className="text-sm text-neutral-400">Only fill this in if Amazon has sent money back for this purchase. Credit used to buy this order belongs in payment details, not here.</p>
        <label className="block space-y-1 text-sm"><span>Total refunded for this order ({order.data.currencyCode})</span><input className={`${field} block w-full sm:max-w-64`} inputMode="decimal" value={refund} onChange={e => { setRefund(e.target.value); clear("refunds"); }} /><span className="block text-neutral-400">Add together all refunds already sent for this order, including any saved here before. Do not include a return still awaiting a refund.</span></label>
        <label className="block space-y-1 text-sm"><span>Amount returned to Amazon balance ({order.data.currencyCode})</span><input className={`${field} block w-full sm:max-w-64`} inputMode="decimal" value={refundBalance} onChange={e => { setRefundBalance(e.target.value); clear("refunds"); }} /><span className="block text-neutral-400">This is part of the total above, not an extra refund. Enter 0 if it all went to your bank, or leave blank if you do not know.</span></label>
        {source("refunds")}
        {message("refunds")}
        <Button disabled={busy || !refund} onClick={() => save("refunds")}>Save refund details</Button>
      </div>}</div>
  </div>;
}

function ItemName({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = description.length > 95;
  return <div className="text-sm"><p>{long && !expanded ? `${description.slice(0, 95).trimEnd()}…` : description}</p>{long && <button type="button" className="mt-1 text-xs text-neutral-400 underline underline-offset-2" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Full item name"}</button>}</div>;
}
