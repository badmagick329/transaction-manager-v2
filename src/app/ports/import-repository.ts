import type { StandardImportFile, StandardImportRecord } from "../contracts/standard-import";

export type ImportBatchSummary = {
  id: number;
  status: "processed" | "failed";
  fileName: string;
  recordCount: number;
  duplicateRecordCount: number;
  errorMessage: string | null;
  attemptCount: number;
};

export type ProcessedImportFile = {
  fileName: string;
  fileHash: string;
  importFile: StandardImportFile;
};

export type ImportRepository = {
  findBatchByFileHash(fileHash: string): Promise<ImportBatchSummary | null>;
  importFile(input: ProcessedImportFile): Promise<ImportBatchSummary>;
  recordFailure(input: { fileName: string; fileHash: string; errorMessage: string }): Promise<ImportBatchSummary>;
};

export type ResolvedImportRecord = StandardImportRecord & {
  account: {
    externalId: string | null;
    name: string;
    currencyCode: string;
  };
};
