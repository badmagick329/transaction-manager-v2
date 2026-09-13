import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { mergeOrder, validateLink, reviewedMoney, balanceRefund, type Mapping, type AmazonSnapshot } from "../../app/amazon-orders";
import { amazonImportSchema, amazonMoneyReviewSchema, type AmazonMoneyReview, type AmazonImport, type AmazonLinkInput } from "../../app/contracts/amazon-orders";
import type { AmazonRepository } from "../../app/ports/amazon-repository";
import type { AppDatabase } from "./client";
import { amazonSettings, accounts, amazonOrders, amazonRevisions, amazonLinks, amazonMappings, amazonHistory, transactions, importBatches, importAttempts } from "./schema";

const fingerprint = (value: unknown): string => {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
};

/** Purchase snapshots deliberately share no transaction-creation or cash-flow mutation path. */
export class DrizzleAmazonRepository implements AmazonRepository {
  constructor(private readonly db: AppDatabase) {}

  trackingStart(): string {
    return this.db.select().from(amazonSettings).where(eq(amazonSettings.id, 1)).get()!.trackingStart;
  }

  saveTrackingStart(date: string): void {
    this.db.update(amazonSettings).set({ trackingStart: date }).where(eq(amazonSettings.id, 1)).run();
  }

  /** Missing statements excuse matching, without asserting payment or changing purchase evidence. */
  setMatchingSkipped(orderId: number, skipped: boolean): void {
    this.db.transaction(tx => {
      const order = tx.select().from(amazonOrders).where(eq(amazonOrders.id, orderId)).get();
      if (!order) throw new Error("Order not found");
      if (order.matchingSkipped === skipped) return;
      tx.update(amazonOrders).set({ matchingSkipped: skipped }).where(eq(amazonOrders.id, orderId)).run();
      tx.insert(amazonHistory).values({ orderId, action: skipped ? "payment-matching-skipped" : "payment-matching-resumed", detail: { reason: skipped ? "Statement unavailable" : null } }).run();
    });
  }

