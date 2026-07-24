import { createHash } from "node:crypto";
import type { ImportRepository, ProcessedImportFile, ResolvedImportRecord } from "../ports/import-repository";
import { standardImportFileSchema, type StandardImportFile } from "../contracts/standard-import";

export type ImportFileResult =
  | { kind: "processed"; batchId: number; recordCount: number; duplicateRecordCount: number }
  | { kind: "duplicate"; batchId: number }
  | { kind: "failed"; batchId: number; errorMessage: string };

export function parseStandardImportFile(value: unknown): StandardImportFile {
  return standardImportFileSchema.parse(value);
}

export function resolveImportRecordAccounts(importFile: StandardImportFile): ResolvedImportRecord[] {
  return importFile.records.map(record => ({
    ...record,
    account: record.account ?? importFile.source.account!,
  }));
}

export function createSourceRecordHash(record: ResolvedImportRecord): string {
  if (record.externalId) return `external:${record.externalId}`;

  const fingerprint = JSON.stringify({
    account: record.account,
    amountMinor: record.amountMinor,
    currencyCode: record.currencyCode,
    transactionDate: record.transactionDate,
    postedDate: record.postedDate ?? null,
    description: record.description,
    rawDescription: record.rawDescription ?? null,
    merchant: record.merchant ?? null,
    reference: record.reference ?? null,
    counterparty: record.counterparty ?? null,
    feeMinor: record.feeMinor ?? null,
    fxOriginalAmountMinor: record.fxOriginalAmountMinor ?? null,
    fxOriginalCurrencyCode: record.fxOriginalCurrencyCode ?? null,
  });

  return createHash("sha256").update(fingerprint).digest("hex");
}

export async function importStandardFile(
  repository: ImportRepository,
  input: ProcessedImportFile,
): Promise<ImportFileResult> {
  const existingBatch = await repository.findBatchByFileHash(input.fileHash);
  if (existingBatch?.status === "processed") return { kind: "duplicate", batchId: existingBatch.id };

  try {
    const batch = await repository.importFile(input);
    return {
      kind: "processed",
      batchId: batch.id,
      recordCount: batch.recordCount,
      duplicateRecordCount: batch.duplicateRecordCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown import failure";
    const batch = await repository.recordFailure({
      fileName: input.fileName,
      fileHash: input.fileHash,
      errorMessage,
    });
    return { kind: "failed", batchId: batch.id, errorMessage };
  }
}
