import { useEffect, useState } from "react";
import "../index.css";

type LatestImport = {
  fileName: string;
  status: string;
  recordCount: number;
  duplicateRecordCount: number;
  attemptCount: number;
  errorMessage: string | null;
  importedAt: string | null;
} | null;

type Transaction = {
  id: number;
  accountName: string;
  transactionDate: string;
  description: string;
  amountMinor: number;
  currencyCode: string;
  transactionType: string;
  economicType: string;
};

type EconomicType = "expense" | "income" | "transfer" | "unclassified";
type EconomicDirection = "inflow" | "outflow";
type ClassificationMatchMode = "exact" | "starts_with" | "contains";

type ClassificationReviewGroup = {
  sourceId: number;
  sourceName: string;
  description: string;
  direction: EconomicDirection;
  transactionCount: number;
  latestTransactionDate: string;
  samples: Array<{ id: number; transactionDate: string; amountMinor: number; currencyCode: string }>;
};

type ClassificationRule = {
  id: number;
  sourceId: number;
  sourceName: string;
  normalizedDescription: string;
  matchMode: ClassificationMatchMode;
  direction: EconomicDirection;
  economicType: EconomicType;
};

const economicTypeOptions: EconomicType[] = ["expense", "income", "transfer", "unclassified"];
const matchModeOptions: ClassificationMatchMode[] = ["exact", "starts_with", "contains"];
const transactionPageSize = 100;

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export function App() {
  const [latestImport, setLatestImport] = useState<LatestImport>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reviewGroups, setReviewGroups] = useState<ClassificationReviewGroup[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { description: string; matchMode: ClassificationMatchMode }>>({});
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const remainingClassificationCount = reviewGroups.reduce((total, group) => total + group.transactionCount, 0);

  const loadClassifications = async () => {
    const [reviewResponse, rulesResponse] = await Promise.all([
      fetch("/api/classification/review"),
      fetch("/api/classification/rules"),
    ]);
    if (!reviewResponse.ok || !rulesResponse.ok) throw new Error("Unable to load classification data.");
    setReviewGroups(await reviewResponse.json());
    setRules(await rulesResponse.json());
  };

  const loadTransactions = async (offset = 0, append = false) => {
    setLoadingTransactions(true);
    try {
      const response = await fetch(`/api/transactions?limit=${transactionPageSize}&offset=${offset}`);
      if (!response.ok) throw new Error("Unable to load transactions.");
      const page: Transaction[] = await response.json();
      setTransactions(current => append ? [...current, ...page] : page);
      setHasMoreTransactions(page.length === transactionPageSize);
    } finally {
      setLoadingTransactions(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [importResponse] = await Promise.all([
          fetch("/api/imports/latest"),
          loadTransactions(),
          loadClassifications(),
        ]);
        if (!importResponse.ok) throw new Error("Unable to load the finance workspace.");
        setLatestImport(await importResponse.json());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load the finance workspace.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const saveRule = async (input: { sourceId: number; description: string; direction: EconomicDirection; matchMode: ClassificationMatchMode; economicType: EconomicType }, key: string) => {
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/classification/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to save classification rule.");
      await Promise.all([
        loadClassifications(),
        loadTransactions(),
      ]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save classification rule.");
    } finally {
      setSavingKey(null);
    }
  };

  const deleteRule = async (rule: ClassificationRule) => {
    const key = `delete-${rule.id}`;
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/classification/rules/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to delete classification rule.");
      await Promise.all([
        loadClassifications(),
        loadTransactions(),
      ]);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete classification rule.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8">
        <header className="border-b border-neutral-800 pb-6">
          <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Transaction Manager</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bank import workspace</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Put completed parser JSON files into <code className="rounded bg-neutral-800 px-1.5 py-0.5">imports/incoming</code>.
          </p>
        </header>

        {error ? <p className="mt-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{error}</p> : null}

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Latest import</p>
          {loading ? <p className="mt-3 text-sm text-neutral-400">Loading import status…</p> : null}
          {!loading && !latestImport ? (
            <p className="mt-3 text-sm text-neutral-400">No files imported yet. Add a completed JSON file to the incoming folder.</p>
          ) : null}
          {!loading && latestImport ? (
            <div className="mt-3">
              <p className="font-medium text-neutral-100">{latestImport.fileName}</p>
              <p className="mt-1 text-sm text-neutral-400">
                {titleCase(latestImport.status)} · {latestImport.recordCount} record{latestImport.recordCount === 1 ? "" : "s"}
                {latestImport.duplicateRecordCount ? ` · ${latestImport.duplicateRecordCount} already seen` : ""}
                {latestImport.attemptCount > 1 ? ` · attempt ${latestImport.attemptCount}` : ""}
              </p>
              {latestImport.errorMessage ? <p className="mt-3 text-sm text-red-300">{latestImport.errorMessage}</p> : null}
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Classification review</p>
            <h2 className="mt-2 text-xl font-semibold">Recurring descriptions without a rule</h2>
            <p className="mt-2 text-sm text-neutral-400">
              {remainingClassificationCount} transaction{remainingClassificationCount === 1 ? "" : "s"} across {reviewGroups.length} description{reviewGroups.length === 1 ? "" : "s"} left to review.
            </p>
            <p className="mt-1 text-sm text-neutral-500">Approving a type applies it to every matching transaction from this provider and to future imports.</p>
          </div>

          {!loading && reviewGroups.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">Every imported description has a rule.</div>
          ) : null}

          <div className="mt-5 space-y-3">
            {reviewGroups.map(group => {
              const key = `${group.sourceId}:${group.direction}:${group.description}`;
              const draft = ruleDrafts[key] ?? { description: group.description, matchMode: "exact" as const };
              return (
                <article key={key} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <h3 className="font-medium text-neutral-100">{group.description}</h3>
                      <p className="mt-1 text-sm text-neutral-400">
                        {group.sourceName} · {titleCase(group.direction)} · {group.transactionCount} transaction{group.transactionCount === 1 ? "" : "s"} · latest {group.latestTransactionDate}
                      </p>
                      <p className="mt-2 text-sm text-neutral-500">
                        {group.samples.map(sample => `${sample.transactionDate} ${formatMoney(sample.amountMinor, sample.currencyCode)}`).join(" · ")}
                      </p>
                    </div>
                    <div className="flex max-w-lg flex-wrap gap-2">
                      <input
                        className="min-w-48 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                        value={draft.description}
                        disabled={savingKey === key}
                        onChange={event => setRuleDrafts(current => ({ ...current, [key]: { ...draft, description: event.target.value } }))}
                        aria-label="Rule match text"
                      />
                      <select
                        className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        value={draft.matchMode}
                        disabled={savingKey === key}
                        onChange={event => setRuleDrafts(current => ({ ...current, [key]: { ...draft, matchMode: event.target.value as ClassificationMatchMode } }))}
                        aria-label="Rule match mode"
                      >
                        {matchModeOptions.map(matchMode => <option key={matchMode} value={matchMode}>{titleCase(matchMode)}</option>)}
                      </select>
                      {economicTypeOptions.map(economicType => (
                        <button
                          key={economicType}
                          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={savingKey === key}
                          onClick={() => void saveRule({ sourceId: group.sourceId, description: draft.description, direction: group.direction, matchMode: draft.matchMode, economicType }, key)}
                        >
                          {savingKey === key ? "Saving…" : titleCase(economicType)}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Classification rules</p>
            <h2 className="mt-2 text-xl font-semibold">Saved local decisions</h2>
          </div>
          {!loading && rules.length === 0 ? <p className="mt-5 text-sm text-neutral-400">No rules approved yet.</p> : null}
          {rules.length > 0 ? (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-neutral-800">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                  <tr><th className="px-4 py-3 font-medium">Provider</th><th className="px-4 py-3 font-medium">Match</th><th className="px-4 py-3 font-medium">Direction</th><th className="px-4 py-3 font-medium">Economic type</th><th className="px-4 py-3" /></tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {rules.map(rule => (
                    <tr key={rule.id} className="bg-neutral-950/30">
                      <td className="px-4 py-3 text-neutral-400">{rule.sourceName}</td>
                      <td className="px-4 py-3 text-neutral-100">{titleCase(rule.matchMode)}: {rule.normalizedDescription}</td>
                      <td className="px-4 py-3 text-neutral-400">{titleCase(rule.direction)}</td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                          value={rule.economicType}
                          disabled={savingKey === `rule-${rule.id}`}
                          onChange={event => void saveRule({ sourceId: rule.sourceId, description: rule.normalizedDescription, direction: rule.direction, matchMode: rule.matchMode, economicType: event.target.value as EconomicType }, `rule-${rule.id}`)}
                        >
                          {economicTypeOptions.map(economicType => <option key={economicType} value={economicType}>{titleCase(economicType)}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right"><button className="text-sm text-red-300 hover:text-red-200 disabled:opacity-50" disabled={savingKey === `delete-${rule.id}`} onClick={() => void deleteRule(rule)}>{savingKey === `delete-${rule.id}` ? "Deleting…" : "Delete"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Transactions</p>
              <h2 className="mt-2 text-xl font-semibold">Newest first</h2>
            </div>
            {!loading ? <p className="text-sm text-neutral-500">{transactions.length}{hasMoreTransactions ? "+" : ""} loaded</p> : null}
          </div>

          {!loading && transactions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 p-8 text-sm text-neutral-400">
              Imported transactions will appear here.
            </div>
          ) : null}

          {transactions.length > 0 ? (
            <div className="mt-5">
              <div className="overflow-x-auto rounded-2xl border border-neutral-800">
                <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Economic</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {transactions.map(transaction => (
                    <tr key={transaction.id} className="bg-neutral-950/30">
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-400">{transaction.transactionDate}</td>
                      <td className="px-4 py-3 text-neutral-100">{transaction.description}</td>
                      <td className="px-4 py-3 text-neutral-400">{transaction.accountName}</td>
                      <td className="px-4 py-3 text-neutral-400">{titleCase(transaction.transactionType)}</td>
                      <td className="px-4 py-3 text-neutral-400">{titleCase(transaction.economicType)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${transaction.amountMinor < 0 ? "text-red-300" : "text-emerald-300"}`}>
                        {formatMoney(transaction.amountMinor, transaction.currencyCode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
              {hasMoreTransactions ? (
                <button
                  className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={loadingTransactions}
                  onClick={() => void loadTransactions(transactions.length, true)}
                >
                  {loadingTransactions ? "Loading…" : "Load more transactions"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default App;
