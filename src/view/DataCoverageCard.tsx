import { useEffect, useState } from "react";
import { Checkbox } from "../components/ui/checkbox";
import type { DataCoverage, DataCoverageAccount } from "./types";

type CoverageDraft = { required: boolean; ended: boolean; activeThrough: string; startDate: string; endDate: string };

function shortDate(value: string | null) {
  return value ? value.slice(0, 10) : "Unknown";
}

function latestCoveredDate(account: DataCoverageAccount) {
  return account.coverageIntervals.at(-1)?.endDate ?? null;
}

export function DataCoverageCard({
  coverage,
  savingAccountId,
  onSave,
}: {
  coverage: DataCoverage | null;
  savingAccountId: number | null;
  onSave: (accountId: number, draft: CoverageDraft) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, CoverageDraft>>({});

  useEffect(() => {
    if (!coverage) return;
    setDrafts(Object.fromEntries(coverage.accounts.map(account => [account.accountId, {
      required: account.required,
      ended: account.activeThrough !== null,
      activeThrough: account.activeThrough ?? "",
      startDate: account.manualBaseline?.startDate ?? account.recommendedBaseline?.startDate ?? "",
      endDate: account.manualBaseline?.endDate ?? account.recommendedBaseline?.endDate ?? "",
    }])));
  }, [coverage]);

  if (!coverage) return <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"><p className="text-sm text-neutral-400">Loading data coverage…</p></section>;

  const providers = [...new Map(coverage.accounts.map(account => [account.sourceId, account.sourceName])).entries()];
  const latestCommon = coverage.commonIntervals.at(-1) ?? null;
  return (
    <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Data coverage</p>
      {latestCommon ? (
        <div className="mt-3">
          <p className="text-lg font-semibold text-emerald-200">Complete through {latestCommon.endDate}</p>
          <p className="mt-1 text-sm text-neutral-400">Latest shared continuous interval: {latestCommon.startDate} to {latestCommon.endDate}</p>
        </div>
      ) : (
        <div className="mt-3">
          <p className="font-medium text-amber-200">Complete coverage is not established yet.</p>
          <p className="mt-1 text-sm text-neutral-400">Add a verified baseline to required accounts with unknown coverage, or exclude accounts that should not count.</p>
        </div>
      )}
      <div className="mt-5 space-y-3">
        {providers.map(([sourceId, sourceName]) => {
          const providerAccounts = coverage.accounts.filter(account => account.sourceId === sourceId);
          const blockingCount = providerAccounts.filter(account => coverage.blockingAccountIds.includes(account.accountId)).length;
          const requiredProviderAccounts = providerAccounts.filter(account => account.required);
          const activeProviderAccounts = requiredProviderAccounts.filter(account => account.activeThrough === null);
          const providerCoveredDates = activeProviderAccounts.map(latestCoveredDate).filter((date): date is string => date !== null);
          const providerCoveredThrough = activeProviderAccounts.length > 0 && providerCoveredDates.length === activeProviderAccounts.length
            ? providerCoveredDates.sort()[0]
            : null;
          const providerEndedThrough = requiredProviderAccounts.length > 0 && activeProviderAccounts.length === 0
            ? requiredProviderAccounts.map(account => account.activeThrough).filter((date): date is string => date !== null).sort().at(-1) ?? null
            : null;
          return (
            <details key={sourceId} className="rounded-xl border border-neutral-800 bg-neutral-950/40" open={blockingCount > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-neutral-200">
                <span>{sourceName} <span className={`ml-2 text-xs ${blockingCount ? "text-amber-300" : "text-neutral-500"}`}>{blockingCount ? `${blockingCount} blocking` : `${providerAccounts.length} account${providerAccounts.length === 1 ? "" : "s"}`}</span></span>
                <span className={providerCoveredThrough || providerEndedThrough ? "text-xs text-neutral-400" : "text-xs text-amber-300"}>{requiredProviderAccounts.length === 0 ? "Not required" : providerEndedThrough ? `Ended ${providerEndedThrough}` : providerCoveredThrough ? `Verified through ${providerCoveredThrough}` : "Coverage unknown"}</span>
              </summary>
              <div className="divide-y divide-neutral-800 border-t border-neutral-800">
                {providerAccounts.map(account => {
                  const draft = drafts[account.accountId] ?? { required: account.required, ended: account.activeThrough !== null, activeThrough: account.activeThrough ?? "", startDate: "", endDate: "" };
                  const blocking = coverage.blockingAccountIds.includes(account.accountId);
                  const baselineIncomplete = Boolean(draft.startDate) !== Boolean(draft.endDate);
                  const endDateIncomplete = draft.ended && !draft.activeThrough;
                  return (
                    <div key={account.accountId} className="p-4">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                          <p className="font-medium text-neutral-100">{account.accountName} <span className="text-xs font-normal text-neutral-500">{account.currencyCode}</span></p>
                          <p className="mt-1 text-xs text-neutral-400">Verified through {shortDate(latestCoveredDate(account))}{account.activeThrough ? ` · No longer active after ${account.activeThrough}` : ""} · Latest activity {shortDate(account.latestTransactionDate)} · Last import {shortDate(account.lastImportAt)}</p>
                          {account.coverageIntervals.length > 1 ? <p className="mt-1 text-xs text-amber-300">{account.coverageIntervals.length - 1} known coverage gap{account.coverageIntervals.length === 2 ? "" : "s"}</p> : null}
                          {blocking ? <p className="mt-1 text-xs text-amber-300">This required account is blocking complete coverage.</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-2 text-sm text-neutral-300"><Checkbox checked={draft.required} onCheckedChange={checked => setDrafts(current => ({ ...current, [account.accountId]: { ...draft, required: checked === true } }))} />Required</label>
                          <label className="flex items-center gap-2 text-sm text-neutral-300"><Checkbox checked={draft.ended} onCheckedChange={checked => setDrafts(current => ({ ...current, [account.accountId]: { ...draft, ended: checked === true, activeThrough: checked === true ? draft.activeThrough || latestCoveredDate(account) || "" : "" } }))} />No longer active</label>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        {draft.ended ? <label className="text-xs text-neutral-400">Active through<input className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" type="date" value={draft.activeThrough} onChange={event => setDrafts(current => ({ ...current, [account.accountId]: { ...draft, activeThrough: event.target.value } }))} /></label> : null}
                        <label className="text-xs text-neutral-400">Manual baseline from<input className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" type="date" value={draft.startDate} onChange={event => setDrafts(current => ({ ...current, [account.accountId]: { ...draft, startDate: event.target.value } }))} /></label>
                        <label className="text-xs text-neutral-400">Through<input className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100" type="date" value={draft.endDate} onChange={event => setDrafts(current => ({ ...current, [account.accountId]: { ...draft, endDate: event.target.value } }))} /></label>
                        <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={savingAccountId === account.accountId || baselineIncomplete || endDateIncomplete || (draft.startDate !== "" && draft.startDate > draft.endDate)} onClick={() => onSave(account.accountId, { ...draft, activeThrough: draft.ended ? draft.activeThrough : "" })}>{savingAccountId === account.accountId ? "Saving…" : "Save"}</button>
                        {account.manualBaseline ? <button className="px-2 py-1.5 text-sm text-neutral-500 hover:text-neutral-200" disabled={savingAccountId === account.accountId} onClick={() => onSave(account.accountId, { ...draft, startDate: "", endDate: "" })}>Clear baseline</button> : null}
                      </div>
                      {!account.manualBaseline && account.recommendedBaseline ? <p className="mt-2 text-xs text-neutral-500">Prefilled from the provider’s detected transaction range; click Save to confirm it as the initial baseline.</p> : null}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
