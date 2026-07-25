import { and, asc, eq, inArray } from "drizzle-orm";
import type { PayPalPaymentLink, ReconciliationRepository } from "../../app/ports/reconciliation-repository";
import type { LinkStatus } from "../../core/finance/constants";
import type { AppDatabase } from "./client";
import { sources, transactionLinks, transactions } from "./schema";

const now = () => new Date().toISOString();
const dateOnly = (value: string) => value.slice(0, 10);
const daysBetween = (earlier: string, later: string) => Math.round((Date.parse(`${dateOnly(later)}T00:00:00Z`) - Date.parse(`${dateOnly(earlier)}T00:00:00Z`)) / 86_400_000);

type ReconciliationTransaction = {
  id: number;
  transactionDate: string;
  description: string;
  amountMinor: number;
  currencyCode: string;
  transactionType: string;
  sourceSlug: string;
};

export class DrizzlePayPalReconciliationRepository implements ReconciliationRepository {
  constructor(private readonly db: AppDatabase) {}

  async proposePayPalPaymentLinks(): Promise<number> {
    return this.db.transaction(async tx => {
      const candidates = await tx
        .select({
          id: transactions.id,
          transactionDate: transactions.transactionDate,
          description: transactions.description,
          amountMinor: transactions.amountMinor,
          currencyCode: transactions.currencyCode,
          transactionType: transactions.transactionType,
          sourceSlug: sources.slug,
        })
        .from(transactions)
        .innerJoin(sources, eq(transactions.sourceId, sources.id));
      const existingLinks = await tx.select().from(transactionLinks).where(eq(transactionLinks.linkType, "funds"));
      const linkedTransactionIds = new Set(existingLinks.flatMap(link => [link.fromTransactionId, link.toTransactionId]));
      const hsbc = candidates.filter(item => item.sourceSlug === "hsbc" && item.amountMinor < 0 && item.description.trim().toUpperCase() === "PAYPAL PAYMENT" && !linkedTransactionIds.has(item.id));
      const paypal = candidates.filter(item => item.sourceSlug === "paypal" && item.amountMinor < 0 && item.transactionType === "purchase" && !linkedTransactionIds.has(item.id));
      const proposals: Array<{ fromTransactionId: number; toTransactionId: number }> = [];

      for (const bankPayment of hsbc) {
        const matches = paypal.filter(purchase => purchase.currencyCode === bankPayment.currencyCode && purchase.amountMinor === bankPayment.amountMinor && daysBetween(purchase.transactionDate, bankPayment.transactionDate) >= 1 && daysBetween(purchase.transactionDate, bankPayment.transactionDate) <= 4);
        if (matches.length !== 1) continue;
        const purchase = matches[0]!;
        const reverseMatches = hsbc.filter(otherPayment => otherPayment.currencyCode === purchase.currencyCode && otherPayment.amountMinor === purchase.amountMinor && daysBetween(purchase.transactionDate, otherPayment.transactionDate) >= 1 && daysBetween(purchase.transactionDate, otherPayment.transactionDate) <= 4);
        if (reverseMatches.length !== 1) continue;
        proposals.push({ fromTransactionId: bankPayment.id, toTransactionId: purchase.id });
      }

      if (proposals.length === 0) return 0;
      const timestamp = now();
      await tx.insert(transactionLinks).values(proposals.map(proposal => ({
        ...proposal,
        linkType: "funds" as const,
        status: "pending" as const,
        confidenceScore: 100,
        matchReason: "Exact GBP/USD amount; PayPal purchase 1–4 days before HSBC PAYPAL PAYMENT.",
        createdBy: "system_rule" as const,
        createdAt: timestamp,
        updatedAt: timestamp,
      })));
      return proposals.length;
    });
  }

  async listPayPalPaymentLinks(): Promise<PayPalPaymentLink[]> {
    const links = await this.db.select().from(transactionLinks).where(and(eq(transactionLinks.linkType, "funds"), eq(transactionLinks.createdBy, "system_rule"))).orderBy(asc(transactionLinks.status), asc(transactionLinks.id));
    if (links.length === 0) return [];
    const transactionRows = await this.db.select({ id: transactions.id, transactionDate: transactions.transactionDate, description: transactions.description, amountMinor: transactions.amountMinor, currencyCode: transactions.currencyCode }).from(transactions).where(inArray(transactions.id, links.flatMap(link => [link.fromTransactionId, link.toTransactionId])));
    const byId = new Map(transactionRows.map(transaction => [transaction.id, transaction]));
    return links.flatMap(link => {
      const hsbcTransaction = byId.get(link.fromTransactionId);
      const paypalTransaction = byId.get(link.toTransactionId);
      return hsbcTransaction && paypalTransaction ? [{ id: link.id, status: link.status, confidenceScore: link.confidenceScore, matchReason: link.matchReason, hsbcTransaction, paypalTransaction }] : [];
    });
  }

  async setPayPalPaymentLinkStatus(linkId: number, status: LinkStatus): Promise<PayPalPaymentLink> {
    const timestamp = now();
    await this.db.update(transactionLinks).set({ status, reviewedAt: status === "pending" ? null : timestamp, updatedAt: timestamp }).where(and(eq(transactionLinks.id, linkId), eq(transactionLinks.linkType, "funds"), eq(transactionLinks.createdBy, "system_rule")));
    const link = (await this.listPayPalPaymentLinks()).find(item => item.id === linkId);
    if (!link) throw new Error("PayPal payment link not found.");
    return link;
  }
}
