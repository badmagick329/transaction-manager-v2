import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const inputPaths = process.argv.slice(2);
const outputDirectory = "notes/temp_files";
const transactionTypes = new Map([
  ["Pre-approved Payment Bill User Payment", "purchase"],
  ["Express Checkout Payment", "purchase"],
  ["Bank Deposit to PP Account", "funding"],
  ["General Card Deposit", "funding"],
  ["User Initiated Withdrawal", "withdrawal"],
  ["General Currency Conversion", "transfer"],
]);

if (inputPaths.length === 0) {
  throw new Error("Usage: bun scripts/parse-paypal-activity-csv.mjs <paypal-export.csv> [...more.csv]");
}

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
  const headers = rawHeaders.map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
  return values
    .filter((columns) => columns.some((value) => value !== ""))
    .map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""])));
}

function minor(value) {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim().replace(/,/g, "");
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/, "");
  const [whole, fractional = ""] = unsigned.split(".");
  const result = Number(whole) * 100 + Number((fractional + "00").slice(0, 2));
  return negative ? -result : result;
}

function lastSunday(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

function londonTransactionDate(date, time) {
  const [day, month, year] = date.split("/").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const marchSunday = lastSunday(year, 2);
  const octoberSunday = lastSunday(year, 9);
  const invalidSpringHour = month === 3 && day === marchSunday && hour === 1;
  const ambiguousAutumnHour = month === 10 && day === octoberSunday && hour === 1;
  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (invalidSpringHour || ambiguousAutumnHour) return isoDate;

  const isBst = (month > 3 && month < 10) ||
    (month === 3 && (day > marchSunday || (day === marchSunday && hour >= 2))) ||
    (month === 10 && (day < octoberSunday || (day === octoberSunday && hour < 1)));
  return `${isoDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${isBst ? "+01:00" : "+00:00"}`;
}

function makeRecord(row) {
  const name = row.Name || null;
  const fee = minor(row.Fee);
  return {
    account: { externalId: null, name: `PayPal ${row.Currency} balance`, currencyCode: row.Currency },
    externalId: row["Transaction ID"] || null,
    transactionDate: londonTransactionDate(row.Date, row.Time),
    postedDate: null,
    description: name ?? row.Description,
    rawDescription: row.Description,
    amountMinor: minor(row.Net),
    currencyCode: row.Currency,
    balanceMinor: minor(row.Balance),
    transactionType: transactionTypes.get(row.Description) ?? null,
    merchant: name,
    reference: row["Reference Txn ID"] || null,
    counterparty: name,
    feeMinor: fee ? Math.abs(fee) : null,
    fxOriginalAmountMinor: null,
    fxOriginalCurrencyCode: null,
    notes: null,
    rawPayload: { paypal_row: row },
  };
}

await mkdir(outputDirectory, { recursive: true });

for (const inputPath of inputPaths) {
  const rows = parseCsv(await readFile(inputPath, "utf8"));
  const dates = rows.map((row) => {
    const [day, month, year] = row.Date.split("/");
    return `${year}-${month}-${day}`;
  }).sort();
  const outputPath = join(outputDirectory, `${dates[0]}_${dates.at(-1)}_PayPal.json`);
  const output = {
    source: {
      slug: "paypal",
      name: "PayPal",
      kind: "paypal",
      fileName: basename(inputPath),
      exportedAt: null,
      account: null,
    },
    records: rows.map(makeRecord),
  };

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`${outputPath}: ${rows.length} records`);
}
