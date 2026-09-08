import { and, eq, isNull, lt } from "drizzle-orm";
import type { RecurringPaymentInput, RecurringPaymentRepository } from "../../app/recurring-payments";
import type { AppDatabase } from "./client";
import { accounts, accountCoveragePeriods, cashFlowExclusions, recurringPayments, recurringPaymentLinks, transactions } from "./schema";

// Keep user tracking decisions separate from immutable imported payment evidence.
export class DrizzleRecurringPaymentRepository implements RecurringPaymentRepository {
  constructor(private readonly db: AppDatabase) {}
  async snapshot() {
    const [payments, expenses, coverage, links] = await Promise.all([
      this.db.select().from(recurringPayments),
      this.db.select({ id: transactions.id, accountId: transactions.accountId, currencyCode: transactions.currencyCode, description: transactions.description, amountMinor: transactions.amountMinor, transactionDate: transactions.transactionDate })
        .from(transactions).leftJoin(cashFlowExclusions, eq(cashFlowExclusions.transactionId, transactions.id))
        .where(and(eq(transactions.economicType, "expense"), eq(transactions.status, "posted"), lt(transactions.amountMinor, 0), isNull(cashFlowExclusions.id))),
      this.db.select({ accountId: accountCoveragePeriods.accountId, startDate: accountCoveragePeriods.startDate, endDate: accountCoveragePeriods.endDate }).from(accountCoveragePeriods),
      this.db.select().from(recurringPaymentLinks),
    ]);
    return { payments, transactions: expenses, coverage, links };
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
      const result = await this.db.update(recurringPayments).set(input).where(eq(recurringPayments.id, id)).returning().get();
      if (!result) throw new Error("Recurring payment not found.");
      return result;
    }
    const existing = await this.db.select().from(recurringPayments).where(and(eq(recurringPayments.accountId, input.accountId), eq(recurringPayments.currencyCode, input.currencyCode), eq(recurringPayments.description, input.description), eq(recurringPayments.frequency, input.frequency), eq(recurringPayments.anchorDate, input.anchorDate))).get();
    if (existing) throw new Error("This recurring payment already exists. Edit the existing entry.");
    return this.db.insert(recurringPayments).values(input).returning().get();
  }
}
