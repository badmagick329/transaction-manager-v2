import { Button } from '../components/ui/button';
import { RecurringAgentReview } from './RecurringAgentReview';
import { Input } from '../components/ui/input';
import { EditorDialog } from '../components/ui/editor-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useEffect, useState } from "react";
import { frequencies, type PaymentMethodChange, type RecurringPaymentInput, type previewRecurringChange, type recurringOverview } from "../app/recurring-payments";
import type { Account } from "./types";
import { formatMoney, titleCase } from "./formatters";

type Overview = ReturnType<typeof recurringOverview>;
type Draft = RecurringPaymentInput & { id?: number };
const field = "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm";
const blank = (accounts: Account[]): Draft => ({ matchMode: "exact", name: "", kind: "subscription", accountId: accounts[0]?.id ?? 0, currencyCode: accounts[0]?.currencyCode ?? "GBP", description: "", amountMinor: 0, frequency: "monthly", anchorDate: new Date().toISOString().slice(0, 10), status: "active" });

export function RecurringPaymentsPage({ accounts, seedTransactionId, clearSeed, selectedPaymentId }: { selectedPaymentId: number | null; accounts: Account[]; seedTransactionId: number | null; clearSeed: () => void }) {
  const [paymentView, setPaymentView] = useState("active");
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { if (selectedPaymentId !== null) { setPaymentView("all"); setSearch(""); } }, [selectedPaymentId]);
  useEffect(() => {
    if (selectedPaymentId === null || !data) return;
    const card = document.getElementById(`recurring-payment-${selectedPaymentId}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.focus({ preventScroll: true });
  }, [data, selectedPaymentId, paymentView]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [existingId, setExistingId] = useState("");
  const [method, setMethod] = useState<PaymentMethodChange | null>(null);
  const [methodAmount, setMethodAmount] = useState("");
  const [methodCurrency, setMethodCurrency] = useState("");
  const [preview, setPreview] = useState<{ key: string; result: ReturnType<typeof previewRecurringChange> } | null>(null);
  const previewKey = (path: string, body: unknown) => JSON.stringify([path, body, path === "/api/recurring-payments" ? seedTransactionId : null]);
  async function previewBeforeSave(path: string, body: unknown) {
    const key = previewKey(path, body);
    if (preview?.key === key) return true;
    const payload = path === "/api/recurring-payments" && seedTransactionId !== null ? { ...body as Draft, linkedTransactionId: seedTransactionId } : body;
    const response = await fetch(`${path}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setPreview({ key, result });
    return false;
  }
  function startMethod(value: PaymentMethodChange, currency: string) {
    setNotice("");
    setMethodAmount(value.amountMinor === null ? "" : (value.amountMinor / 100).toFixed(2));
    clearSeed(); setDraft(null); setMethod(value); setMethodCurrency(currency); setError(""); setPreview(null);

  }
  async function saveMethod() {
    setBusy(true); setError("");
    try {
      if (!await previewBeforeSave("/api/recurring-payments/method", method)) return;
      const response = await fetch("/api/recurring-payments/method", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(method) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMethod(null); await load(); setNotice("Billing update saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to change payment method."); }
    finally { setBusy(false); }
  }
  function edit(value: Draft) { setNotice(""); setError(""); setPreview(null); setMethod(null); setDraft(value); setAmount((value.amountMinor / 100).toFixed(2)); }
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
      if (close && !await previewBeforeSave("/api/recurring-payments", value)) return;
      const response = await fetch("/api/recurring-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (close && seedTransactionId !== null) {
        const linkResponse = await fetch("/api/recurring-payments/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: seedTransactionId, paymentId: result.id }) });
        if (!linkResponse.ok) { setDraft({ ...value, id: result.id }); throw new Error("Payment saved, but the transaction could not be linked. Retry saving."); }
      }
      if (close) { setDraft(null); clearSeed(); }
      await load();
      setNotice(close ? "Recurring payment saved." : "Suggestion dismissed.");
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

  const [search, setSearch] = useState("");
  const active = data?.payments.filter(p => p.status === "active") ?? [];
  const visiblePayments = data?.payments.filter(p => p.status !== "dismissed" && (paymentView === "all" || (paymentView === "active" ? p.status === "active" : p.status !== "active")) && p.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const visibleSuggestions = data?.suggestions.filter(s => s.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const totals = new Map<string, number>();
  for (const p of active) totals.set(p.currencyCode, (totals.get(p.currencyCode) ?? 0) + p.monthlyEquivalentMinor);
  return <section className="mt-8 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Recurring payments</h2><p className="mt-1 text-sm text-neutral-400">Subscriptions, bills, and instalments. Dates and costs are estimates from your records.</p></div><Button variant="outline" onClick={() => { clearSeed(); edit(blank(accounts)); }} disabled={busy}>Add manually</Button></div>
    {error && !draft && !method && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    <RecurringAgentReview accounts={accounts} refreshKey={data} onChanged={load} />
    {method && <EditorDialog title="Update billing & matching" busy={busy} onClose={() => setMethod(null)}><form className="space-y-4" onSubmit={e => { e.preventDefault(); void saveMethod(); }}>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <p className="text-sm text-neutral-400">Change the price, billing schedule or account from a specific date. Earlier payments keep their recorded settings.</p>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Existing subscription<Select  disabled={!!method.previousEffectiveDate} required value={String(method.paymentId || "") || "none"} onValueChange={selected => { const value = selected === "none" ? "" : selected; setMethod({ ...method, paymentId: Number(value) }) }}><SelectTrigger aria-label="Existing subscription" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none" disabled>Choose subscription</SelectItem>{data?.payments.filter(p => p.status !== "dismissed" && p.currencyCode === methodCurrency).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></label><label className="text-sm">Effective from<Input className={field} type="date" required value={method.effectiveDate} onChange={e => setMethod({ ...method, effectiveDate: e.target.value })} /></label><label className="text-sm">New expected amount (optional)<Input className={field} type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={methodAmount} onChange={e => { setMethodAmount(e.target.value); setMethod({ ...method, amountMinor: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) }); }} /></label><label className="text-sm">New billing date (optional)<Input className={field} type="date" value={method.anchorDate ?? ""} onChange={e => setMethod({ ...method, anchorDate: e.target.value || null })} /></label><label className="text-sm">New frequency (optional)<Select  value={String(method.frequency ?? "") || "none"} onValueChange={selected => { const value = selected === "none" ? "" : selected; setMethod({ ...method, frequency: value as PaymentMethodChange["frequency"] || null }) }}><SelectTrigger aria-label="New frequency (optional)" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Keep preceding frequency</SelectItem>{frequencies.map(f => <SelectItem key={f} value={f}>{titleCase(f)}</SelectItem>)}</SelectContent></Select></label></div>
      <details className="rounded-lg border border-neutral-800 p-3"><summary className="cursor-pointer text-sm text-neutral-300">Account & statement matching</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">New account<Select  required value={String(method.accountId || "") || "none"} onValueChange={selected => { const value = selected === "none" ? "" : selected; setMethod({ ...method, accountId: Number(value) }) }}><SelectTrigger aria-label="New account" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none" disabled>Choose account</SelectItem>{accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.sourceName} · {a.name}</SelectItem>)}</SelectContent></Select></label><label className="text-sm">Statement description or prefix<Input className={field} required maxLength={500} value={method.description} onChange={e => setMethod({ ...method, description: e.target.value })} /></label><label className="text-sm">Description matching<Select  value={method.matchMode} onValueChange={value => { setMethod({ ...method, matchMode: value as PaymentMethodChange["matchMode"] }) }}><SelectTrigger aria-label="Description matching" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="exact">Exact description</SelectItem><SelectItem value="starts_with">Starts with</SelectItem></SelectContent></Select></label></div></details>
      <p className="text-xs text-neutral-400">Leave billing overrides blank to keep the preceding schedule and price. Currency stays {methodCurrency}.</p>
      {preview?.key === previewKey("/api/recurring-payments/method", method) && <MatchingPreview result={preview.result} />}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy}>{preview?.key === previewKey("/api/recurring-payments/method", method) ? "Confirm and save" : "Preview matching payments"}</Button><Button variant="outline" type="button" disabled={busy} onClick={() => setMethod(null)}>Cancel</Button></div>
    </form></EditorDialog>}
    {[...totals].map(([currency, total]) => <p key={currency} className="text-lg">{formatMoney(total, currency)} <span className="text-sm text-neutral-400">monthly equivalent · active payments</span></p>)}
    {draft && <EditorDialog title={draft.id ? `Edit ${draft.name}` : "Add recurring payment"} busy={busy} onClose={() => { setDraft(null); clearSeed(); }}><form className="space-y-4" onSubmit={event => { event.preventDefault(); void save({ ...draft, amountMinor: Math.round(Number(amount) * 100) }, true); }}>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {seedTransactionId !== null && <div className="space-y-2"><label className="text-sm">Or attach this transaction to an existing payment<Select  value={String(existingId) || "none"} onValueChange={selected => { const value = selected === "none" ? "" : selected; setExistingId(value) }}><SelectTrigger aria-label="Or attach this transaction to an existing payment" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Choose recurring payment</SelectItem>{data?.payments.filter(p => p.status !== "dismissed" && p.currencyCode === draft.currencyCode).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></label><Button variant="outline" type="button" disabled={busy || !existingId} onClick={() => void linkExisting()}>Attach transaction</Button><Button variant="outline" type="button" disabled={busy || !existingId} onClick={() => startMethod({ matchMode: "exact", anchorDate: null, frequency: null, amountMinor: null, paymentId: Number(existingId), accountId: draft.accountId, description: draft.description, effectiveDate: draft.anchorDate }, draft.currencyCode)}>Change matching or billing from this transaction</Button><p className="text-xs text-neutral-400">For a provider switch, use Change matching or billing below to match future charges and preserve history.</p></div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Name<Input className={field} required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="text-sm">Kind<Select  value={draft.kind} onValueChange={value => { setDraft({ ...draft, kind: value as Draft["kind"] }) }}><SelectTrigger aria-label="Kind" className={field}><SelectValue /></SelectTrigger><SelectContent>{["subscription", "bill", "instalment"].map(v => <SelectItem key={v} value={v}>{titleCase(v)}</SelectItem>)}</SelectContent></Select></label>

        {!draft.id && <label className="text-sm">Account<Select  required value={String(draft.accountId || "") || "none"} onValueChange={selected => { const value = selected === "none" ? "" : selected; { const account = accounts.find(a => a.id === Number(value))!; setDraft({ ...draft, accountId: account.id, currencyCode: account.currencyCode }); } }}><SelectTrigger aria-label="Account" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none" disabled>Choose account</SelectItem>{accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.sourceName} · {a.name}</SelectItem>)}</SelectContent></Select></label>}

        {!draft.id && <label className="text-sm">Expected amount<Input className={field} type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required value={amount} onChange={e => setAmount(e.target.value)} /></label>}
        {!draft.id && <label className="text-sm">Currency<Input className={field} required pattern="[A-Z]{3}" maxLength={3} value={draft.currencyCode} onChange={e => setDraft({ ...draft, currencyCode: e.target.value.toUpperCase() })} /></label>}
        {!draft.id && <label className="text-sm">Frequency<Select  value={draft.frequency} onValueChange={value => { setDraft({ ...draft, frequency: value as Draft["frequency"] }) }}><SelectTrigger aria-label="Frequency" className={field}><SelectValue /></SelectTrigger><SelectContent>{frequencies.map(v => <SelectItem key={v} value={v}>{v === "quarterly" ? "Quarterly · every 3 months" : titleCase(v)}</SelectItem>)}</SelectContent></Select></label>}
        {!draft.id && <label className="text-sm">Known or next billing date<Input className={field} type="date" required value={draft.anchorDate} onChange={e => setDraft({ ...draft, anchorDate: e.target.value })} /></label>}
        <label className="text-sm">Status<Select  value={draft.status} onValueChange={value => { setDraft({ ...draft, status: value as Draft["status"] }) }}><SelectTrigger aria-label="Status" className={field}><SelectValue /></SelectTrigger><SelectContent>{["active", "paused", "cancelled", "dismissed"].map(v => <SelectItem key={v} value={v}>{titleCase(v)}</SelectItem>)}</SelectContent></Select></label>
      </div>
      <fieldset className="rounded-lg border border-neutral-800 p-4"><legend className="px-1 text-sm text-neutral-400">Matching settings</legend><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Statement description<Input className={field} aria-label="Statement description" required maxLength={500} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /><span className="text-xs text-neutral-400">Ignores case and extra spaces. Review the preview before saving.</span></label><label className="text-sm">Description matching<Select  value={draft.matchMode} onValueChange={value => { setDraft({ ...draft, matchMode: value as Draft["matchMode"] }) }}><SelectTrigger aria-label="Description matching" className={field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="exact">Exact description</SelectItem><SelectItem value="starts_with">Starts with</SelectItem></SelectContent></Select></label></div></fieldset>
      {draft.id && <div className="rounded-lg border border-neutral-800 p-4"><p className="mb-3 text-sm text-neutral-400">To change the expected amount, schedule or account, add a dated billing update.</p><Button type="button" variant="secondary" onClick={() => { const p = data!.payments.find(p => p.id === draft.id)!; startMethod({ paymentId: p.id, ...p.currentMethod, effectiveDate: new Date().toISOString().slice(0, 10) }, p.currencyCode); }}>Update amount or billing</Button></div>}
      {preview?.key === previewKey("/api/recurring-payments", { ...draft, amountMinor: Math.round(Number(amount) * 100) }) && <MatchingPreview result={preview.result} />}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy}>{busy ? "Working…" : preview?.key === previewKey("/api/recurring-payments", { ...draft, amountMinor: Math.round(Number(amount) * 100) }) ? "Confirm and save" : "Preview matching payments"}</Button><Button variant="outline" type="button" disabled={busy} onClick={() => { setDraft(null); clearSeed(); }}>Cancel</Button></div>
    </form></EditorDialog>}
    <div className="flex flex-wrap items-center gap-2"><Input aria-label="Search recurring payments" placeholder="Search payments…" className="sm:max-w-xs" value={search} onChange={e => setSearch(e.target.value)} />{["active", "inactive", "all", "suggestions"].map(view => <Button key={view} variant={paymentView === view ? "secondary" : "ghost"} aria-pressed={paymentView === view} onClick={() => setPaymentView(view)}>{titleCase(view)}{view === "suggestions" && data ? ` (${data.suggestions.length})` : ""}</Button>)}</div>
    {!data ? <p className="text-neutral-400">Loading recurring payments…</p> : <>
      <div className={paymentView === "suggestions" ? "hidden" : "space-y-3"}><h3 className="font-medium">Tracked payments</h3>{visiblePayments.length === 0 && <p className="text-sm text-neutral-400">No payments in this view. Try another view or search.</p>}
        {visiblePayments.map(p => <article key={p.id} id={`recurring-payment-${p.id}`} tabIndex={-1} className="rounded-xl border border-neutral-800 p-4 focus:outline focus:outline-2 focus:outline-sky-500"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-medium">{p.name}</h4><p className="text-sm text-neutral-400">{titleCase(p.kind)} · {p.currentMethod.frequency} · {p.status} · {accounts.find(a => a.id === p.currentMethod.accountId)?.name}</p><p className="mt-2 text-sm">Expected {formatMoney(p.currentMethod.amountMinor, p.currencyCode)} · {p.nextDate ? `Next expected: ${p.nextDate}` : "Schedule paused"}</p><p className="text-sm text-neutral-400">Last payment: {p.transactions.at(-1) ? `${p.transactions.at(-1)!.transactionDate.slice(0, 10)} · ${formatMoney(Math.abs(p.transactions.at(-1)!.amountMinor), p.currencyCode)}` : "No matching payment"}</p></div><div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto"><Button variant="outline" disabled={busy} onClick={() => { clearSeed(); edit(p); }}>Edit details</Button><Button variant="outline" disabled={busy} onClick={() => startMethod({ matchMode: p.currentMethod.matchMode, anchorDate: null, frequency: p.currentMethod.frequency, amountMinor: p.currentMethod.amountMinor, paymentId: p.id, accountId: p.currentMethod.accountId, description: p.currentMethod.description, effectiveDate: new Date().toISOString().slice(0, 10) }, p.currencyCode)}>Update billing</Button></div></div>
          {p.priceChanged && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200"><span>Latest payment differs from the expected amount.</span><Button variant="outline" size="sm" disabled={busy} onClick={() => { const latest = p.transactions.at(-1)!; startMethod({ paymentId: p.id, accountId: p.currentMethod.accountId, description: p.currentMethod.description, matchMode: p.currentMethod.matchMode, frequency: null, anchorDate: latest.transactionDate.slice(0, 10), amountMinor: Math.abs(latest.amountMinor), effectiveDate: latest.transactionDate.slice(0, 10) }, p.currencyCode); }}>Review price change</Button></div>}
          {p.needsReview && <p className="mt-2 text-sm text-amber-300">Multiple possible matches. Ambiguous payments have not been attached.</p>}
          {p.paymentMissing && <p className="mt-2 text-sm text-amber-300">Expected payment not found in covered statements. Check its status.</p>}
          {p.coverageUnknown && <p className="mt-2 text-sm text-neutral-400">Import statements covering the expected date to check for payment.</p>}
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-neutral-400">Payment method history</summary><p className="mt-1">Initially: {accounts.find(a => a.id === p.accountId)?.name} · {p.description}</p>{p.methods.map(m => <p key={m.effectiveDate} className="mt-1">From {m.effectiveDate}: {accounts.find(a => a.id === m.accountId)?.name} · {m.matchMode === "starts_with" ? "Starts with: " : "Exact: "}{m.description}{m.anchorDate ? ` · Billing date: ${m.anchorDate}` : ""}{m.frequency ? ` · ${m.frequency}` : ""}{m.amountMinor !== null ? ` · ${formatMoney(m.amountMinor, p.currencyCode)}` : ""} <Button variant="outline" className="text-sky-400 hover:underline" disabled={busy} onClick={() => startMethod({ ...m, previousEffectiveDate: m.effectiveDate }, p.currencyCode)}>Correct</Button></p>)}</details><details className="mt-3 text-sm"><summary className="cursor-pointer text-neutral-400">Matching payments ({p.transactions.length})</summary>{p.transactions.map(t => <p key={t.id} className="mt-1">{t.transactionDate.slice(0, 10)} · {accounts.find(a => a.id === t.accountId)?.name} · {t.description} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)}</p>)}</details>
        </article>)}
      </div>
      <div className={paymentView === "suggestions" ? "space-y-3" : "hidden"}><h3 className="font-medium">Suggestions ({data.suggestions.length})</h3><p className="text-sm text-neutral-400">Recurring purchases can look like subscriptions. Check the evidence before confirming.</p>{visibleSuggestions.length === 0 && <p className="text-sm text-neutral-400">No suggestions match this search.</p>}{visibleSuggestions.map((s, index) => <article key={index} className="rounded-xl border border-neutral-800 p-4"><h4 className="font-medium">{s.name} · {formatMoney(s.amountMinor, s.currencyCode)}</h4><p className="mt-1 text-sm text-neutral-400">{s.reason}</p><div className="my-3 text-sm">{s.transactions.map(t => <p key={t.id}>{t.transactionDate.slice(0, 10)} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)}</p>)}</div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { clearSeed(); edit(s); }}>Review and confirm</Button><Button variant="outline" disabled={busy || !data.payments.some(p => p.status !== "dismissed" && p.currencyCode === s.currencyCode)} onClick={() => startMethod({ matchMode: "exact", anchorDate: null, frequency: null, amountMinor: null, paymentId: 0, accountId: s.accountId, description: s.description, effectiveDate: s.firstPaymentDate }, s.currencyCode)}>Link to existing subscription</Button><Button variant="outline" disabled={busy} onClick={() => void save({ ...s, status: "dismissed" })}>Dismiss</Button></div></article>)}</div>
      <details className="text-sm"><summary className="cursor-pointer text-neutral-400">Dismissed suggestions ({data.payments.filter(p => p.status === "dismissed").length})</summary>{data.payments.filter(p => p.status === "dismissed").map(p => <div key={p.id} className="mt-3 flex items-center gap-3">{p.name}<Button variant="outline" disabled={busy} onClick={() => { clearSeed(); edit({ ...p, status: "active" }); }}>Restore and edit</Button></div>)}</details>
    </>}
  </section>;
}

function MatchingPreview({ result }: { result: ReturnType<typeof previewRecurringChange> }) {
  return <div className="space-y-2 rounded-lg border border-neutral-700 p-3 text-sm"><p>Review matching payments · Next expected: {result.nextDate ?? "Schedule paused"}</p><div className="max-h-72 space-y-2 overflow-auto">{result.rows.length === 0 ? <p>No payments match this rule yet.</p> : result.rows.map(t => <p key={t.id}>{t.transactionDate.slice(0, 10)} · {t.description} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)} <span className={t.outcome === "Included" ? "text-emerald-400" : "text-amber-300"}>{t.outcome}</span></p>)}</div></div>;
}
