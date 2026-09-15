import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { plannedMonthly, plannedTotal, type PlannedSpending, type PlannedSpendingInput } from "../app/planned-spending";
import { formatMoney } from "./formatters";

const field = "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm";
export function PlannedSpendingPanel({ currency, recurringMonthly, items, onChange }: {
  currency: string; recurringMonthly: number; items: PlannedSpending[]; onChange: (items: PlannedSpending[]) => void;
}) {
  const [editing, setEditing] = useState<PlannedSpending | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/planned-spending").then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (active) { onChange(data); setLoaded(true); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [onChange]);
  async function save(input: PlannedSpendingInput, id?: number) {
    const response = await fetch("/api/planned-spending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, id }) });
    const saved = await response.json(); if (!response.ok) throw new Error(saved.error);
    onChange(id === undefined ? [...items, saved] : items.map(i => i.id === id ? saved : i));
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const monthly = plannedTotal(items, currency);
  return <section className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 sm:p-6" aria-labelledby="planned-title">
    <div className="flex flex-wrap justify-between gap-3"><div><h3 id="planned-title" className="text-lg font-medium">Planned spending</h3><p className="mt-1 text-sm text-neutral-400">Adjust assumptions for irregular purchases. These are monthly averages, with no payment dates or missing-payment alerts.</p></div><Button variant="outline" disabled={busy || !loaded} onClick={() => { setEditing(null); setAdding(true); }}>Add planned item</Button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!loaded && !error && <p role="status" className="text-sm text-neutral-400">Loading planned spending…</p>}
    {loaded && <div className="grid gap-3 sm:grid-cols-3">
      {[ ["Recurring commitments", recurringMonthly], ["Planned spending", monthly], ["Estimated monthly total", recurringMonthly + monthly] ].map(([label, amount]) => <div key={label} className="rounded-xl border border-neutral-800 p-4"><p className="text-sm text-neutral-400">{label}</p><p className="mt-2 text-2xl tabular-nums">{formatMoney(Number(amount), currency)}</p></div>)}
    </div>}
    <div className="divide-y divide-neutral-800">{items.filter(i => i.currencyCode === currency).map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <label className="flex items-center gap-3"><input type="checkbox" checked={item.included} disabled={busy} onChange={e => { const { id, ...input } = item; void action(() => save({ ...input, included: e.target.checked }, id)); }} /><span><span className="block">{item.name}</span><span className="text-xs text-neutral-400">{item.quantity} × {formatMoney(item.priceMinor, currency)} every {item.interval} {item.unit}</span></span></label>
      <div className="flex items-center gap-3"><span className="text-sm tabular-nums">{formatMoney(plannedMonthly(item), currency)}/mo{!item.included && " · Excluded"}</span><Button variant="outline" disabled={busy} onClick={() => { setEditing(item); setAdding(false); }}>Edit</Button></div>
    </div>)}</div>
    {loaded && !items.some(i => i.currencyCode === currency) && <p className="text-sm text-neutral-400">Add an item such as Celsius packs or protein powder, or enter a monthly allowance with quantity 1 every 1 month.</p>}
    {(adding || editing) && <PlannedForm key={editing?.id ?? "new"} item={editing} currency={currency} busy={busy} onCancel={() => { setAdding(false); setEditing(null); }} onSave={input => action(async () => { await save(input, editing?.id); setAdding(false); setEditing(null); })} onRemove={editing ? () => action(async () => {
      const response = await fetch("/api/planned-spending/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id }) });
      if (!response.ok) throw new Error((await response.json()).error);
      onChange(items.filter(i => i.id !== editing.id)); setEditing(null);
    }) : undefined} />}
  </section>;
}

function PlannedForm({ item, currency, busy, onCancel, onSave, onRemove }: {
  item: PlannedSpending | null; currency: string; busy: boolean; onCancel: () => void;
  onSave: (input: PlannedSpendingInput) => Promise<void>; onRemove?: () => Promise<void>;
}) {
  const [price, setPrice] = useState(String((item?.priceMinor ?? 0) / 100));
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [interval, setInterval] = useState(String(item?.interval ?? 1));
  const [unit, setUnit] = useState<"weeks" | "months">(item?.unit ?? "months");
  const [code, setCode] = useState(item?.currencyCode ?? currency);
  const estimate = plannedMonthly({ name: "", currencyCode: code, priceMinor: Math.round(Number(price) * 100), quantity: Number(quantity), interval: Number(interval), unit, included: true });
  return <form className="space-y-4 rounded-xl border border-neutral-700 p-4" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    void onSave({ name: String(form.get("name")), currencyCode: code, priceMinor: Math.round(Number(price) * 100), quantity: Number(quantity), interval: Number(interval), unit, included: item?.included ?? true });
  }}>
    <h4 className="font-medium">{item ? "Edit planned item" : "New planned item"}</h4>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Item name<input className={field} name="name" required maxLength={200} defaultValue={item?.name} placeholder="Celsius packs" /></label>
      <label className="text-sm">Currency<input className={field} required pattern="[A-Z]{3}" maxLength={3} value={code} onChange={e => setCode(e.target.value.toUpperCase())} /></label>
      <label className="text-sm">Price per item<input className={field} type="number" required min="0" max="1000000" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label className="text-sm">Quantity<input className={field} type="number" required min="1" max="100000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
      <label className="text-sm">Every<input className={field} type="number" required min="1" max="1200" step="1" value={interval} onChange={e => setInterval(e.target.value)} /></label>
      <label className="text-sm">Period<select className={field} value={unit} onChange={e => setUnit(e.target.value as typeof unit)}><option value="months">Months</option><option value="weeks">Weeks</option></select></label>
    </fieldset>
    <p className="text-sm text-neutral-400">{Number.isFinite(estimate) && /^[A-Z]{3}$/.test(code) ? `${formatMoney(estimate, code)} per month on average` : "Enter a price and interval to see the monthly estimate."} · Use packs or individual items consistently.</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy}>Save item</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>{onRemove && <Button type="button" variant="outline" disabled={busy} onClick={() => void onRemove()}>Delete item</Button>}</div>
  </form>;
}
