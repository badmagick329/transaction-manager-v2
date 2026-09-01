import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const outputDirectory = "notes/temp_files";
const inputs = [];

for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] !== "--account") {
    throw new Error("Usage: bun scripts/parse-trading212-account-history-csv.mjs --account Invest <csv> --account StocksISA <csv>");
  }
  const account = process.argv[index + 1];
  const inputPath = process.argv[index + 2];
  if (!["Invest", "StocksISA"].includes(account) || !inputPath) {
    throw new Error("Each input requires --account Invest|StocksISA followed by a CSV path.");
  }
  inputs.push({ account, inputPath });
  index += 2;
}

if (inputs.length === 0) {
  throw new Error("Usage: bun scripts/parse-trading212-account-history-csv.mjs --account Invest <csv> --account StocksISA <csv>");
}

const transactionTypes = new Map([
  ["Deposit", "funding"],
  ["Withdrawal", "withdrawal"],
  ["Card debit", "purchase"],
  ["Card credit", "refund"],
  ["Spending cashback", "cashback"],
  ["Interest on cash", "interest"],
  ["Dividend (Dividend)", "dividend"],
  ["Dividend (Tax exempted)", "dividend"],
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const [rawHeaders, ...values] = rows;
  if (!rawHeaders?.length) throw new Error("CSV has no header row.");
  const headers = rawHeaders.map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
  return values
    .filter(columns => columns.some(value => value !== ""))
    .map(columns => Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""])));
}

function minor(value) {
  const normalized = String(value ?? "").trim().replace(/,/g, "");
  if (!normalized) return null;
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/, "");
  const [whole = "0", fractional = ""] = unsigned.split(".");
  const result = Number(whole) * 100 + Number((fractional + "00").slice(0, 2));
  return negative ? -result : result;
}

function transactionDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\+00:00$/);
  if (!match) throw new Error(`Unsupported Time (UTC) value: ${value}`);
  return `${match[1]}T${match[2]}Z`;
}

function coverageFromFilename(fileName) {
  const match = fileName.match(/from_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_/);
  if (!match) throw new Error(`Unable to read coverage range from filename: ${fileName}`);
  return { startDate: match[1], endDate: match[2] };
}

function makeRecord(row, accountName) {
  const action = row.Action;
  const merchant = row["Merchant name"]?.trim() || null;
  const description = action === "Card debit" || action === "Card credit"
    ? merchant ?? action
    : action;
  return {
    externalId: row.ID?.trim() || null,
    transactionDate: transactionDate(row["Time (UTC)"]),
    postedDate: null,
    description,
    rawDescription: description,
    amountMinor: minor(row.Total),
    currencyCode: row["Currency (Total)"],
    balanceMinor: null,
    transactionType: transactionTypes.get(action),
    merchant: action === "Card debit" || action === "Card credit" ? merchant : null,
    reference: row.ID?.trim() || null,
    counterparty: action === "Card debit" || action === "Card credit" ? merchant : null,
    feeMinor: null,
    fxOriginalAmountMinor: null,
    fxOriginalCurrencyCode: null,
    notes: row.Notes?.trim() || null,
    rawPayload: { trading212_account_history_row: row },
  };
}

await mkdir(outputDirectory, { recursive: true });

for (const { account, inputPath } of inputs) {
  const fileName = basename(inputPath);
  const rows = parseCsv(await readFile(inputPath, "utf8"));
  const accountName = account === "Invest" ? "Trading 212 Invest" : "Trading 212 Stocks ISA";
  const coverage = coverageFromFilename(fileName);
  const emittedRows = rows.filter(row => transactionTypes.has(row.Action));
  const skippedRows = rows.filter(row => !transactionTypes.has(row.Action));
  const dates = rows.map(row => row["Time (UTC)"].slice(0, 10)).sort();
  const outputPath = join(outputDirectory, `${dates.at(-1)}_Trading212_${account}.json`);
  const accountContext = { externalId: null, name: accountName, currencyCode: "GBP" };
  const records = emittedRows.map(row => makeRecord(row, accountName));
  const emittedIds = records.map(record => record.externalId).filter(Boolean);
  const duplicateIds = emittedIds.length - new Set(emittedIds).size;
  const actionCounts = Object.fromEntries(emittedRows.reduce((counts, row) => counts.set(row.Action, (counts.get(row.Action) ?? 0) + 1), new Map()));
  const currencyCounts = Object.fromEntries(emittedRows.reduce((counts, row) => counts.set(row["Currency (Total)"], (counts.get(row["Currency (Total)"]) ?? 0) + 1), new Map()));
  const skippedCounts = Object.fromEntries(skippedRows.reduce((counts, row) => counts.set(row.Action, (counts.get(row.Action) ?? 0) + 1), new Map()));
  const blankMerchantCardRows = emittedRows.filter(row => (row.Action === "Card debit" || row.Action === "Card credit") && !row["Merchant name"]?.trim()).length;
  const output = {
    source: {
      slug: "trading212",
      name: "Trading 212",
      kind: "trading212",
      fileName,
      exportedAt: null,
      account: accountContext,
      coveragePeriods: [{ ...coverage, account: accountContext }],
    },
    records,
  };

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, account, sourceRows: rows.length, emittedRows: records.length, emittedByAction: actionCounts, emittedByCurrency: currencyCounts, skippedByAction: skippedCounts, blankSourceIds: records.filter(record => !record.externalId).length, blankMerchantCardRows, duplicateEmittedIds: duplicateIds }));
}