  snapshot(): AmazonSnapshot {
    // Browsing needs accepted facts, not every revision's source text and incoming snapshot.
    const revisions = this.db.select({ id: amazonRevisions.id, orderId: amazonRevisions.orderId, status: amazonRevisions.status, data: amazonRevisions.data }).from(amazonRevisions).all();
    const byId = new Map(revisions.map(r => [r.id, r]));
    const pending = new Set(revisions.filter(r => r.status === "pending").map(r => r.orderId));
    return {
      orders: this.db.select().from(amazonOrders).all().map(o => ({ id: o.id, revisionId: o.revisionId!, data: byId.get(o.revisionId!)!.data, needsReview: pending.has(o.id), matchingSkipped: o.matchingSkipped })),
      links: this.db.select().from(amazonLinks).all(), mappings: this.db.select().from(amazonMappings).all(),
      transactions: this.db.select({ id: transactions.id, accountId: transactions.accountId, accountName: accounts.name, description: transactions.description, amountMinor: transactions.amountMinor, currencyCode: transactions.currencyCode, transactionDate: transactions.transactionDate, status: transactions.status }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.accountId)).all(),
    };
  }

  evidence(orderId: number) {
    return { revisions: this.db.select().from(amazonRevisions).where(eq(amazonRevisions.orderId, orderId)).all(), history: this.db.select().from(amazonHistory).where(eq(amazonHistory.orderId, orderId)).all() };
  }

  async importFile(input: { fileName: string; fileHash: string; importFile: AmazonImport }) {
    const file = amazonImportSchema.parse(input.importFile);
    return this.db.transaction(tx => {
      const existing = tx.select().from(importBatches).where(eq(importBatches.fileHash, input.fileHash)).get();
      if (existing?.status === "processed") return { ...existing, status: "processed" as const };
      let duplicateRecordCount = 0;
      for (const incoming of file.orders) {
        let order = tx.select().from(amazonOrders).where(and(eq(amazonOrders.marketplace, incoming.marketplace), eq(amazonOrders.orderId, incoming.orderId))).get();
        if (!order) order = tx.insert(amazonOrders).values({ marketplace: incoming.marketplace, orderId: incoming.orderId }).returning().get();
        const hash = fingerprint(incoming);
        if (tx.select().from(amazonRevisions).where(and(eq(amazonRevisions.orderId, order.id), eq(amazonRevisions.fingerprint, hash))).get()) { duplicateRecordCount++; continue; }
        const current = order.revisionId ? tx.select().from(amazonRevisions).where(eq(amazonRevisions.id, order.revisionId)).get()! : null;
        const merged = current ? mergeOrder(current.data, incoming) : { data: incoming, conflict: false };
        const revision = tx.insert(amazonRevisions).values({ orderId: order.id, fingerprint: hash, data: merged.data, incomingData: incoming, source: file.source, status: merged.conflict ? "pending" : "accepted" }).returning().get();
        if (!merged.conflict) {
          tx.update(amazonOrders).set({ revisionId: revision.id }).where(eq(amazonOrders.id, order.id)).run();
          if (current && balanceRefund(current.data) !== balanceRefund(merged.data)) tx.update(amazonLinks).set({ status: "needs_review" }).where(and(eq(amazonLinks.orderId, order.id), eq(amazonLinks.kind, "refund"), eq(amazonLinks.status, "confirmed"))).run();
          if (current && this.materialChange(current.data, merged.data)) {
            tx.update(amazonLinks).set({ status: "needs_review" }).where(and(eq(amazonLinks.orderId, order.id), eq(amazonLinks.status, "confirmed"))).run();
          }
        }
        tx.insert(amazonHistory).values({ orderId: order.id, action: merged.conflict ? "revision-proposed" : "revision-imported", detail: { revisionId: revision.id, source: file.source.fileName } }).run();
      }
      const values = { fileName: input.fileName, fileHash: input.fileHash, status: "processed" as const, recordCount: file.orders.length - duplicateRecordCount, duplicateRecordCount, errorMessage: null, importedAt: new Date().toISOString(), attemptCount: (existing?.attemptCount ?? 0) + 1 };
      const batch = existing ? tx.update(importBatches).set(values).where(eq(importBatches.id, existing.id)).returning().get() : tx.insert(importBatches).values(values).returning().get();
      tx.insert(importAttempts).values({ importBatchId: batch.id, attemptNumber: batch.attemptCount, status: "processed", completedAt: new Date().toISOString() }).run();
      return { ...batch, status: "processed" as const };
    });
  }

  private materialChange(a: AmazonImport["orders"][number], b: AmazonImport["orders"][number]) {
    const financial = (o: typeof a) => ({ currency: o.currencyCode, method: o.card, card: o.cardMinor, total: o.totalMinor, gift: o.giftCardMinor, items: o.items?.map(i => ({ id: i.id, amountMinor: i.amountMinor, description: i.description })) });
    return fingerprint(financial(a)) !== fingerprint(financial(b)) || (b.refundMinor ?? 0) < (a.refundMinor ?? 0) || !!a.items?.some(i => i.returned && !b.items?.find(n => n.id === i.id)?.returned);
  }

  reviewLink(input: AmazonLinkInput) {
    this.db.transaction(tx => {
      validateLink(this.snapshot(), input);
      const previous = tx.select().from(amazonLinks).where(and(eq(amazonLinks.orderId, input.orderId), eq(amazonLinks.transactionId, input.transactionId), eq(amazonLinks.kind, input.kind))).get();
      tx.insert(amazonLinks).values(input).onConflictDoUpdate({ target: [amazonLinks.orderId, amazonLinks.transactionId, amazonLinks.kind], set: input }).run();
      tx.insert(amazonHistory).values({ orderId: input.orderId, action: `link-${input.status}`, detail: { before: previous ?? null, after: input } }).run();
    });
  }

  reviewRevision(revisionId: number, accept: boolean) {
    this.db.transaction(tx => {
      const revision = tx.select().from(amazonRevisions).where(eq(amazonRevisions.id, revisionId)).get();
      if (!revision || revision.status !== "pending") throw new Error("Choose a pending revision");
      const order = tx.select().from(amazonOrders).where(eq(amazonOrders.id, revision.orderId)).get()!;
      if (accept) {
        const current = tx.select().from(amazonRevisions).where(eq(amazonRevisions.id, order.revisionId!)).get()!;
        const data = mergeOrder(current.data, revision.incomingData).data;
        tx.update(amazonRevisions).set({ data }).where(eq(amazonRevisions.id, revisionId)).run();
        tx.update(amazonOrders).set({ revisionId }).where(eq(amazonOrders.id, order.id)).run();
        if (balanceRefund(current.data) !== balanceRefund(data)) tx.update(amazonLinks).set({ status: "needs_review" }).where(and(eq(amazonLinks.orderId, order.id), eq(amazonLinks.kind, "refund"), eq(amazonLinks.status, "confirmed"))).run();
        if (this.materialChange(current.data, data)) tx.update(amazonLinks).set({ status: "needs_review" }).where(and(eq(amazonLinks.orderId, order.id), eq(amazonLinks.status, "confirmed"))).run();
      }
      tx.update(amazonRevisions).set({ status: accept ? "accepted" : "rejected" }).where(eq(amazonRevisions.id, revisionId)).run();
      tx.insert(amazonHistory).values({ orderId: order.id, action: accept ? "revision-accepted" : "revision-rejected", detail: { revisionId } }).run();
    });
  }

  reviewMoney(input: AmazonMoneyReview) {
    input = amazonMoneyReviewSchema.parse(input);
    this.db.transaction(tx => {
      const order = tx.select().from(amazonOrders).where(eq(amazonOrders.id, input.orderId)).get();
      if (!order || order.revisionId !== input.revisionId) throw new Error("Order changed. Refresh and review the current details");
      const current = tx.select().from(amazonRevisions).where(eq(amazonRevisions.id, order.revisionId)).get()!;
      const data = reviewedMoney(current.data, input);
      if (fingerprint(data) === fingerprint(current.data)) return;
      const capturedAt = new Date().toISOString();
      const source = { fileName: "Reviewed order funding and refunds", fileHash: fingerprint(input), capturedAt, evidence: input.evidence };
      const revision = tx.insert(amazonRevisions).values({ orderId: order.id, fingerprint: fingerprint({ data, input, capturedAt }), data, incomingData: data, source, status: "accepted" }).returning().get();
      tx.update(amazonOrders).set({ revisionId: revision.id }).where(eq(amazonOrders.id, order.id)).run();
      if (balanceRefund(current.data) !== balanceRefund(data)) tx.update(amazonLinks).set({ status: "needs_review" }).where(and(eq(amazonLinks.orderId, order.id), eq(amazonLinks.kind, "refund"), eq(amazonLinks.status, "confirmed"))).run();
      if (this.materialChange(current.data, data)) tx.update(amazonLinks).set({ status: "needs_review" }).where(and(eq(amazonLinks.orderId, order.id), eq(amazonLinks.status, "confirmed"))).run();
      tx.insert(amazonHistory).values({ orderId: order.id, action: "money-reviewed", detail: { revisionId: revision.id, before: current.data, after: data, evidence: input.evidence } }).run();
    });
  }

  saveMapping(mapping: Mapping) {
    this.db.transaction(tx => {
      if (!tx.select().from(accounts).where(eq(accounts.id, mapping.accountId)).get()) throw new Error("Account not found");
      tx.insert(amazonMappings).values(mapping).onConflictDoUpdate({ target: [amazonMappings.brand, amazonMappings.lastFour], set: mapping }).run();
      tx.insert(amazonHistory).values({ action: "card-mapped", detail: mapping }).run();
    });
  }
}
