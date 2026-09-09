import { and, eq, isNull, lt } from "drizzle-orm";
import { recurringDescription, type PaymentMethodChange, type RecurringPaymentInput, type RecurringPaymentRepository } from "../../app/recurring-payments";
import type { AppDatabase } from "./client";
import { accounts, accountCoveragePeriods, cashFlowExclusions, recurringPayments, recurringPaymentLinks, recurringPaymentMethods, transactions } from "./schema";

// Keep user tracking decisions separate from immutable imported payment evidence.
export class DrizzleRecurringPaymentRepository implements RecurringPaymentRepository {
  constructor(private readonly db: AppDatabase) {}
  async snapshot() {
    const [payments, expenses, coverage, links, methods] = await Promise.all([
      this.db.select().from(recurringPayments),
      this.db.select({ id: transactions.id, accountId: transactions.accountId, currencyCode: transactions.currencyCode, description: transactions.description, amountMinor: transactions.amountMinor, transactionDate: transactions.transactionDate })
        .from(transactions).leftJoin(cashFlowExclusions, eq(cashFlowExclusions.transactionId, transactions.id))
        .where(and(eq(transactions.economicType, "expense"), eq(transactions.status, "posted"), lt(transactions.amountMinor, 0), isNull(cashFlowExclusions.id))),
      this.db.select({ accountId: accountCoveragePeriods.accountId, startDate: accountCoveragePeriods.startDate, endDate: accountCoveragePeriods.endDate }).from(accountCoveragePeriods),
      this.db.select().from(recurringPaymentLinks),
      this.db.select().from(recurringPaymentMethods),
    ]);
    return { payments, transactions: expenses, coverage, links, methods };
  }
  async changeMethod(input: PaymentMethodChange) {
    const payment = await this.db.select().from(recurringPayments).where(eq(recurringPayments.id, input.paymentId)).get();
    if (!payment || payment.status === "dismissed") throw new Error("Choose a tracked recurring payment.");
    const account = await this.db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!account) throw new Error("Account not found.");
    const { previousEffectiveDate, ...change } = input;
    const values = { ...change, description: recurringDescription(input.description) };
    if (previousEffectiveDate !== undefined) {
      const result = await this.db.update(recurringPaymentMethods).set(values).where(and(eq(recurringPaymentMethods.paymentId, input.paymentId), eq(recurringPaymentMethods.effectiveDate, previousEffectiveDate))).returning().get();
      if (!result) throw new Error("Payment-method change not found. Reload and try again.");
      return;
    }
    await this.db.insert(recurringPaymentMethods).values(values).onConflictDoUpdate({ target: [recurringPaymentMethods.paymentId, recurringPaymentMethods.effectiveDate], set: values });
  }
  async link(transactionId: number, paymentId: number) {
    const snapshot = await this.snapshot();
    const payment = snapshot.payments.find(p => p.id === paymentId && p.status !== "dismissed");
    const transaction = snapshot.transactions.find(t => t.id === transactionId);
    if (!payment || !transaction) throw new Error("Choose an existing recurring payment and an eligible expense.");
    if (payment.currencyCode !== transaction.currencyCode) throw new Error("Payment and transaction currencies must match.");
    await this.db.insert(recurringPaymentLinks).values({ transactionId, paymentId }).onConflictDoUpdate({ target: recurringPaymentLinks.transactionId, set: { paymentId } });
  }
  async save(input: RecurringPaymentInput, id?: number) {
    const account = await this.db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!account) throw new Error("Account not found.");
    if (id !== undefined) {
      const existing = await this.db.select().from(recurringPayments).where(eq(recurringPayments.id, id)).get();
      if (!existing) throw new Error("Recurring payment not found.");
      if (input.accountId !== existing.accountId || input.currencyCode !== existing.currencyCode || input.anchorDate !== existing.anchorDate || input.frequency !== existing.frequency || input.amountMinor !== existing.amountMinor) throw new Error("Use Change matching or billing to record a dated change without rewriting history. Currency cannot be changed.");
      const result = await this.db.update(recurringPayments).set(input).where(eq(recurringPayments.id, id)).returning().get();
      if (!result) throw new Error("Recurring payment not found.");
      return result;
    }
    const existing = await this.db.select().from(recurringPayments).where(and(eq(recurringPayments.accountId, input.accountId), eq(recurringPayments.currencyCode, input.currencyCode), eq(recurringPayments.description, input.description), eq(recurringPayments.frequency, input.frequency), eq(recurringPayments.anchorDate, input.anchorDate))).get();
    if (existing) throw new Error("This recurring payment already exists. Edit the existing entry.");
    return this.db.insert(recurringPayments).values(input).returning().get();
  }
}
