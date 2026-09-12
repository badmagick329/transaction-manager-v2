import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EditorDialog } from "../components/ui/editor-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import type { ReviewAction } from "../app/contracts/recurring-review";
import type { ReviewDecision, ReviewPreview, ReviewReport } from "../app/recurring-review";
import { frequencies, frequencyLabels, type RecurringPayment, type RecurringTransaction } from "../app/recurring-payments";
import type { Account } from "./types";
import { formatMoney, titleCase } from "./formatters";

type Queue = { evidenceVersion: string; latestReport: ReviewReport | null; scope: { transactionCount: number; withoutDecisionCount: number; accounts: { id: number; name: string; transactionCount: number; firstDate: string | null; lastDate: string | null }[] }; decisions: ReviewDecision[]; payments: RecurringPayment[]; transactions: RecurringTransaction[] };
type Selection = { decision: ReviewDecision; action: ReviewAction };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to load agent reviews.");
  return result;
}

// Keep review approval separate from ordinary editing so the accepted proposal and its audit stay together.
export function RecurringAgentReview({ accounts, refreshKey, onChanged }: { accounts: Account[]; refreshKey: unknown; onChanged: () => Promise<void> }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<{ preview: ReviewPreview; evidenceVersion: string; previewToken: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() { setQueue(await request("/api/agent/recurring-payments")); }
  async function refresh() {
    setBusy(true); setError("");
    try { await Promise.all([load(), onChanged()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to refresh recurring payments."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    request("/api/agent/recurring-payments").then(value => { if (!cancelled) setQueue(value); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  async function resolve(operation: "dismiss" | "undo", decision: ReviewDecision) {
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`/api/recurring-payments/review/${operation}`, { decisionId: decision.id });
      await load(); await onChanged();
      setNotice(operation === "undo" ? "Change undone." : "Proposal dismissed. The recurring payment was not changed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update review."); }
    finally { setBusy(false); }
  }
  async function acceptOrPreview() {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    const key = JSON.stringify(selected.action);
    const body = { decisionId: selected.decision.id, action: selected.action };
    try {
      if (!preview || preview.key !== key) {
        const value = await request("/api/recurring-payments/review/preview", body);
        setPreview({ ...value, key });
      } else {
        await request("/api/recurring-payments/review/approve", { ...body, evidenceVersion: preview.evidenceVersion, previewToken: preview.previewToken });
        setSelected(null); setPreview(null); await load(); await onChanged(); setNotice("Proposal accepted.");
      }
    } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "Unable to approve proposal."); }
    finally { setBusy(false); }
  }
  const pending = queue?.decisions.filter(d => d.status === "pending" || d.status === "outdated") ?? [];
  const history = queue?.decisions.filter(d => d.status !== "pending" && d.status !== "outdated") ?? [];
  function open(decision: ReviewDecision) {
    setSelected({ decision, action: structuredClone(decision.request.action) }); setPreview(null); setError(""); setNotice("");
  }
  return <section aria-label="Agent reviews" className="space-y-3 rounded-xl border border-neutral-800 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Agent reviews{queue ? ` (${pending.length})` : ""}</h3><Button variant="ghost" disabled={busy} onClick={() => void refresh()}>Refresh</Button></div>
    <p className="text-sm text-neutral-400">Clear new payments can be tracked automatically. Changes to existing payments need your approval.</p>
    {queue && (queue.latestReport ? <details className="text-sm"><summary className="cursor-pointer">Last agent inspection: {queue.latestReport.inspectedTransactionIds.length} of {queue.latestReport.eligibleCount} expenses � {new Date(queue.latestReport.createdAt).toLocaleString()}</summary>
      {queue.latestReport.evidenceVersion !== queue.evidenceVersion && <p className="text-amber-300">Records changed since this report.</p>}
      <p>{queue.latestReport.summary}</p><p className="text-neutral-400">Inspection scope is reported by the agent.</p>
      {queue.latestReport.accounts.map(a => <p key={a.id}>{a.name}: {a.inspectedCount} / {a.eligibleCount} inspected � {a.firstDate?.slice(0, 10) ?? "None"} � {a.lastDate?.slice(0, 10) ?? "None"}</p>)}
      {queue.latestReport.unresolved.map((u, i) => <div key={i} className="mt-2 text-amber-300"><p>{u.reason}</p>{u.transactionIds.map(id => { const t = queue.transactions.find(t => t.id === id); return <p key={id}>{t ? `${t.transactionDate.slice(0, 10)} � ${t.description}` : `Transaction ${id} no longer eligible`}</p>; })}</div>)}
    </details> : <p className="text-sm text-neutral-400">No agent inspection report recorded yet.</p>)}
    {queue && <details className="text-sm text-neutral-400"><summary className="cursor-pointer">Available history: {queue.scope.transactionCount} expenses across {queue.scope.accounts.length} accounts</summary>
      <p>Available to the agent; this does not mean every transaction has been reviewed. {queue.scope.withoutDecisionCount} expenses have no recorded decision.</p>
      {queue.scope.accounts.map(a => <p key={a.id}>{a.name}: {a.transactionCount} expenses � {a.firstDate?.slice(0, 10) ?? "No history"} � {a.lastDate?.slice(0, 10) ?? "No history"}</p>)}
    </details>}
    {error && !selected && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {!queue ? <p className="text-sm text-neutral-400">Loading agent reviews…</p> : pending.length === 0 ? <p className="text-sm text-neutral-400">No proposals waiting for review.</p> : pending.map(d => <article key={d.id} className="space-y-2 rounded-lg border border-neutral-700 p-3">
      <h4 className="font-medium">{d.name} · {actionName(d.request.action)}</h4>
      <p className="whitespace-pre-wrap text-sm">{d.request.reasoning}</p>
      {d.status === "outdated" && <p className="text-sm text-amber-300">Records changed since this proposal. Preview the current effect before accepting.</p>}
      <Evidence decision={d} accounts={accounts} />
      <details><summary className="cursor-pointer text-sm text-neutral-400">Proposed setup and omitted charges</summary><Preview value={d.preview} accounts={accounts} /></details>
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => open(d)}>Review / edit</Button><Button variant="ghost" disabled={busy} onClick={() => void resolve("dismiss", d)}>Dismiss</Button></div>
    </article>)}
    <details><summary className="cursor-pointer text-sm text-neutral-400">Change history ({history.length})</summary><div className="mt-3 space-y-3">{history.map(d => <article key={d.id} className="space-y-2 rounded-lg border border-neutral-800 p-3 text-sm">
      <p>{d.name} · {titleCase(d.status)}{d.appliedBy ? ` · ${d.appliedBy === "agent" ? "Automatically applied" : "Approved by you"}` : ""}</p>
      <p className="text-neutral-400">{new Date(d.resolvedAt ?? d.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap">{d.request.reasoning}</p>
      <Evidence decision={d} accounts={accounts} />
      <details><summary className="cursor-pointer text-neutral-400">Recorded changes</summary><Preview value={d.preview} accounts={accounts} /></details>
      {d.status === "applied" && <Button variant="outline" disabled={busy} onClick={() => void resolve("undo", d)}>Undo change</Button>}
    </article>)}</div></details>
    {selected && <EditorDialog title={`Review ${selected.decision.name}`} busy={busy} onClose={() => { setSelected(null); setError(""); }}><form className="space-y-4" onSubmit={e => { e.preventDefault(); void acceptOrPreview(); }}>
      <p className="whitespace-pre-wrap text-sm">{selected.decision.request.reasoning}</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <fieldset disabled={busy}><ActionEditor action={selected.action} accounts={accounts} payments={queue?.payments ?? []} transactions={queue?.transactions ?? []} onChange={action => { setSelected({ ...selected, action }); setPreview(null); }} /></fieldset>
      <Evidence decision={selected.decision} accounts={accounts} />
      {preview && <Preview value={preview.preview} accounts={accounts} />}
      <div className="flex gap-2"><Button disabled={busy}>{busy ? "Working…" : preview ? "Accept proposal" : "Preview changes"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setSelected(null); setError(""); }}>Cancel</Button></div>
    </form></EditorDialog>}
  </section>;
}

function actionName(action: ReviewAction) {
  return ({ create: "Track new payment", update: "Update payment and history", method: "Update billing or matching", link: "Attach transaction" })[action.type];
}
function Evidence({ decision, accounts }: { decision: ReviewDecision; accounts: Account[] }) {
  return <details className="text-sm"><summary className="cursor-pointer text-neutral-400">Supporting transactions ({decision.evidence.length})</summary><div className="mt-2 max-h-52 space-y-1 overflow-auto">{decision.evidence.map(t => <p key={t.id}>{t.transactionDate.slice(0, 10)} · {t.description} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)}</p>)}</div></details>;
}
function Preview({ value, accounts }: { value: ReviewPreview; accounts: Account[] }) {
  const describe = (key: string, item: unknown) => key === "accountId" ? accounts.find(a => a.id === item)?.name ?? String(item) : key === "amountMinor" && typeof item === "number" ? formatMoney(item, value.after.currencyCode) : String(item ?? "Inherit");
  const labels: Record<string, string> = { name: "Name", kind: "Kind", accountId: "Account", currencyCode: "Currency", description: "Description", matchMode: "Matching", amountMinor: "Expected amount", frequency: "Frequency", anchorDate: "Billing date", status: "Status" };
  return <div className="space-y-3 rounded-lg border border-neutral-700 p-3 text-sm">
    <table className="w-full text-left"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{Object.keys(labels).filter(k => !value.before || value.before[k] !== value.after[k]).map(k => <tr key={k}><td className="py-1 pr-3">{labels[k]}</td><td className="pr-3">{value.before ? describe(k, value.before[k]) : "Not tracked"}</td><td>{describe(k, value.after[k])}</td></tr>)}</tbody></table>
    {JSON.stringify(value.methodsBefore) !== JSON.stringify(value.methodsAfter) && <div className="grid gap-3 sm:grid-cols-2">{[["Billing before", value.methodsBefore], ["Billing after", value.methodsAfter]].map(([title, methods]) => <div key={title as string}><p className="font-medium">{title as string}</p>{(methods as ReviewPreview["methodsBefore"]).length === 0 ? <p>Original billing settings</p> : (methods as ReviewPreview["methodsBefore"]).map(m => <p key={m.effectiveDate} className="mt-1">From {m.effectiveDate} · {describe("accountId", m.accountId)} · {m.description} · {m.matchMode === "contains" ? "Contains" : m.matchMode === "exact" ? "Exact" : "Starts with"} · {m.amountMinor === null ? "Inherit amount" : describe("amountMinor", m.amountMinor)} · {m.frequency ? frequencyLabels[m.frequency] : "Inherit frequency"} · {m.anchorDate ?? "Inherit billing date"}</p>)}</div>)}</div>}
    {value.reassignedFrom !== null && <p className="text-amber-300">This transaction will move from {value.reassignedFromName}.</p>}
    {(value.relatedUnmatched?.length ?? 0) > 0 && <details className="text-amber-300"><summary>Possibly related charges left out ({value.relatedUnmatched!.length})</summary><p>Similar description text; these may be separate services. They are not attached.</p>{value.relatedUnmatched!.map(t => <p key={t.id}>{t.transactionDate.slice(0, 10)} � {accounts.find(a => a.id === t.accountId)?.name} � {t.description} � {formatMoney(Math.abs(t.amountMinor), t.currencyCode)}</p>)}</details>}
    <p>Next expected: {value.matching.nextDate ?? "Schedule paused"}</p>
    <div className="max-h-60 space-y-2 overflow-auto">{value.matching.rows.length === 0 ? <p>No matching transactions.</p> : value.matching.rows.map(t => <p key={t.id}>{t.transactionDate.slice(0, 10)} · {t.description} · {formatMoney(Math.abs(t.amountMinor), t.currencyCode)} · <span className={t.outcome === "Included" ? "text-emerald-400" : "text-amber-300"}>{t.outcome}</span></p>)}</div>
  </div>;
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm"><span>{label}</span><Select value={value || "inherit"} onValueChange={v => onChange(v === "inherit" ? "" : v)}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(([id, name]) => <SelectItem key={id} value={id || "inherit"}>{name}</SelectItem>)}</SelectContent></Select></label>;
}
function ActionEditor({ action, accounts, payments, transactions, onChange }: { action: ReviewAction; accounts: Account[]; payments: RecurringPayment[]; transactions: RecurringTransaction[]; onChange: (action: ReviewAction) => void }) {
  if (action.type === "link") {
    const payment = payments.find(p => p.id === action.paymentId);
    return <div className="space-y-2"><p className="text-sm">Attach an eligible expense to {payment?.name ?? "the selected payment"}.</p><Choice label="Transaction" value={String(action.transactionId)} options={transactions.filter(t => t.currencyCode === payment?.currencyCode).map(t => [String(t.id), `${t.transactionDate.slice(0, 10)} · ${t.description} · ${formatMoney(Math.abs(t.amountMinor), t.currencyCode)} · ${accounts.find(a => a.id === t.accountId)?.name}`])} onChange={id => onChange({ ...action, transactionId: Number(id) })} /></div>;
  }
  const history = (action.type === "create" || action.type === "update") ? <div className="space-y-3 sm:col-span-2">
    {(action.methods ?? []).map((m, index) => <fieldset key={index} className="rounded border border-neutral-700 p-3"><legend>Billing change {index + 1}</legend><ActionEditor action={{ type: "method", input: { ...m, paymentId: -1 } }} accounts={accounts} payments={payments} transactions={transactions} onChange={edited => {
      if (edited.type !== "method") return;
      const { paymentId, ...method } = edited.input;
      onChange({ ...action, methods: action.methods!.map((v, i) => i === index ? method : v) });
    }} /><Button type="button" variant="ghost" onClick={() => onChange({ ...action, methods: action.methods!.filter((_, i) => i !== index) })}>Remove billing change</Button></fieldset>)}
    {(action.transactionIds ?? []).length > 0 && <details><summary>Explicit history ({action.transactionIds!.length})</summary>{action.transactionIds!.map(id => { const t = transactions.find(t => t.id === id); return <p key={id}>{t?.transactionDate.slice(0, 10)} � {t?.description} � {accounts.find(a => a.id === t?.accountId)?.name} <Button type="button" variant="ghost" onClick={() => onChange({ ...action, transactionIds: action.transactionIds!.filter(v => v !== id) })}>Remove</Button></p>; })}</details>}
  </div> : null;
  const input = action.input;
  const change = (patch: Record<string, unknown>) => onChange({ ...action, input: { ...input, ...patch } } as ReviewAction);
  const method = action.type === "method";
  const currency = action.type === "method" ? payments.find(p => p.id === action.input.paymentId)?.currencyCode ?? "GBP" : action.input.currencyCode;
  return <div className="grid gap-3 sm:grid-cols-2">{history}
    {action.type !== "method" && <><label className="text-sm">Name<Input required maxLength={200} value={action.input.name} onChange={e => change({ name: e.target.value })} /></label><Choice label="Kind" value={action.input.kind} options={["subscription", "bill", "instalment"].map(v => [v, titleCase(v)])} onChange={kind => change({ kind })} /></>}
    {action.type === "method" && <label className="text-sm">Effective date<Input type="date" required value={action.input.effectiveDate} onChange={e => change({ effectiveDate: e.target.value })} /></label>}
    {action.type !== "update" && <>
      {method ? <Choice label="Account" value={String(input.accountId)} options={accounts.map(a => [String(a.id), a.name])} onChange={id => change({ accountId: Number(id) })} /> : <p className="self-center text-sm">Account: {accounts.find(a => a.id === input.accountId)?.name} · {currency}</p>}
      <label className="text-sm">Expected amount ({currency}){method && " · blank inherits"}<Input type="number" min="0.01" step="0.01" required={!method} value={input.amountMinor === null ? "" : input.amountMinor / 100} onChange={e => change({ amountMinor: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} /></label>
      <Choice label="Frequency" value={input.frequency ?? ""} options={[...(method ? [["", "Inherit preceding frequency"] as [string, string]] : []), ...frequencies.map(v => [v, frequencyLabels[v]] as [string, string])]} onChange={frequency => change({ frequency: frequency || null })} />
      <label className="text-sm">Billing date{method && " · blank inherits"}<Input type="date" required={!method} value={input.anchorDate ?? ""} onChange={e => change({ anchorDate: e.target.value || null })} /></label>
    </>}
    <label className="text-sm">Statement description<Input required maxLength={500} value={input.description} onChange={e => change({ description: e.target.value })} /></label>
    <Choice label="Matching" value={input.matchMode} options={[["exact", "Exact description"], ["starts_with", "Starts with"], ["contains", "Contains"]]} onChange={matchMode => change({ matchMode })} />
    {action.type === "update" && <Choice label="Status" value={action.input.status} options={["active", "paused", "cancelled", "dismissed"].map(v => [v, titleCase(v)])} onChange={status => change({ status })} />}
  </div>;
}
