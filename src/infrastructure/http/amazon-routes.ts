import { z } from "zod";
import { amazonDateSchema, amazonLinkSchema } from "../../app/contracts/amazon-orders";
import { itemBreakdown } from "../../app/amazon-orders";
import type { AmazonRepository } from "../../app/ports/amazon-repository";
import { queryAmazonOrder, queryAmazonOrders } from "../../app/use-cases/query-amazon-orders";

const id = z.coerce.number().int().positive();
const handler = (action: (request: Request) => unknown | Promise<unknown>) => async (request: Request) => {
  try { return Response.json(await action(request)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Amazon operation failed" }, { status: 400 }); }
};
export function createAmazonRoutes(repository: AmazonRepository) {
  return {
    "/api/amazon-orders": { GET: handler(request => {
      const values = Object.fromEntries(new URL(request.url).searchParams);
      const filters = z.object({ q: z.string().optional(), from: amazonDateSchema.optional(), to: amazonDateSchema.optional(), status: z.enum(["matched", "unmatched", "partially-matched", "needs-review"]).optional(), offset: z.coerce.number().int().nonnegative().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict().refine(v => !v.from || !v.to || v.from <= v.to, "From date must be on or before To date").parse(values);
      return queryAmazonOrders(repository, filters);
    }) },
    "/api/amazon-orders/detail": { GET: handler(request => queryAmazonOrder(repository, id.parse(new URL(request.url).searchParams.get("id")))) },
    "/api/amazon-orders/link": { POST: handler(async request => { repository.reviewLink(amazonLinkSchema.parse(await request.json())); return { ok: true }; }) },
    "/api/amazon-orders/revision": { POST: handler(async request => { const input = z.object({ revisionId: id, accept: z.boolean() }).strict().parse(await request.json()); repository.reviewRevision(input.revisionId, input.accept); return { ok: true }; }) },
    "/api/amazon-orders/mapping": { POST: handler(async request => { const input = z.object({ brand: z.string().min(1), lastFour: z.string().regex(/^\d{4}$/), accountId: id }).strict().parse(await request.json()); repository.saveMapping(input); return { ok: true }; }) },
    "/api/amazon-orders/transactions": { GET: handler(request => {
      const input = z.object({ q: z.string().default(""), offset: z.coerce.number().int().nonnegative().default(0) }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
      const rows = repository.snapshot().transactions.filter(t => `${t.id} ${t.description} ${t.accountName} ${t.transactionDate} ${(t.amountMinor / 100).toFixed(2)}`.toLowerCase().includes(input.q.toLowerCase())).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
      return { total: rows.length, transactions: rows.slice(input.offset, input.offset + 30) };
    }) },
    "/api/amazon-orders/transaction": { GET: handler(request => {
      const transactionId = id.parse(new URL(request.url).searchParams.get("id"));
      const snapshot = repository.snapshot();
      return snapshot.links.filter(l => l.transactionId === transactionId && l.status === "confirmed").map(link => {
        const order = snapshot.orders.find(o => o.id === link.orderId)!;
        return { link, order, breakdown: itemBreakdown(order, link) };
      });
    }) },
  };
}
