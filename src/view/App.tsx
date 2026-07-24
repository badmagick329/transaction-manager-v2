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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [importResponse, transactionResponse] = await Promise.all([
          fetch("/api/imports/latest"),
          fetch("/api/transactions"),
        ]);
        if (!importResponse.ok || !transactionResponse.ok) throw new Error("Unable to load the finance workspace.");
        setLatestImport(await importResponse.json());
        setTransactions(await transactionResponse.json());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load the finance workspace.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

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
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Transactions</p>
              <h2 className="mt-2 text-xl font-semibold">Newest first</h2>
            </div>
            {!loading ? <p className="text-sm text-neutral-500">{transactions.length} total</p> : null}
          </div>

          {!loading && transactions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 p-8 text-sm text-neutral-400">
              Imported transactions will appear here.
            </div>
          ) : null}

          {transactions.length > 0 ? (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-neutral-800">
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
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default App;
