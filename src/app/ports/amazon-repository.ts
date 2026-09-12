import type { AmazonImport, AmazonLinkInput, AmazonOrder } from "../contracts/amazon-orders";
import type { AmazonSnapshot, Mapping } from "../amazon-orders";
import type { ImportBatchSummary } from "./import-repository";

export type AmazonEvidence = {
  revisions: Array<{ id: number; orderId: number; data: AmazonOrder; incomingData: AmazonOrder; source: AmazonImport["source"]; fingerprint: string; status: "accepted" | "pending" | "rejected"; createdAt: string }>;
  history: Array<{ id: number; orderId: number | null; action: string; detail: unknown; createdAt: string }>;
};
export interface AmazonRepository {
  snapshot(): AmazonSnapshot;
  evidence(orderId: number): AmazonEvidence;
  importFile(input: { fileName: string; fileHash: string; importFile: AmazonImport }): Promise<ImportBatchSummary>;
  reviewLink(input: AmazonLinkInput): void;
  reviewRevision(revisionId: number, accept: boolean): void;
  saveMapping(mapping: Mapping): void;
}
