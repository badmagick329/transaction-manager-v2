import { z } from "zod";
import { sourceKinds, transactionStatuses, transactionTypes } from "../../core/finance/constants";

const accountContextSchema = z.object({
  externalId: z.string().min(1).nullable(),
  name: z.string().min(1),
  currencyCode: z.string().length(3).toUpperCase(),
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");

const coveragePeriodSchema = z.object({
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  account: accountContextSchema.nullable(),
}).refine(period => period.startDate <= period.endDate, {
  message: "Coverage startDate must be on or before endDate.",
  path: ["endDate"],
});

export const standardImportRecordSchema = z.object({
  account: accountContextSchema.nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  amountMinor: z.number().int(),
  currencyCode: z.string().length(3).toUpperCase(),
  transactionDate: z.string().min(1),
  postedDate: z.string().min(1).nullable().optional(),
  description: z.string().min(1),
  rawDescription: z.string().nullable().optional(),
  balanceMinor: z.number().int().nullable().optional(),
  transactionType: z.enum(transactionTypes).nullable().optional(),
  status: z.enum(transactionStatuses).default("posted"),
  merchant: z.string().min(1).nullable().optional(),
  reference: z.string().min(1).nullable().optional(),
  counterparty: z.string().min(1).nullable().optional(),
  feeMinor: z.number().int().nullable().optional(),
  fxOriginalAmountMinor: z.number().int().nullable().optional(),
  fxOriginalCurrencyCode: z.string().length(3).toUpperCase().nullable().optional(),
  notes: z.string().nullable().optional(),
  rawPayload: z.record(z.unknown()),
});

export const standardImportFileSchema = z.object({
  source: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(sourceKinds),
    fileName: z.string().min(1),
    exportedAt: z.string().nullable().optional(),
    account: accountContextSchema.nullable().optional(),
    coveragePeriods: z.array(coveragePeriodSchema).optional(),
  }),
  records: z.array(standardImportRecordSchema),
}).superRefine((file, context) => {
  if (file.source.account) return;

  file.records.forEach((record, index) => {
    if (!record.account) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["records", index, "account"],
        message: "An account is required when source.account is not provided.",
      });
    }
  });
});

export type StandardImportFile = z.infer<typeof standardImportFileSchema>;
export type StandardImportRecord = z.infer<typeof standardImportRecordSchema>;
