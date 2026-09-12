import { recurringInputSchema, recurringMethodSchema } from "../../app/contracts/recurring-review";
import { z } from "zod";
import { recurringOverview, previewRecurringChange, type PaymentMethodChange, type RecurringPaymentInput, type RecurringPaymentRepository } from "../../app/recurring-payments";

const inputSchema = recurringInputSchema.extend({ id: z.number().int().positive().optional() });
const methodSchema = recurringMethodSchema;
export function createRecurringRoutes(repository: RecurringPaymentRepository) {
  return {
    "/api/recurring-payments/transaction-decision": {
      POST: async (request: Request) => {
        try {
          const input = z.object({ paymentId: z.number().int().positive(), transactionId: z.number().int().positive(), oneOff: z.boolean(), priceWarningDismissed: z.boolean() }).strict().parse(await request.json());
          await repository.setTransactionDecision(input);
          return Response.json({ ok: true });
        } catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Choose a payment, transaction, and valid decision." : error instanceof Error ? error.message : "Unable to save transaction decision." }, { status: 400 }); }
      },
    },
    "/api/recurring-payments/preview": {
      POST: async (request: Request) => {
        try {
          const { id = -1, linkedTransactionId, ...input } = inputSchema.extend({ linkedTransactionId: z.number().int().positive().optional() }).parse(await request.json());
          const before = await repository.snapshot();
          if (id !== -1 && !before.payments.some(p => p.id === id)) throw new Error("Recurring payment not found.");
          const after = { ...before, payments: [...before.payments.filter(p => p.id !== id), { ...input as RecurringPaymentInput, id }] };
          if (linkedTransactionId !== undefined) {
            if (!before.transactions.some(t => t.id === linkedTransactionId && t.currencyCode === input.currencyCode)) throw new Error("Choose an eligible expense in the subscription currency.");
            after.links = [...before.links.filter(l => l.transactionId !== linkedTransactionId), { transactionId: linkedTransactionId, paymentId: id }];
          }
          return Response.json(previewRecurringChange(before, after, id));
        } catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Check the matching rule and billing details." : error instanceof Error ? error.message : "Unable to preview." }, { status: 400 }); }
      },
    },
    "/api/recurring-payments/method/preview": {
      POST: async (request: Request) => {
        try {
          const input = methodSchema.parse(await request.json()) as PaymentMethodChange;
          const before = await repository.snapshot();
          if (!before.payments.some(p => p.id === input.paymentId && p.status !== "dismissed")) throw new Error("Choose a tracked recurring payment.");
          const after = { ...before, methods: [...before.methods.filter(m => m.paymentId !== input.paymentId || m.effectiveDate !== (input.previousEffectiveDate ?? input.effectiveDate)), input] };
          return Response.json(previewRecurringChange(before, after, input.paymentId));
        } catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Check the matching rule and billing details." : error instanceof Error ? error.message : "Unable to preview." }, { status: 400 }); }
      },
    },
    "/api/recurring-payments/method": {
      POST: async (request: Request) => {
        try {
          const input = methodSchema.parse(await request.json());
          await repository.changeMethod(input as import("../../app/recurring-payments").PaymentMethodChange);
          return Response.json({ ok: true });
        } catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Choose a payment, account, description, and valid switch date." : error instanceof Error ? error.message : "Unable to change payment method." }, { status: 400 }); }
      },
    },
    "/api/recurring-payments/link": {
      POST: async (request: Request) => {
        try {
          const { transactionId, paymentId } = z.object({ transactionId: z.number().int().positive(), paymentId: z.number().int().positive() }).parse(await request.json());
          await repository.link(transactionId, paymentId);
          return Response.json({ ok: true });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to link payment." }, { status: 400 }); }
      },
    },
    "/api/recurring-payments": {
      GET: async () => Response.json(recurringOverview(await repository.snapshot())),
      POST: async (request: Request) => {
        try {
          const { id, ...input } = inputSchema.parse(await request.json());
          return Response.json(await repository.save(input as RecurringPaymentInput, id));
        } catch (error) {
          return Response.json({ error: error instanceof z.ZodError ? "Check the name, account, amount, currency, and billing date." : error instanceof Error ? error.message : "Unable to save recurring payment." }, { status: 400 });
        }
      },
    },
    "/api/recurring-payments/seed": {
      GET: async (request: Request) => {
        const id = Number(new URL(request.url).searchParams.get("id"));
        const transaction = (await repository.snapshot()).transactions.find(t => t.id === id);
        return transaction ? Response.json(transaction) : Response.json({ error: "Choose a posted expense that is included in cash flow." }, { status: 400 });
      },
    },
  };
}
