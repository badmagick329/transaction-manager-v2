import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, LockKeyhole, SlidersHorizontal, Wallet } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { spendingControls, type SpendingControl } from "../app/recurring-payments";
import { monthRange, recurringBudget, recurringCalendar, shiftDate, type BillingEvent, type DashboardPayment, type RecurringOverview } from "../app/recurring-dashboard";
import { formatMoney } from "./formatters";

const controlLabels: Record<SpendingControl, string> = { unclassified: "Unclassified", fixed: "Fixed commitment", reducible: "Can reduce", cancellable: "Can cancel" };
const controlColors: Record<SpendingControl, string> = { unclassified: "bg-neutral-500", fixed: "bg-sky-400", reducible: "bg-amber-300", cancellable: "bg-emerald-400" };
const cadence = { weekly: "week", monthly: "month", quarterly: "3 months", semiannual: "6 months", annual: "year" };
const selectClass = "min-w-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:outline-2 focus:outline-sky-400";
const panelClass = "rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 sm:p-6";
const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function RecurringDashboard({ data, busy, onControl, onManage, onBilling }: {
  data: RecurringOverview; busy: boolean;
  onControl: (paymentId: number, control: SpendingControl) => Promise<void>;
  onManage: (paymentId: number) => void; onBilling: (payment: DashboardPayment) => void;
}) {
  const currencies = [...new Set(data.payments.filter(p => p.status === "active").map(p => p.currencyCode))].sort();
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];
  const today = new Date().toISOString().slice(0, 10);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [candidate, setCandidate] = useState("");
  const baseline = recurringBudget(data.payments, currency);
  const scenarioRows = baseline.rows.filter(p => p.control !== "fixed" && targets[p.id] !== undefined);
  const validTarget = (p: DashboardPayment) => /^\d+(?:\.\d{1,2})?$/.test(targets[p.id]) && Math.round(Number(targets[p.id]) * 100) <= p.currentMethod.amountMinor;
  const replacements = Object.fromEntries(scenarioRows.filter(validTarget).map(p => [p.id, Math.round(Number(targets[p.id]) * 100)]));
  const budget = recurringBudget(data.payments, currency, replacements);
  const invalidScenario = scenarioRows.some(p => !validTarget(p));
  const money = (value: number) => formatMoney(value, currency);
  const upcoming = recurringCalendar(data, today, shiftDate(today, 29), today, currency).filter(e => e.status === "expected");
  const pending = baseline.rows.filter(p => p.nextDate && p.nextDate < today);
  const needsAttention = baseline.rows.filter(p => p.priceChanged || p.needsReview || p.paymentMissing || p.coverageUnknown);
  const remainingCandidates = baseline.rows.filter(p => p.control !== "fixed" && targets[p.id] === undefined);
  const removeTarget = (id: number) => setTargets(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => Number(key) !== id)));

  if (!currencies.length) return <div className={panelClass}><h3 className="font-medium">Your recurring picture starts here</h3><p className="mt-2 text-sm text-neutral-400">Add an active recurring payment, or review your suggestions in Manage payments, to see the breakdown.</p></div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Your recurring picture</p><p className="mt-1 text-sm text-neutral-400">Expected costs across {baseline.rows.length} active payments · {dateLabel(today)}</p></div>
      {currencies.length > 1 && <label className="flex items-center gap-2 text-sm text-neutral-400">Currency<select aria-label="Dashboard currency" className={selectClass} value={currency} onChange={e => { setSelectedCurrency(e.target.value); setCandidate(""); }}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>}
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-sky-400/25 bg-sky-400/5 p-5"><Wallet size={18} className="mb-4 text-sky-300" aria-hidden /><p className="text-sm text-neutral-300">Expected monthly cost</p><p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{money(budget.monthly)}</p><p className="mt-2 text-xs text-neutral-400">{money(budget.annual)} per year at current rates</p></div>
      <div className={panelClass}><LockKeyhole size={18} className="mb-4 text-sky-300" aria-hidden /><p className="text-sm text-neutral-300">Fixed commitments</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(budget.byControl.fixed)}<span className="text-sm font-normal text-neutral-500"> /mo</span></p><p className="mt-2 text-xs text-neutral-400">Payments you have marked as fixed</p></div>
      <div className={panelClass}><SlidersHorizontal size={18} className="mb-4 text-emerald-300" aria-hidden /><p className="text-sm text-neutral-300">Potentially adjustable</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(budget.byControl.reducible + budget.byControl.cancellable)}<span className="text-sm font-normal text-neutral-500"> /mo</span></p><p className="mt-2 text-xs text-neutral-400">Can reduce or cancel · not all of it is savings</p></div>
    </div>

    {budget.byControl.unclassified > 0 && <p className="flex items-start gap-2 text-sm text-neutral-400"><CircleHelp size={16} className="mt-0.5 shrink-0" aria-hidden /><span>{money(budget.byControl.unclassified)}/month is still unclassified. Choose how much control you have over each payment below.</span></p>}

    <section className={panelClass} aria-labelledby="recurring-breakdown-title">
      <h3 id="recurring-breakdown-title" className="text-lg font-medium">Where your money goes</h3>
      <p className="mt-1 text-sm text-neutral-400">Largest monthly commitments first. Percentages are shares of your recurring total.</p>
      <div className="my-5 flex h-2.5 overflow-hidden rounded-full bg-neutral-800" aria-hidden>{spendingControls.map(control => <div key={control} className={controlColors[control]} style={{ width: `${budget.monthly ? budget.byControl[control] / budget.monthly * 100 : 0}%` }} />)}</div>
      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-400">{spendingControls.map(control => <span key={control} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${controlColors[control]}`} />{controlLabels[control]} · {money(budget.byControl[control])}</span>)}</div>
      <div className="divide-y divide-neutral-800">
        {budget.rows.map(p => {
          const share = budget.monthly ? p.monthlyEquivalentMinor / budget.monthly * 100 : 0;
          return <div key={p.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><button className="text-left font-medium text-neutral-100 hover:text-sky-300 hover:underline" onClick={() => onManage(p.id)}>{p.name}</button><p className="mt-1 text-xs text-neutral-400">{money(p.currentMethod.amountMinor)} every {cadence[p.currentMethod.frequency]} <button aria-label={`Update expected amount for ${p.name}`} className="ml-2 text-sky-300 hover:underline" onClick={() => onBilling(p)}>Update</button></p></div>
              <div className="text-right"><p className="font-medium tabular-nums">{money(p.monthlyEquivalentMinor)}<span className="text-xs font-normal text-neutral-500"> /mo</span></p><p className="mt-1 text-xs tabular-nums text-neutral-400">{share.toFixed(1)}%</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4"><div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-neutral-800" aria-hidden><div className={`h-full rounded-full ${controlColors[p.control]}`} style={{ width: `${share}%` }} /></div><select aria-label={`Spending control for ${p.name}`} className={`${selectClass} w-44`} disabled={busy} value={p.control} onChange={e => void onControl(p.id, e.target.value as SpendingControl)}>{spendingControls.map(c => <option key={c} value={c}>{controlLabels[c]}</option>)}</select></div>
          </div>;
        })}
      </div>
      <p className="mt-5 border-t border-neutral-800 pt-4 text-xs leading-relaxed text-neutral-500">Uses your saved expected prices, not the latest charges. Weekly costs use 52 payments per year; quarterly, six-monthly and annual bills are spread over their billing periods. One-off adjustments stay in actual spending history.</p>
    </section>

    <section className={panelClass} aria-labelledby="savings-title">
      <div className="flex items-start justify-between gap-3"><div><h3 id="savings-title" className="text-lg font-medium">What could you save?</h3><p className="mt-1 text-sm text-neutral-400">Try a cheaper bill or a cancellation. This is a scenario; it does not change your payments.</p></div><ArrowDownRight className="shrink-0 text-emerald-300" size={22} aria-hidden /></div>
      <div className="mt-5 flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm text-neutral-400">Choose a payment<select aria-label="Payment to try saving on" className={`${selectClass} mt-2 w-full`} value={remainingCandidates.some(p => String(p.id) === candidate) ? candidate : ""} onChange={e => setCandidate(e.target.value)}><option value="">Select a payment</option>{remainingCandidates.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.monthlyEquivalentMinor)}/mo</option>)}</select></label><Button variant="outline" disabled={!remainingCandidates.some(p => String(p.id) === candidate)} onClick={() => { const p = remainingCandidates.find(p => String(p.id) === candidate)!; setTargets(values => ({ ...values, [p.id]: (p.currentMethod.amountMinor / 100).toFixed(2) })); setCandidate(""); }}>Try a saving</Button></div>
      {!scenarioRows.length && <p className="mt-3 text-xs text-neutral-500">Fixed commitments are excluded. You can experiment with unclassified payments without changing their category.</p>}
      <div className="mt-4 space-y-3">{scenarioRows.map(p => <div key={p.id} className="rounded-xl border border-neutral-800 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{p.name}</p><button className="text-xs text-neutral-400 hover:text-white" aria-label={`Remove ${p.name} from scenario`} onClick={() => removeTarget(p.id)}>Remove</button></div><div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-xs text-neutral-400">New bill ({currency}) every {cadence[p.currentMethod.frequency]}<Input className="mt-1 w-36" aria-label={`Scenario amount for ${p.name}`} inputMode="decimal" value={targets[p.id]} onChange={e => setTargets(values => ({ ...values, [p.id]: e.target.value }))} aria-invalid={!validTarget(p)} /></label><Button size="sm" variant="outline" onClick={() => setTargets(values => ({ ...values, [p.id]: "0" }))}>Try cancelling</Button><span className="pb-1 text-xs text-neutral-500">Currently {money(p.currentMethod.amountMinor)}</span></div>{!validTarget(p) && <p role="alert" className="mt-2 text-xs text-amber-300">Enter an amount from 0 to {(p.currentMethod.amountMinor / 100).toFixed(2)}, with up to two decimal places.</p>}</div>)}</div>
      <div className="mt-5 grid gap-3 rounded-xl bg-emerald-400/5 p-4 sm:grid-cols-3" aria-live="polite"><div><p className="text-xs text-neutral-400">New monthly total</p><p className="mt-1 text-xl font-medium tabular-nums">{invalidScenario ? "—" : money(budget.scenarioMonthly)}</p></div><div><p className="text-xs text-neutral-400">Monthly saving</p><p className="mt-1 text-xl font-medium tabular-nums text-emerald-300">{invalidScenario ? "—" : money(budget.monthlySaving)}</p></div><div><p className="text-xs text-neutral-400">Annual saving</p><p className="mt-1 text-xl font-medium tabular-nums text-emerald-300">{invalidScenario ? "—" : money(budget.annualSaving)}</p></div></div>
      {scenarioRows.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-neutral-500">Assumes the new price continues for a full year; cancellation terms are not included.</p><Button size="sm" variant="ghost" onClick={() => setTargets({})}>Reset scenario</Button></div>}
    </section>

    <section className={panelClass} aria-labelledby="upcoming-title">
      <div className="flex items-start justify-between gap-3"><div><h3 id="upcoming-title" className="text-lg font-medium">Coming up</h3><p className="mt-1 text-sm text-neutral-400">{money(upcoming.reduce((sum, e) => sum + e.amountMinor, 0))} expected over the next 30 days · {upcoming.length} payments</p></div><CalendarDays className="text-sky-300" size={21} aria-hidden /></div>
      <p className="mt-2 text-xs text-neutral-500">Full bills on their scheduled dates, separate from monthly equivalents. Dates are estimates.</p>
      {pending.length > 0 && <details className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3"><summary className="cursor-pointer text-sm text-amber-200">{pending.length} earlier expected payments still unconfirmed</summary><p className="mt-2 text-xs text-neutral-400">Future dates project the saved schedule forward; they do not assume these earlier bills were paid.</p>{pending.map(p => <button key={p.id} onClick={() => onManage(p.id)} className="mt-2 block text-left text-sm text-neutral-300 hover:text-sky-300">{p.name} · {dateLabel(p.nextDate!)} · {p.paymentMissing ? "Not found in covered statements" : p.coverageUnknown ? "Statement coverage needed" : "Awaiting confirmation"}</button>)}</details>}
      <PaymentCalendar data={data} currency={currency} today={today} upcoming={upcoming} onManage={onManage} />
    </section>

    {needsAttention.length > 0 && <details className={panelClass}><summary className="cursor-pointer text-sm font-medium">Review your assumptions · {needsAttention.length} payments need a look</summary><p className="mt-2 text-xs text-neutral-400">Check saved expectations when a price changes. Updating a bill does not require a new statement.</p><div className="mt-3 space-y-2">{needsAttention.map(p => <button key={p.id} className="flex w-full items-center justify-between gap-3 rounded-lg p-2 text-left text-sm hover:bg-neutral-800" onClick={() => onManage(p.id)}><span>{p.name}<span className="ml-2 text-xs text-neutral-500">{p.priceChanged ? "Amount differs" : p.needsReview ? "Matching needs review" : p.paymentMissing ? "Payment not found" : "Incomplete statements"}</span></span><ArrowUpRight size={16} aria-hidden /></button>)}</div></details>}
  </div>;
}

const statusLabels = { expected: "Expected", recorded: "Recorded", unconfirmed: "Unconfirmed", missing: "Not found" };
const statusColors = { expected: "text-sky-300", recorded: "text-emerald-300", unconfirmed: "text-amber-200", missing: "text-amber-300" };

function PaymentCalendar({ data, currency, today, upcoming, onManage }: { data: RecurringOverview; currency: string; today: string; upcoming: BillingEvent[]; onManage: (id: number) => void }) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const range = monthRange(month);
  const events = recurringCalendar(data, range.start, range.end, today, currency);
  const gridStart = shiftDate(range.start, -(new Date(`${range.start}T00:00:00Z`).getUTCDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, i) => shiftDate(gridStart, i));
  const shown = view === "list" ? upcoming : selectedDay ? events.filter(e => e.date === selectedDay) : events;
  const move = (delta: number) => { const date = new Date(`${range.start}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(date.toISOString().slice(0, 7)); setSelectedDay(null); };
  return <div className="mt-5">
    <div className="flex gap-1" aria-label="Payment date view">{(["list", "calendar"] as const).map(v => <Button key={v} size="sm" variant={v === view ? "secondary" : "ghost"} aria-pressed={v === view} onClick={() => setView(v)}>{v === "list" ? "Next 30 days" : "Calendar"}</Button>)}</div>
    {view === "calendar" && <>
      <div className="my-4 flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{new Date(`${range.start}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</p><div className="flex items-center gap-1"><Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={16} /></Button><Button size="sm" variant="ghost" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDay(null); }}>This month</Button><Button size="sm" variant="ghost" aria-label="Next month" onClick={() => move(1)}><ChevronRight size={16} /></Button></div></div>
      <p className="mb-3 text-xs text-neutral-400">{formatMoney(events.reduce((sum, e) => sum + e.amountMinor, 0), currency)} scheduled this month · expected amounts, including recorded bills</p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-neutral-500">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day} className="py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{days.map(date => {
        const dayEvents = events.filter(e => e.date === date);
        const inMonth = date.startsWith(month);
        return <button key={date} disabled={!inMonth} aria-label={`${dateLabel(date)}: ${dayEvents.length} payments${dayEvents.map(e => `, ${e.name}, ${formatMoney(e.amountMinor, currency)}, ${statusLabels[e.status]}`).join("")}`} aria-pressed={selectedDay === date} onClick={() => setSelectedDay(selectedDay === date ? null : date)} className={`min-h-16 min-w-0 rounded-lg border p-1.5 text-left sm:min-h-20 sm:p-2 ${!inMonth ? "border-transparent opacity-20" : selectedDay === date ? "border-sky-400 bg-sky-400/10" : "border-neutral-800 hover:border-neutral-600"}`}><span className={`text-xs ${date === today ? "rounded bg-sky-300 px-1 text-neutral-950" : "text-neutral-400"}`}>{Number(date.slice(-2))}</span>{dayEvents.length > 0 && <><span className={`mt-2 block truncate text-[10px] font-medium sm:text-xs ${statusColors[dayEvents[0].status]}`}>{formatMoney(dayEvents.reduce((s, e) => s + e.amountMinor, 0), currency)}</span><span className="mt-1 hidden truncate text-[10px] text-neutral-500 sm:block">{dayEvents.length === 1 ? dayEvents[0].name : `${dayEvents.length} payments`}</span></>}</button>;
      })}</div>
      <div className="my-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-neutral-400">{selectedDay ? dateLabel(selectedDay) : "This month's payments"}</p>{selectedDay && <button className="text-xs text-sky-300" onClick={() => setSelectedDay(null)}>Show whole month</button>}</div>
    </>}
    <div className="mt-3 divide-y divide-neutral-800">{!shown.length ? <p className="py-4 text-sm text-neutral-500">No scheduled payments {view === "list" ? "in the next 30 days" : "in this selection"}.</p> : shown.map(e => <button key={`${e.paymentId}:${e.date}`} onClick={() => onManage(e.paymentId)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:text-sky-200"><div className="min-w-0"><p className="text-sm">{e.name}</p><p className="mt-1 text-xs text-neutral-500">{dateLabel(e.date)} · <span className={statusColors[e.status]}>{statusLabels[e.status]}</span>{e.actualMinor !== null && <span> · {formatMoney(e.actualMinor, currency)} recorded</span>}</p></div><p className="shrink-0 text-sm tabular-nums">{formatMoney(e.amountMinor, currency)}<span className="ml-1 text-xs text-neutral-500">expected</span></p></button>)}</div>
  </div>;
}
