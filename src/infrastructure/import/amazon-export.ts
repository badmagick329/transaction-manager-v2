import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { amazonImportSchema, type AmazonOrder, type AmazonImport } from "../../app/contracts/amazon-orders";
import { invoiceDocumentsSchema, parseInvoiceEvidence, invoiceAdjustments } from "./amazon-invoice-evidence";

const historyPath = "Your Amazon Orders/Order History.csv";
const refundPath = "Your Returns & Refunds/Refund Details.csv";
const destinationPath = "Additional Data/Your Orders.Returns.2/Your Orders.Returns.2.csv";
type Row = Record<string, string>;
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

/** Export cells contain commas, escaped quotes and embedded newlines; splitting lines loses evidence. */
export function parseAmazonCsv(text: string): Row[] {
  const records: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      pushCell();
      if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; records.push(row); row = []; }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error("Malformed CSV quoting"); cell += c; }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (cell || row.length || closed) { pushCell(); records.push(row); }
  const headers = records.shift()?.map((h, i) => i ? h : h.replace(/^\uFEFF/, ""));
  if (!headers || new Set(headers).size !== headers.length) throw new Error("Missing or duplicate CSV headers");
  return records.filter(r => r.some(Boolean)).map((r, i) => {
    if (r.length !== headers.length) throw new Error(`CSV record ${i + 2}: expected ${headers.length} fields, got ${r.length}`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j]!]));
  });
}

export function exportMinor(value: string): number {
  const normalized = value.replace(/^'|'$/g, "");
  if (!/^-?\d+(?:\.\d{1,2}0*)?$/.test(normalized)) throw new Error(`Invalid money value: ${value}`);
  const [whole, fraction = ""] = normalized.replace(/^-/, "").split(".");
  const n = (Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2))) * (normalized.startsWith("-") ? -1 : 1);
  if (!Number.isSafeInteger(n)) throw new Error("Money exceeds safe integer range");
  return n;
}

/** Keep each revision's evidence scoped to its order, rather than copying the whole archive into every revision. */
export function splitAmazonExport(file: AmazonImport): AmazonImport[] {
  const evidence = JSON.parse(file.source.evidence);
  return file.orders.map(order => ({ ...file, orders: [order], source: { ...file.source,
    evidence: JSON.stringify({ format: evidence.format, notes: evidence.notes, order: evidence.orders.find((o: { orderId: string }) => o.orderId === order.orderId), diagnostics: evidence.diagnostics.filter((d: { orderId?: string }) => d.orderId === order.orderId) }) } }));
}

