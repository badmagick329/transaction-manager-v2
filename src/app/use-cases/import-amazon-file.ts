import { amazonImportSchema } from "../contracts/amazon-orders";
import type { AmazonRepository } from "../ports/amazon-repository";
import type { ImportRepository } from "../ports/import-repository";
import type { ImportFileResult } from "./import-standard-file";

export async function importAmazonFile(repository: AmazonRepository, batches: ImportRepository, input: { fileName: string; fileHash: string; value: unknown }): Promise<ImportFileResult> {
  const existing = await batches.findBatchByFileHash(input.fileHash);
  if (existing?.status === "processed") return { kind: "duplicate", batchId: existing.id };
  try {
    const batch = await repository.importFile({ ...input, importFile: amazonImportSchema.parse(input.value) });
    return { kind: "processed", batchId: batch.id, recordCount: batch.recordCount, duplicateRecordCount: batch.duplicateRecordCount };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Amazon import failed";
    const batch = await batches.recordFailure({ ...input, errorMessage });
    return { kind: "failed", batchId: batch.id, errorMessage };
  }
}
