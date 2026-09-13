import { expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { exportMinor, parseAmazonCsv, parseAmazonExport } from "./amazon-export";
import { mergeOrder } from "../../app/amazon-orders";
import { sampleOrder } from "../../app/amazon-order-fixtures";

const row = (overrides: Record<string, string> = {}) => ({ ASIN: "TEST1", Website: "Amazon.co.uk", Currency: "GBP", "Order ID": "000-0000000-0000001", "Order Date": "2026-08-09T12:00:00Z", "Order Status": "Closed", "Original Quantity": "1", "Payment Method Type": "MasterCard - 1234", "Product Name": "Energy drinks (pack of 12)", "Unit Price": "18.50", "Unit Price Tax": "3.70", "Total Amount": "22.20", "Shipping Charge": "0", "Total Discounts": "0", ...overrides });
const csv = (rows: Record<string, string>[]) => [Object.keys(rows[0]!), ...rows.map(Object.values)].map(r => r.map(v => JSON.stringify(v)).join(",")).join("\r\n");
const parse = (rows: Record<string, string>[], extra: Record<string, string> = {}) => parseAmazonExport(zipSync(Object.fromEntries(Object.entries({ "Your Amazon Orders/Order History.csv": csv(rows), ...extra }).map(([k,v]) => [k, strToU8(v)]))), "anonymous.zip", "2026-09-13T00:00:00Z");

test("CSV quoted commas/newlines, invalid records and exact decimal money", () => {
  expect(parseAmazonCsv('a,b\r\n"one, two","line\nnext"')[0]).toEqual({a:"one, two",b:"line\nnext"});
  expect(() => parseAmazonCsv('a,b\n"bad')).toThrow();
  expect(() => parseAmazonCsv('a,b\n1')).toThrow();
  expect(exportMinor("'-2.25'")).toBe(-225);
  expect(exportMinor("58.900")).toBe(5890);
  expect(() => exportMinor("1.001")).toThrow();
});
test("retail totals include VAT once, quantity multiplies unit price, discounts stay separate", () => {
  const order = parse([row(), row({ASIN:"TEST2", "Product Name":"Lanyard", "Unit Price":"3.32", "Unit Price Tax":"0.67", "Total Amount":"3.99"})]).file.orders[0]!;
  expect(order.totalMinor).toBe(2619);
  expect(order.items!.map(i=>i.amountMinor)).toEqual([2220,399]);
  expect(order.cardMinor).toBe(2619);
  expect(parse([row({"Original Quantity":"3", "Unit Price":"2.92", "Unit Price Tax":"0.58", "Total Amount":"10.50"})]).file.orders[0]!.items![0]!.amountMinor).toBe(1050);
  const adjusted = parse([row({"Unit Price":"29.99", "Unit Price Tax":"0", "Shipping Charge":"1.99", "Total Discounts":"'-1.99'", "Total Amount":"29.99"})]).file.orders[0]!;
  expect(adjusted).toMatchObject({totalMinor:2999, deliveryMinor:199, discountMinor:199, incomplete:false});
});
test("mixed gift funding stays unknown, gift-only stays visible, discrepant totals stay incomplete", () => {
  expect(parse([row({"Payment Method Type":"Gift Certificate/Card and MasterCard - 1234"})]).file.orders[0]).toMatchObject({incomplete:true});
  expect(parse([row({"Payment Method Type":"Gift Certificate/Card and MasterCard - 1234"})]).file.orders[0]!.cardMinor).toBeUndefined();
  expect(parse([row({"Payment Method Type":"Gift Certificate/Card"})]).file.orders[0]).toMatchObject({cardMinor:0,giftCardMinor:2220});
  expect(parse([row({"Shipping Charge":"0.33"})]).file.orders[0]).toMatchObject({totalMinor:2220,incomplete:true});
});
test("refund date and gift destination preserved separately without bank receipt or returned-item inference", () => {
  const result = parse([row()], {"Your Returns & Refunds/Refund Details.csv": csv([{"Order ID":"000-0000000-0000001",Website:"Amazon.co.uk",Currency:"GBP","Payment Status":"Completed","Reversal Status":"Completed","Disbursement Type":"Refund","Refund Amount":"3.99","Refund Date":"2026-08-12T12:00:00Z"}]),"Additional Data/Your Orders.Returns.2/Your Orders.Returns.2.csv":csv([{"Order ID":"000-0000000-0000001","Currency Code":"GBP","Refund Amount":"3.990","Refund Destination":"ElectronicGiftCertificate"}])});
  expect(result.file.orders[0]).toMatchObject({totalMinor:2220,refundMinor:399,payments:[{kind:"refund",amountMinor:399,date:"2026-08-12",destination:"ElectronicGiftCertificate"}]});
  expect(result.file.orders[0]!.items![0]!.returned).toBeUndefined();
});
test("overlapping PDF lines keep IDs, no duplicated items, row order is stable", () => {
  const rows = [row(),row({ASIN:"TEST2","Product Name":"Lanyard","Unit Price":"3.32","Unit Price Tax":"0.67","Total Amount":"3.99"})];
  const a = parse(rows).file.orders[0]!;
  expect(parse([...rows].reverse()).file.orders).toEqual([a]);
  const merged = mergeOrder(sampleOrder(),a);
  expect(merged.data.items).toHaveLength(2);
  expect(merged.data.items!.map(i=>i.id)).toEqual(["drink","lanyard"]);
  expect(merged.conflict).toBe(false);
  const partial = parse(rows.map(r=>({...r,"Payment Method Type":"Gift Certificate/Card and MasterCard - 1234"}))).file.orders[0]!;
  expect(mergeOrder(sampleOrder(),partial)).toMatchObject({conflict:false,data:{incomplete:false,cardMinor:2619,giftCardMinor:0}});
});
test("cancelled rows excluded, malformed money fails with order diagnostic", () => {
  expect(parse([row(),row({"Order Status":"Cancelled"})]).report.cancelledRows).toBe(1);
  expect(()=>parse([row({"Unit Price":"unknown"})])).toThrow("Order 000-0000000-0000001");
  expect(parse([row({Website:"PrimeNow-UK"})]).file.orders[0]!.marketplace).toBe("primenow-uk");
  expect(()=>parse([row({Website:"../../outside"})])).toThrow("Unsupported retail marketplace");
});
