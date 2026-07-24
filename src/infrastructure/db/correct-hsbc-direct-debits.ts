import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "./client";
import { rawRecords, sources, transactionTypeCorrections, transactions } from "./schema";

type ImportedRecordPayload = {
  record?: {
    rawPayload?: {
      original_row?: {
        paymentType?: unknown;
      };
    };
  };
};

function isHsbcDirectDebit(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as ImportedRecordPayload;
    return payload.record?.rawPayload?.original_row?.paymentType === "DD";
  } catch {
    return false;
  }
}

export async function correctHsbcDirectDebitTransfers(db: AppDatabase) {
  return db.transaction(async tx => {
    const candidates = await tx
      .select({
        transactionId: transactions.id,
        payloadJson: rawRecords.payloadJson,
      })
      .from(transactions)
      .innerJoin(rawRecords, eq(transactions.rawRecordId, rawRecords.id))
      .innerJoin(sources, eq(transactions.sourceId, sources.id))
      .where(and(eq(sources.slug, "hsbc"), eq(transactions.transactionType, "transfer")));

    const directDebits = candidates.filter(candidate => isHsbcDirectDebit(candidate.payloadJson));
    const timestamp = new Date().toISOString();

    for (const transaction of directDebits) {
      await tx
        .update(transactions)
        .set({ transactionType: "direct_debit", updatedAt: timestamp })
        .where(eq(transactions.id, transaction.transactionId));
      await tx.insert(transactionTypeCorrections).values({
        transactionId: transaction.transactionId,
        previousType: "transfer",
        correctedType: "direct_debit",
        reason: "HSBC source record paymentType is DD (direct debit).",
        createdAt: timestamp,
      });
    }

    return directDebits.length;
  });
}
