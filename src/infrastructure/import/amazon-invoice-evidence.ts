import { z } from "zod";

export const invoiceDocumentsSchema = z.array(z.object({
  fileName: z.string().min(1), fileHash: z.string().regex(/^[a-f0-9]{64}$/), pages: z.array(z.string()).min(1),
}).strict());
export type InvoiceDocuments = z.infer<typeof invoiceDocumentsSchema>;
type InvoiceItem = { asin: string; quantity: number; amountMinor: number };
export type InvoiceEvidence = {
  orderId: string; invoiceId: string; currencyCode: "GBP"; totalMinor: number;
  deliveryMinor: number; giftWrapMinor: number; discountMinor: number; items: InvoiceItem[];
  sources: Array<{ fileName: string; fileHash: string; page: number }>;
};
const pounds = (line: string) => [...line.matchAll(/(-?)£([\d,]+)\.(\d{2})/g)].map(m => (Number(m[2]!.replaceAll(",", "")) * 100 + Number(m[3])) * (m[1] ? -1 : 1));

/** Accept only complete UK invoice tables. Credit notes, partial pages and contradictory copies
 * cannot establish purchase adjustments. Text is agent-extracted from the original PDFs. */
export function parseInvoiceEvidence(documents: InvoiceDocuments) {
  const invoices = new Map<string, InvoiceEvidence>();
  const conflicts = new Set<string>();
  const diagnostics: string[] = [];
  for (const doc of documents) {
    const sections = new Map<string, { orderId: string; text: string; pages: number[] }>();
    for (const [index, text] of doc.pages.entries()) {
      if (!/^\s*(Invoice|Receipt)(?:\s*\n|\s+#)/.test(text)) continue;
      const invoiceId = text.match(/^(?:Invoice|Receipt) #\s*([^\s]+)/m)?.[1];
      if (!invoiceId) continue;
      const prior = sections.get(invoiceId);
      const orderId = text.match(/Order #\s*(\d{3}-\d{7}-\d{7})/)?.[1] ?? prior?.orderId;
      if (!orderId) continue;
      sections.set(invoiceId, { orderId, text: `${prior?.text ?? ""}\n${text}`, pages: [...(prior?.pages ?? []), index + 1] });
    }
    for (const [invoiceId, section] of sections) {
      const { orderId, text } = section;
      const key = `${orderId}|${invoiceId}`;
      const pageLabels = [...text.matchAll(/Page (\d+) of (\d+)/g)];
      if (pageLabels.length && (pageLabels.some(p => p[2] !== pageLabels[0]![2]) || new Set(pageLabels.map(p => p[1])).size !== Number(pageLabels[0]![2]))) {
        diagnostics.push(`${orderId}: invoice ${invoiceId} has missing or inconsistent pages.`); continue;
      }
      const totals = text.split(/\r?\n/).filter(line => /^(Invoice total|Receipt total|Total payable)\s/.test(line)).flatMap(pounds);
      const items: InvoiceItem[] = [];
      let asin = "", deliveryMinor = 0, giftWrapMinor = 0, discountMinor = 0;
      for (const line of text.split(/\r?\n/)) {
        const found = line.match(/^ASIN:\s*([A-Z0-9]{10})/);
        if (found) asin = found[1]!;
        const values = pounds(line);
        if (/^Shipping Charges\s/.test(line) && values.length) deliveryMinor += values.at(-1)!;
        else if (/^Gift Wrap Charges\s/.test(line) && values.length) giftWrapMinor += values.at(-1)!;
        else if (/^(Promotions|Funded by Amazon)\s/.test(line) && values.length) discountMinor -= values.at(-1)!;
        else if (/^\d+\s+£/.test(line) && values.length >= 1 && asin) {
          items.push({ asin, quantity: Number(line.match(/^\d+/)![0]), amountMinor: values.at(-1)! }); asin = "";
        }
      }
      if (!totals.length || totals.some(t => t !== totals[0]) || !items.length || deliveryMinor < 0 || giftWrapMinor < 0 || discountMinor < 0 || items.reduce((n, item) => n + item.amountMinor, 0) + deliveryMinor + giftWrapMinor - discountMinor !== totals[0]) {
        diagnostics.push(`${orderId}: invoice ${invoiceId} is not a complete reconciled item table.`); continue;
      }
      const invoice: InvoiceEvidence = { orderId, invoiceId, currencyCode: "GBP", totalMinor: totals[0]!, deliveryMinor, giftWrapMinor, discountMinor, items,
        sources: section.pages.map(page => ({ fileName: doc.fileName, fileHash: doc.fileHash, page })) };
      const prior = invoices.get(key);
      if (prior) {
        const facts = (i: InvoiceEvidence) => JSON.stringify({ total: i.totalMinor, delivery: i.deliveryMinor, wrap: i.giftWrapMinor, discount: i.discountMinor, items: i.items });
        if (facts(prior) !== facts(invoice)) { conflicts.add(key); diagnostics.push(`${orderId}: conflicting copies of invoice ${invoiceId}.`); }
        else prior.sources.push(...invoice.sources);
      } else invoices.set(key, invoice);
    }
  }
  return { invoices: [...invoices.entries()].filter(([key]) => !conflicts.has(key)).map(([, invoice]) => invoice), diagnostics };
}

/** Invoice coverage must match the CSV's products, quantities, item values and final total.
 * A coincidental order-level sum is insufficient evidence of a complete invoice set. */
export function invoiceAdjustments(invoices: InvoiceEvidence[], orderId: string, currencyCode: string, items: InvoiceItem[], totalMinor: number) {
  const matched = invoices.filter(i => i.orderId === orderId && i.currencyCode === currencyCode);
  if (!matched.length || matched.reduce((n, i) => n + i.totalMinor, 0) !== totalMinor) return;
  const grouped = (rows: InvoiceItem[]) => {
    const map = new Map<string, { quantity: number; amountMinor: number }>();
    for (const row of rows) { const prior = map.get(row.asin) ?? { quantity: 0, amountMinor: 0 }; map.set(row.asin, { quantity: prior.quantity + row.quantity, amountMinor: prior.amountMinor + row.amountMinor }); }
    return JSON.stringify([...map].sort(([a], [b]) => a.localeCompare(b)));
  };
  if (grouped(items) !== grouped(matched.flatMap(i => i.items))) return;
  return { deliveryMinor: matched.reduce((n, i) => n + i.deliveryMinor, 0), giftWrapMinor: matched.reduce((n, i) => n + i.giftWrapMinor, 0), discountMinor: matched.reduce((n, i) => n + i.discountMinor, 0), invoices: matched };
}
