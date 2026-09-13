import { expect, test } from "bun:test";
import { parseInvoiceEvidence, invoiceAdjustments } from "./amazon-invoice-evidence";
import { parseAmazonExport } from "./amazon-export";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { amazonOrderSchema } from "../../app/contracts/amazon-orders";
import { sampleOrder } from "../../app/amazon-order-fixtures";

const orderId = "000-0000000-0000001";
const page = (invoiceId: string, asin: string, item: string, shipping: string, promotion: string, total: string) => `Invoice\nPage 1 of 1\nOrder # ${orderId}\nInvoice # ${invoiceId}\nInvoice total £${total}\nTotal payable £${total}\nASIN: ${asin}\n1 £1.00 20% £${item} £${item}\nShipping Charges £0.17 £${shipping} £${shipping}\nPromotions -£0.17 -£${promotion} -£${promotion}`;
const doc = (pages: string[], name = "invoice.pdf") => ({ fileName: name, fileHash: "a".repeat(64), pages });

test("gross delivery and promotions reconcile across invoices; duplicate invoice copies count once", () => {
  const adapter = page("invoice-one", "B000000001", "5.69", "0.99", "1.56", "5.12");
  const mic = page("invoice-two", "B000000002", "37.99", "1.00", "1.00", "37.99");
  const parsed = parseInvoiceEvidence([doc([adapter, mic]), doc([adapter], "copy.pdf")]);
  expect(parsed.invoices).toHaveLength(2);
  const adjustment = invoiceAdjustments(parsed.invoices, orderId, "GBP", [{asin:"B000000001",quantity:1,amountMinor:569},{asin:"B000000002",quantity:1,amountMinor:3799}],4311)!;
  expect(adjustment).toMatchObject({deliveryMinor:199,discountMinor:256,giftWrapMinor:0});
  expect(adjustment.invoices[0]!.sources).toHaveLength(2);
  expect(invoiceAdjustments(parsed.invoices, orderId, "GBP", [{asin:"B000000099",quantity:1,amountMinor:569},{asin:"B000000002",quantity:1,amountMinor:3799}],4311)).toBeUndefined();
  expect(invoiceAdjustments(parsed.invoices.slice(0,1),orderId,"GBP",[{asin:"B000000001",quantity:1,amountMinor:569}],4311)).toBeUndefined();
});
test("credit notes and contradictory copies cannot replace purchase evidence", () => {
  const good = page("invoice-one","B000000001","5.69","0.99","1.56","5.12");
  const bad = page("invoice-one","B000000001","5.69","1.99","2.56","5.12");
  expect(parseInvoiceEvidence([doc([good.replace(/^Invoice/,"Credit Note")])]).invoices).toHaveLength(0);
  expect(parseInvoiceEvidence([doc([good]),doc([bad],"conflict.pdf")]).invoices).toHaveLength(0);
  expect(parseInvoiceEvidence([doc([good.replace("-£1.56 -£1.56","-£1.00 -£1.00")])]).invoices).toHaveLength(0);
});
test("gift wrap is separate; continuation pages preserve explicit Amazon-funded discounts", () => {
  const wrapped=page("wrapped","B000000001","6.99","0.00","0.00","9.98")+"\nGift Wrap Charges £2.49 £2.99 £2.99";
  expect(parseInvoiceEvidence([doc([wrapped])]).invoices[0]).toMatchObject({giftWrapMinor:299,deliveryMinor:0,totalMinor:998});
  expect(amazonOrderSchema.parse(sampleOrder({giftWrapMinor:299,totalMinor:2918,cardMinor:2918})).giftWrapMinor).toBe(299);
  const part=page("multi","B000000001","5.52","0.50","0.50","5.20").replace("Page 1 of 1","Page 1 of 2");
  const next="Invoice # multi\nPage 2 of 2\nFunded by Amazon -£0.32";
  expect(parseInvoiceEvidence([doc([part])]).invoices).toHaveLength(0);
  expect(parseInvoiceEvidence([doc([part,next])]).invoices[0]).toMatchObject({discountMinor:82,totalMinor:520});
});
test("non-VAT receipts have one amount column; repeated quantity is checked against the CSV", () => {
  const receipt=`Receipt\nReceipt # receipt-one\nOrder # ${orderId}\nReceipt total £21.00\nASIN: B000000001\n1 £21.00\nShipping Charges £0.99\nPromotions -£0.99`;
  const {invoices}=parseInvoiceEvidence([doc([receipt])]);
  expect(invoices[0]).toMatchObject({totalMinor:2100,deliveryMinor:99,discountMinor:99});
  expect(invoiceAdjustments(invoices,orderId,"GBP",[{asin:"B000000001",quantity:2,amountMinor:2100}],2100)).toBeUndefined();
});
test("ZIP adapter uses verified invoice adjustments, keeps item identity and rejects wrong source hashes", () => {
  const pdf=strToU8("anonymous PDF fixture bytes");
  const fileHash=createHash("sha256").update(pdf).digest("hex");
  const csv='ASIN,Website,Currency,Order ID,Order Date,Order Status,Original Quantity,Payment Method Type,Product Name,Unit Price,Unit Price Tax,Total Amount,Shipping Charge,Total Discounts\n'+`B000000001,Amazon.co.uk,GBP,${orderId},2026-07-31T12:00:00Z,Closed,1,MasterCard - 1234,Adapter,4.74,0.95,5.12,0.17,-0.57`;
  const bytes=zipSync({"Your Amazon Orders/Order History.csv":strToU8(csv),"invoice.pdf":pdf});
  const documents=[{...doc([page("invoice-one","B000000001","5.69","0.99","1.56","5.12")]),fileHash}];
  const before=parseAmazonExport(bytes,"archive.zip","2026-09-13T00:00:00Z").file.orders[0]!;
  const after=parseAmazonExport(bytes,"archive.zip","2026-09-13T00:00:00Z",documents).file.orders[0]!;
  expect(before.incomplete).toBe(true);
  expect(after).toMatchObject({incomplete:false,totalMinor:512,deliveryMinor:99,discountMinor:156});
  expect(after.items).toEqual(before.items);
  expect(()=>parseAmazonExport(bytes,"archive.zip","2026-09-13T00:00:00Z",[doc(documents[0]!.pages)])).toThrow("source hash");
});