/** Converts retail purchase evidence only; no bank transactions or inferred gift/card splits are created. */
export function parseAmazonExport(bytes: Uint8Array, fileName: string, capturedAt: string, invoiceText: unknown = []) {
  const documents = invoiceDocumentsSchema.parse(invoiceText);
  const wanted = new Set([historyPath, refundPath, destinationPath, ...documents.map(d => d.fileName)]);
  const entries = unzipSync(bytes, { filter: entry => {
    if (!wanted.has(entry.name)) return false;
    if (entry.originalSize > 16 * 1024 * 1024) throw new Error(`CSV exceeds 16 MB limit: ${entry.name}`);
    return true;
  } });
  if (!entries[historyPath]) throw new Error(`Archive is missing ${historyPath}`);
  for (const doc of documents) if (!entries[doc.fileName] || hash(entries[doc.fileName]!) !== doc.fileHash) throw new Error(`Invoice source hash does not match archive: ${doc.fileName}`);
  const invoiceEvidence = parseInvoiceEvidence(documents);
  const read = (path: string) => entries[path] ? parseAmazonCsv(strFromU8(entries[path]!)) : [];
  const rows = read(historyPath), refunds = read(refundPath), destinations = read(destinationPath);
  for (const [records, fields] of [[rows, ["Website", "Currency", "Order ID", "Order Date", "Order Status", "Original Quantity", "Payment Method Type", "ASIN", "Product Name", "Unit Price", "Unit Price Tax", "Total Amount", "Shipping Charge", "Total Discounts"]], [refunds, ["Website", "Currency", "Order ID", "Payment Status", "Reversal Status", "Disbursement Type", "Refund Amount", "Refund Date"]], [destinations, ["Order ID", "Currency Code", "Refund Amount", "Refund Destination"]]] as Array<[Row[], string[]]>) {
    if (records.length && fields.some(field => !(field in records[0]!))) throw new Error(`Missing required CSV headers: ${fields.filter(field => !(field in records[0]!)).join(", ")}`);
  }
  const diagnostics: Array<{ orderId?: string; reason: string }> = [];
  const groups = new Map<string, Row[]>();
  let cancelledRows = 0;
  for (const row of rows) {
    if (row["Order Status"] === "Cancelled") { cancelledRows++; continue; }
    if (row["Original Quantity"] === "0" && row["Total Amount"] === "0") { diagnostics.push({ orderId: row["Order ID"], reason: "Zero-quantity, zero-value row excluded." }); continue; }
    if (row["Order Status"] !== "Closed") throw new Error(`Unsupported order status: ${row["Order Status"]}`);
    const key = `${row.Website?.toLowerCase()}|${row["Order ID"]}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const orders: AmazonOrder[] = [];
  const evidence: unknown[] = [];
  const consumedRefunds = new Set<Row>();
  for (const unsorted of groups.values()) {
    const group = [...unsorted].sort((a, b) => JSON.stringify([a.ASIN, a["Product Name"], a["Ship Date"], a["Total Amount"]]).localeCompare(JSON.stringify([b.ASIN, b["Product Name"], b["Ship Date"], b["Total Amount"]])));
    const first = group[0]!; const orderId = first["Order ID"]!;
    try {
      const currencyCode = first.Currency!;
      if (!/^(amazon\.[a-z]{2,3}(?:\.[a-z]{2})?|AudibleUK|PrimeNow-UK)$/i.test(first.Website!)) throw new Error("Unsupported retail marketplace");
      if (group.some(r => r.Currency !== currencyCode || r["Order Date"] !== first["Order Date"])) throw new Error("Inconsistent currency or date within order");
      const items = group.map((r, i) => {
        if (!/^[1-9]\d*$/.test(r["Original Quantity"]!)) throw new Error("Invalid item quantity");
        const quantity = Number(r["Original Quantity"]);
        return { id: `export-${r.ASIN}-${i + 1}`, description: r["Product Name"]!, quantity,
          amountMinor: (exportMinor(r["Unit Price"]!) + exportMinor(r["Unit Price Tax"]!)) * quantity };
      });
      const totalMinor = group.reduce((n, r) => n + exportMinor(r["Total Amount"]!), 0);
      const verifiedInvoices = invoiceAdjustments(invoiceEvidence.invoices, orderId, currencyCode, items.map((item, i) => ({ ...item, asin: group[i]!.ASIN! })), totalMinor);
      const deliveryMinor = verifiedInvoices?.deliveryMinor ?? group.reduce((n, r) => n + exportMinor(r["Shipping Charge"]!), 0);
      const discountMinor = verifiedInvoices?.discountMinor ?? -group.reduce((n, r) => n + exportMinor(r["Total Discounts"]!), 0);
      const giftWrapMinor = verifiedInvoices?.giftWrapMinor ?? 0;
      const reconciled = items.reduce((n, i) => n + i.amountMinor, 0) + deliveryMinor + giftWrapMinor - discountMinor === totalMinor;
      const methods = [...new Set(group.map(r => r["Payment Method Type"]))];
      const method = methods.length === 1 ? methods[0]! : "Mixed methods";
      const card = /^(MasterCard|Visa|American Express) - (\d{4})$/.exec(method);
      const giftOnly = method === "Gift Certificate/Card";
      const order: AmazonOrder = { marketplace: first.Website!.toLowerCase(), orderId, orderDate: first["Order Date"]!.slice(0, 10), currencyCode,
        items, totalMinor, incomplete: !reconciled || (!card && !giftOnly) };
      if (reconciled) { order.deliveryMinor = deliveryMinor; order.discountMinor = discountMinor; }
      else diagnostics.push({ orderId, reason: "Export line totals and adjustments do not reconcile; adjustments retained in evidence, order incomplete." });
      if (giftWrapMinor) order.giftWrapMinor = giftWrapMinor;
      if (card) { order.card = { brand: card[1]!, lastFour: card[2]! }; order.cardMinor = totalMinor; order.giftCardMinor = 0; }
      else if (giftOnly) { order.cardMinor = 0; order.giftCardMinor = totalMinor; }
      else diagnostics.push({ orderId, reason: "Gift/card funding split or payment method unavailable; card and gift amounts left unknown." });
      const matchingRefunds = refunds.filter(r => r["Order ID"] === orderId && r.Website?.toLowerCase() === order.marketplace);
      const completed = matchingRefunds.filter(r => r["Payment Status"] === "Completed" && r["Reversal Status"] === "Completed" && r["Disbursement Type"] === "Refund").sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      if (completed.some(r => r.Currency !== currencyCode)) throw new Error("Refund currency differs from purchase");
      if (completed.length) {
        order.refundMinor = completed.reduce((n, r) => n + exportMinor(r["Refund Amount"]!), 0);
        order.payments = completed.map((r, i) => {
          const amountMinor = exportMinor(r["Refund Amount"]!);
          const matching = destinations.filter(d => d["Order ID"] === orderId && d["Currency Code"] === currencyCode && exportMinor(d["Refund Amount"]!) === amountMinor);
          const unique = matching.length === 1 && completed.filter(c => exportMinor(c["Refund Amount"]!) === amountMinor).length === 1;
          return { id: `export-refund-${hash(JSON.stringify(r)).slice(0, 16)}-${i}`, kind: "refund" as const, amountMinor,
            ...(r["Refund Date"] && r["Refund Date"] !== "Not Available" ? { date: r["Refund Date"]!.slice(0, 10) } : {}),
            ...(unique ? { destination: matching[0]!["Refund Destination"] } : {}) };
        });
      }
      orders.push(amazonImportSchema.shape.orders.element.parse(order));
      completed.forEach(r => consumedRefunds.add(r));
      // Keep relevant source fields, excluding addresses, tracking numbers and recipient details.
      evidence.push({ orderId, verifiedInvoices: verifiedInvoices?.invoices, rows: group.map(r => Object.fromEntries(["ASIN", "Order Status", "Original Quantity", "Payment Method Type", "Product Name", "Ship Date", "Shipment Item Subtotal", "Shipment Item Subtotal Tax", "Shipping Charge", "Total Amount", "Total Discounts", "Unit Price", "Unit Price Tax"].map(k => [k, r[k]]))), refunds: completed, refundDestinations: destinations.filter(d => d["Order ID"] === orderId).map(d => ({ amount: d["Refund Amount"], destination: d["Refund Destination"], status: d["Refund Status"] })) });
    } catch (error) { throw new Error(`Order ${orderId}: ${(error as Error).message}`); }
  }
  for (const r of refunds) if (!consumedRefunds.has(r)) diagnostics.push({ orderId: r["Order ID"], reason: "Refund not imported: no corresponding retail order or refund not completed." });
  const file = amazonImportSchema.parse({ kind: "amazon-orders", version: 1, source: { fileName, fileHash: hash(bytes), capturedAt,
    evidence: JSON.stringify({ format: "Amazon Request My Data retail CSV", notes: "Shipment subtotals may repeat; totals use line Total Amount. CSV Shipping Charge can represent VAT rather than gross delivery. Gross delivery/promotions use reconciled invoice evidence when supplied. Shipment dates are not payment dates.", diagnostics, orders: evidence }) }, orders });
  return { file, report: { sourceRows: rows.length, cancelledRows, orders: orders.length, items: orders.reduce((n, o) => n + o.items!.length, 0), incompleteOrders: orders.filter(o => o.incomplete).length, refundEvents: consumedRefunds.size, invoiceDiagnostics: invoiceEvidence.diagnostics, diagnostics, excluded: ["Digital Content Orders.csv (different component/payment format)", "Digital Borrowed Items.csv", "Unverified invoice pages", "Delivery photos", "Return requests/status (not proof of a completed refund)"] } };
}
