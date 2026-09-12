import { and, eq, isNull, lt } from "drizzle-orm";
import { recurringOverview, type RecurringTransactionDecision, type RecurringSpendingControl, recurringDescription, type PaymentMethodChange, type RecurringPaymentInput, type RecurringPaymentRepository } from "../../app/recurring-payments";
import type { AppDatabase } from "./client";
import { accounts, accountCoveragePeriods, cashFlowExclusions, recurringPayments, recurringSpendingControls, recurringTransactionDecisions, recurringPaymentLinks, recurringPaymentMethods, transactions } from "./schema";

// Keep user tracking decisions separate from immutable imported payment evidence.
export class DrizzleRecurringPaymentRepository implements RecurringPaymentRepository {
  constructor(private readonly db: AppDatabase) {}
  async snapshot() { return this.snapshotSync(); }
  // Synchronous access lets review evidence and its write share one SQLite transaction.
  snapshotSync() {
    const [payments, expenses, coverage, links, methods] = [
      this.db.select().from(recurringPayments).all(),
      this.db.select({ id: transactions.id, accountId: transactions.accountId, currencyCode: transactions.currencyCode, description: transactions.description, amountMinor: transactions.amountMinor, transactionDate: transactions.transactionDate })
        .from(transactions).leftJoin(cashFlowExclusions, eq(cashFlowExclusions.transactionId, transactions.id))
        .where(and(eq(transactions.economicType, "expense"), eq(transactions.status, "posted"), lt(transactions.amountMinor, 0), isNull(cashFlowExclusions.id))).all(),
      this.db.select({ accountId: accountCoveragePeriods.accountId, startDate: accountCoveragePeriods.startDate, endDate: accountCoveragePeriods.endDate }).from(accountCoveragePeriods).all(),
      this.db.select().from(recurringPaymentLinks).all(),
      this.db.select().from(recurringPaymentMethods).all(),
    ];
    return { spendingControls: this.db.select().from(recurringSpendingControls).all(), payments, transactions: expenses, coverage, links, methods, transactionDecisions: this.db.select().from(recurringTransactionDecisions).all() };
  }
  async setSpendingControl(input: RecurringSpendingControl) {
    const payment = this.db.select().from(recurringPayments).where(eq(recurringPayments.id, input.paymentId)).get();
    if (!payment || payment.status === "dismissed") throw new Error("Choose a tracked recurring payment.");
    if (input.control === "unclassified") {
      this.db.delete(recurringSpendingControls).where(eq(recurringSpendingControls.paymentId, input.paymentId)).run();
    } else {
      this.db.insert(recurringSpendingControls).values(input).onConflictDoUpdate({ target: recurringSpendingControls.paymentId, set: input }).run();
    }
  }
  // Decisions belong to one payment and charge; imported amounts and future warnings stay untouched.
  async setTransactionDecision(input: RecurringTransactionDecision) {
    this.db.transaction(() => {
      const payment = recurringOverview(this.snapshotSync()).payments.find(p => p.id === input.paymentId && p.status !== "dismissed");
      if (!payment?.transactions.some(t => t.id === input.transactionId)) throw new Error("Choose a transaction attached to this recurring payment.");
      if (!input.oneOff && !input.priceWarningDismissed) {
        this.db.delete(recurringTransactionDecisions).where(and(eq(recurringTransactionDecisions.paymentId, input.paymentId), eq(recurringTransactionDecisions.transactionId, input.transactionId))).run();
        return;
      }
      if (input.oneOff) this.linkSync(input.transactionId, input.paymentId);
      this.db.insert(recurringTransactionDecisions).values(input).onConflictDoUpdate({ target: [recurringTransactionDecisions.paymentId, recurringTransactionDecisions.transactionId], set: input }).run();
    });
  }
  async changeMethod(input: PaymentMethodChange) { this.changeMethodSync(input); }
  changeMethodSync(input: PaymentMethodChange) {
    const payment = this.db.select().from(recurringPayments).where(eq(recurringPayments.id, input.paymentId)).get();
    if (!payment || payment.status === "dismissed") throw new Error("Choose a tracked recurring payment.");
    const account = this.db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!account) throw new Error("Account not found.");
    const { previousEffectiveDate, ...change } = input;
    const values = { ...change, description: recurringDescription(input.description) };
    if (previousEffectiveDate !== undefined) {
      const result = this.db.update(recurringPaymentMethods).set(values).where(and(eq(recurringPaymentMethods.paymentId, input.paymentId), eq(recurringPaymentMethods.effectiveDate, previousEffectiveDate))).returning().get();
      if (!result) throw new Error("Payment-method change not found. Reload and try again.");
      return;
    }
    this.db.insert(recurringPaymentMethods).values(values).onConflictDoUpdate({ target: [recurringPaymentMethods.paymentId, recurringPaymentMethods.effectiveDate], set: values }).run();
  }
  async link(transactionId: number, paymentId: number) { this.linkSync(transactionId, paymentId); }
  linkSync(transactionId: number, paymentId: number) {
    const snapshot = this.snapshotSync();
    const payment = snapshot.payments.find(p => p.id === paymentId && p.status !== "dismissed");
    const transaction = snapshot.transactions.find(t => t.id === transactionId);
    if (!payment || !transaction) throw new Error("Choose an existing recurring payment and an eligible expense.");
    if (payment.currencyCode !== transaction.currencyCode) throw new Error("Payment and transaction currencies must match.");
    this.db.insert(recurringPaymentLinks).values({ transactionId, paymentId }).onConflictDoUpdate({ target: recurringPaymentLinks.transactionId, set: { paymentId } }).run();
  }
  async save(input: RecurringPaymentInput, id?: number) { return this.saveSync(input, id); }
  saveSync(input: RecurringPaymentInput, id?: number) {
    const account = this.db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!account) throw new Error("Account not found.");
    if (id !== undefined) {
      const existing = this.db.select().from(recurringPayments).where(eq(recurringPayments.id, id)).get();
      if (!existing) throw new Error("Recurring payment not found.");
      if (input.accountId !== existing.accountId || input.currencyCode !== existing.currencyCode || input.anchorDate !== existing.anchorDate || input.frequency !== existing.frequency || input.amountMinor !== existing.amountMinor) throw new Error("Use Change matching or billing to record a dated change without rewriting history. Currency cannot be changed.");
      const result = this.db.update(recurringPayments).set(input).where(eq(recurringPayments.id, id)).returning().get();
      if (!result) throw new Error("Recurring payment not found.");
      return result;
    }
    const existing = this.db.select().from(recurringPayments).where(and(eq(recurringPayments.accountId, input.accountId), eq(recurringPayments.currencyCode, input.currencyCode), eq(recurringPayments.description, input.description), eq(recurringPayments.frequency, input.frequency), eq(recurringPayments.anchorDate, input.anchorDate))).get();
    if (existing) throw new Error("This recurring payment already exists. Edit the existing entry.");
    return this.db.insert(recurringPayments).values(input).returning().get();
  }
}
