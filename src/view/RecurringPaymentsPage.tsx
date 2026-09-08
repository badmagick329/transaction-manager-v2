import { useEffect, useState } from "react";
import { frequencies, type RecurringPaymentInput, type recurringOverview } from "../app/recurring-payments";
import type { Account } from "./types";
import { formatMoney, titleCase } from "./formatters";

type Overview = ReturnType<typeof recurringOverview>;
type Draft = RecurringPaymentInput & { id?: number };
const field = "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm";
const button = "rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50";
const blank = (accounts: Account[]): Draft => ({ name: "", kind: "subscription", accountId: accounts[0]?.id ?? 0, currencyCode: accounts[0]?.currencyCode ?? "GBP", description: "", amountMinor: 0, frequency: "monthly", anchorDate: new Date().toISOString().slice(0, 10), status: "active" });

export function RecurringPaymentsPage({ accounts, seedTransactionId, clearSeed }: { accounts: Account[]; seedTransactionId: number | null; clearSeed: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [existingId, setExistingId] = useState("");
  function edit(value: Draft) { setDraft(value); setAmount((value.amountMinor / 100).toFixed(2)); }
  async function load() {
    const response = await fetch("/api/recurring-payments");
    if (!response.ok) throw new Error("Unable to load recurring payments.");
    setData(await response.json());
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (seedTransactionId === null) return;
    let cancelled = false;
    fetch(`/api/recurring-payments/seed?id=${seedTransactionId}`).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      if (!cancelled) edit({ ...blank(accounts), name: value.description, description: value.description, accountId: value.accountId, currencyCode: value.currencyCode, amountMinor: Math.abs(value.amountMinor), anchorDate: value.transactionDate.slice(0, 10) });
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [seedTransactionId]);
  async function save(value: Draft, close = false) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/recurring-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (close && seedTransactionId !== null) {
        const linkResponse = await fetch("/api/recurring-payments/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: seedTransactionId, paymentId: result.id }) });
        if (!linkResponse.ok) { setDraft({ ...value, id: result.id }); throw new Error("Payment saved, but the transaction could not be linked. Retry saving."); }
      }
      if (close) { setDraft(null); clearSeed(); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save recurring payment."); }
    finally { setBusy(false); }
  }
  async function linkExisting() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/recurring-payments/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: seedTransactionId, paymentId: Number(existingId) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDraft(null); clearSeed(); setExistingId(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to link payment."); }
    finally { setBusy(false); }
  }
  const active = data?.payments.filter(p => p.status === "active") ?? [];
  const totals = new Map<string, number>();
  for (const p of active) totals.set(p.currencyCode, (totals.get(p.currencyCode) ?? 0) + p.monthlyEquivalentMinor);
  return <section className="mt-8 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Recurring payments</h2><p className="mt-1 text-sm text-neutral-400">Subscriptions, bills, and instalments. Dates and costs are estimates from your records.</p></div><button className={button} onClick={() => { clearSeed(); edit(blank(accounts)); }} disabled={busy}>Add manually</button></div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {[...totals].map(([currency, total]) => <p key={currency} className="text-lg">{formatMoney(total, currency)} <span className="text-sm text-neutral-400">monthly equivalent · active payments</span></p>)}
    {draft && <form className="space-y-4 rounded-xl border border-neutral-700 p-5" onSubmit={event => { event.preventDefault(); void save({ ...draft, amountMinor: Math.round(Number(amount) * 100) }, true); }}>
      <h3 className="font-medium">{draft.id ? "Edit recurring payment" : "Add recurring payment"}</h3>
      {seedTransactionId !== null && <div className="space-y-2"><label className="text-sm">Or attach this transaction to an existing payment<select className={field} value={existingId} onChange={e => setExistingId(e.target.value)}><option value="">Choose recurring payment</option>{data?.payments.filter(p => p.status !== "dismissed" && p.currencyCode === draft.currencyCode).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button type="button" className={button} disabled={busy || !existingId} onClick={() => void linkExisting()}>Attach transaction</button><p className="text-xs text-neutral-400">If you changed cards, edit the tracked account and statement description afterwards to match future charges.</p></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Name<input className={field} required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="text-sm">Kind<select className={field} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}>{["subscription", "bill", "instalment"].map(v => <option key={v} value={v}>{titleCase(v)}</option>)}</select></label>
        <label className="text-sm">Account<select className={field} required value={draft.accountId || ""} onChange={e => { const account = accounts.find(a => a.id === Number(e.target.value))!; setDraft({ ...draft, accountId: account.id, currencyCode: account.currencyCode }); }}><option value="" disabled>Choose account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.sourceName} · {a.name}</option>)}</select></label>
        <label className="text-sm">Statement description<input className={field} required maxLength={500} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /><span className="text-xs text-neutral-400">Exact text, ignoring case and extra spaces.</span></label>
        <label className="text-sm">Expected amount<input className={field} type="number" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="text-sm">Currency<input className={field} required pattern="[A-Z]{3}" maxLength={3} value={draft.currencyCode} onChange={e => setDraft({ ...draft, currencyCode: e.target.value.toUpperCase() })} /></label>
        <label className="text-sm">Frequency<select className={field} value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value as Draft["frequency"] })}>{frequencies.map(v => <option key={v} value={v}>{v === "quarterly" ? "Quarterly · every 3 months" : titleCase(v)}</option>)}</select></label>
        <label className="text-sm">Known or next billing date<input className={field} type="date" required value={draft.anchorDate} onChange={e => setDraft({ ...draft, anchorDate: e.target.value })} /></label>
        <label className="text-sm">Status<select className={field} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Draft["status"] })}>{["active", "paused", "cancelled", "dismissed"].map(v => <option key={v} value={v}>{titleCase(v)}</option>)}</select></label>
      </div>
      <div className="flex gap-2"><button className={button} disabled={busy}>{busy ? "Saving…" : "Save"}</button><button className={button} type="button" disabled={busy} onClick={() => { setDraft(null); clearSeed(); }}>Cancel</button></div>
    </form>}
    {!data ? <p className="text-neutral-400">Loading recurring payments…</p> : <>
      <div className="space-y-3"><h3 className="font-medium">Tracked payments</h3>{data.payments.filter(p => p.status !== "dismissed").length === 0 && <p className="text-sm text-neutral-400">No recurring payments yet. Add one manually or review a suggestion below.</p>}
        {data.payments.filter(p => p.status !== "dismissed").map(p => <article key={p.id} className="rounded-xl border border-neutral-800 p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-medium">{p.name}</h4><p className="text-sm text-neutral-400">{titleCase(p.kind)} · {p.frequency} · {p.status} · {accounts.find(a => a.id === p.accountId)?.name}</p><p className="mt-2 text-sm">Expected {formatMoney(p.amountMinor, p.currencyCode)} · {p.nextDate ? `Next expected: ${p.nextDate}` : "Schedule paused"}</p><p className="text-sm text-neutral-400">Last payment: {p.transactions.at(-1) ? `${p.transactions.at(-1)!.transactionDate.slice(0, 10)} · ${formatMoney(Math.abs(p.transactions.at(-1)!.amountMinor), p.currencyCode)}` : "No matching payment"}</p></div><button className={button} disabled={busy} onClick={() => { clearSeed(); edit(p); }}>Edit</button></div>
          {p.priceChanged && <p className="mt-2 text-sm text-amber-300">Latest amount differs from your expected amount. Review before updating the schedule.</p>}
          {p.needsReview && <p className="mt-2 text-sm text-amber-300">Multiple possible matches. Ambiguous payments have not been attached.</p>}
          {p.paymentMissing && <p className="mt-2 text-sm text-amber-300">Expected payment not found in covered statements. Check its status.</p>}
          {p.coverageUnknown && <p className="mt-2 text-sm text-neutral-400">Import statements covering the expected date to check for payment.</p>}
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-neutral-400">Matching payments ({p.transactions.length})</summary>{p.transactions.map(t => <p key={t.id} className="mt-1">{t.transactionDate.slice(0, 10)} · {t.description} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)}</p>)}</details>
        </article>)}
      </div>
      <div className="space-y-3"><h3 className="font-medium">Suggestions ({data.suggestions.length})</h3><p className="text-sm text-neutral-400">Recurring purchases can look like subscriptions. Check the evidence before confirming.</p>{data.suggestions.map((s, index) => <article key={index} className="rounded-xl border border-neutral-800 p-4"><h4 className="font-medium">{s.name} · {formatMoney(s.amountMinor, s.currencyCode)}</h4><p className="mt-1 text-sm text-neutral-400">{s.reason}</p><div className="my-3 text-sm">{s.transactions.map(t => <p key={t.id}>{t.transactionDate.slice(0, 10)} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)}</p>)}</div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { clearSeed(); edit(s); }}>Review and confirm</button><button className={button} disabled={busy} onClick={() => void save({ ...s, status: "dismissed" })}>Dismiss</button></div></article>)}</div>
      <details className="text-sm"><summary className="cursor-pointer text-neutral-400">Dismissed suggestions ({data.payments.filter(p => p.status === "dismissed").length})</summary>{data.payments.filter(p => p.status === "dismissed").map(p => <div key={p.id} className="mt-3 flex items-center gap-3">{p.name}<button className={button} disabled={busy} onClick={() => { clearSeed(); edit({ ...p, status: "active" }); }}>Restore and edit</button></div>)}</details>
    </>}
  </section>;
}
