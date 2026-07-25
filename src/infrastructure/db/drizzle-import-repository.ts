import { and, desc, eq } from "drizzle-orm";
import { descriptionMatchesRule, economicDirectionForAmount, normalizeDescription, ruleMatchPriority } from "../../app/classification";
import type { ImportBatchSummary, ImportRepository, ProcessedImportFile, ResolvedImportRecord } from "../../app/ports/import-repository";
import { createSourceRecordHash, resolveImportRecordAccounts } from "../../app/use-cases/import-standard-file";
import type { AppDatabase } from "./client";
import { accounts, classificationRules, economicClassificationAudits, importAttempts, importBatches, rawRecords, sources, transactions } from "./schema";

const now = () => new Date().toISOString();

function toSummary(row: typeof importBatches.$inferSelect): ImportBatchSummary {
  return {
    id: row.id,
    status: row.status === "failed" ? "failed" : "processed",
    fileName: row.fileName,
    recordCount: row.recordCount,
    duplicateRecordCount: row.duplicateRecordCount,
    errorMessage: row.errorMessage,
    attemptCount: row.attemptCount,
  };
}

export class DrizzleImportRepository implements ImportRepository {
  constructor(private readonly db: AppDatabase) {}

  async findBatchByFileHash(fileHash: string): Promise<ImportBatchSummary | null> {
    const row = await this.db.query.importBatches.findFirst({
      where: eq(importBatches.fileHash, fileHash),
      orderBy: [desc(importBatches.id)],
    });
    return row ? toSummary(row) : null;
  }

  async importFile(input: ProcessedImportFile): Promise<ImportBatchSummary> {
    if (input.importFile.source.kind !== "bank" && input.importFile.source.kind !== "credit_card" && input.importFile.source.kind !== "robinhood" && input.importFile.source.kind !== "trading212") {
      throw new Error("Only bank, credit-card, Robinhood, and Trading 212 imports are supported in this version.");
    }

    return this.db.transaction(async tx => {
      const timestamp = now();
      const existingBatch = await tx.query.importBatches.findFirst({
        where: eq(importBatches.fileHash, input.fileHash),
      });
      let batch: typeof importBatches.$inferSelect;
      let attemptNumber: number;

      if (existingBatch) {
        if (existingBatch.status !== "failed") {
          throw new Error("This file has already been imported.");
        }
        attemptNumber = existingBatch.attemptCount + 1;
        [batch] = await tx
          .update(importBatches)
          .set({
            fileName: input.fileName,
            status: "pending",
            attemptCount: attemptNumber,
            recordCount: input.importFile.records.length,
            duplicateRecordCount: 0,
            errorMessage: null,
            importedAt: null,
            updatedAt: timestamp,
          })
          .where(eq(importBatches.id, existingBatch.id))
          .returning();
      } else {
        attemptNumber = 1;
        [batch] = await tx
          .insert(importBatches)
          .values({
            fileName: input.fileName,
            fileHash: input.fileHash,
            status: "pending",
            attemptCount: attemptNumber,
            recordCount: input.importFile.records.length,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
      }

      const [attempt] = await tx
        .insert(importAttempts)
        .values({
          importBatchId: batch.id,
          attemptNumber,
          status: "pending",
          startedAt: timestamp,
        })
        .returning();

      const { source, isNew: isNewSource } = await this.findOrCreateSource(tx, input.importFile.source);
      if (isNewSource && input.importFile.source.kind === "trading212") {
        await this.createTrading212DefaultRules(tx, source.id);
      }
      const sourceRules = await tx.select().from(classificationRules).where(eq(classificationRules.sourceId, source.id));
      const records = resolveImportRecordAccounts(input.importFile);
      let duplicateRecordCount = 0;

      for (const record of records) {
        const sourceRecordHash = createSourceRecordHash(record);
        const existingRawRecord = await tx.query.rawRecords.findFirst({
          where: and(eq(rawRecords.sourceId, source.id), eq(rawRecords.sourceRecordHash, sourceRecordHash)),
        });

        if (existingRawRecord) {
          duplicateRecordCount += 1;
          continue;
        }

        const account = await this.findOrCreateAccount(tx, source.id, record, input.importFile.source.kind);
        const [rawRecord] = await tx
          .insert(rawRecords)
          .values({
            importBatchId: batch.id,
            sourceId: source.id,
            externalId: record.externalId ?? null,
            sourceRecordHash,
            payloadJson: JSON.stringify({ source: input.importFile.source, record }),
            createdAt: timestamp,
          })
          .returning();

        const direction = economicDirectionForAmount(record.amountMinor);
        const classificationRule = sourceRules
          .filter(rule => rule.direction === direction)
          .filter(rule => descriptionMatchesRule(record.description, rule.normalizedDescription, rule.matchMode))
          .sort(
            (left, right) =>
              ruleMatchPriority(right.matchMode) - ruleMatchPriority(left.matchMode) ||
              right.normalizedDescription.length - left.normalizedDescription.length ||
              right.id - left.id,
          )[0];
        const economicType = classificationRule?.economicType ?? "unclassified";
        const [transaction] = await tx.insert(transactions).values({
          sourceId: source.id,
          accountId: account.id,
          rawRecordId: rawRecord.id,
          externalId: record.externalId ?? null,
          sourceTransactionHash: sourceRecordHash,
          transactionType: record.transactionType ?? "unclassified",
          economicType,
          status: record.status,
          amountMinor: record.amountMinor,
          currencyCode: record.currencyCode,
          transactionDate: record.transactionDate,
          postedDate: record.postedDate ?? null,
          description: record.description,
          rawDescription: record.rawDescription ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }).returning();
        if (classificationRule) {
          await tx.insert(economicClassificationAudits).values({
            transactionId: transaction.id,
            classificationRuleId: classificationRule.id,
            previousEconomicType: "unclassified",
            newEconomicType: economicType,
            reason: "rule_applied_on_import",
            createdAt: timestamp,
          });
        }
      }

      const completedAt = now();
      await tx
        .update(importAttempts)
        .set({ status: "processed", completedAt })
        .where(eq(importAttempts.id, attempt.id));

      const [processedBatch] = await tx
        .update(importBatches)
        .set({
          status: "processed",
          duplicateRecordCount,
          importedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(importBatches.id, batch.id))
        .returning();

      return toSummary(processedBatch);
    });
  }

  async recordFailure(input: { fileName: string; fileHash: string; errorMessage: string }): Promise<ImportBatchSummary> {
    return this.db.transaction(async tx => {
      const timestamp = now();
      const existingBatch = await tx.query.importBatches.findFirst({
        where: eq(importBatches.fileHash, input.fileHash),
      });
      let batch: typeof importBatches.$inferSelect;
      let attemptNumber: number;

      if (existingBatch) {
        if (existingBatch.status === "processed") return toSummary(existingBatch);
        attemptNumber = existingBatch.attemptCount + 1;
        [batch] = await tx
          .update(importBatches)
          .set({
            fileName: input.fileName,
            status: "failed",
            attemptCount: attemptNumber,
            errorMessage: input.errorMessage,
            updatedAt: timestamp,
          })
          .where(eq(importBatches.id, existingBatch.id))
          .returning();
      } else {
        attemptNumber = 1;
        [batch] = await tx
          .insert(importBatches)
          .values({
            fileName: input.fileName,
            fileHash: input.fileHash,
            status: "failed",
            attemptCount: attemptNumber,
            errorMessage: input.errorMessage,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
      }

      await tx.insert(importAttempts).values({
        importBatchId: batch.id,
        attemptNumber,
        status: "failed",
        errorMessage: input.errorMessage,
        startedAt: timestamp,
        completedAt: timestamp,
      });

      return toSummary(batch);
    });
  }

  private async findOrCreateSource(
    db: AppDatabase,
    sourceInput: ProcessedImportFile["importFile"]["source"],
  ) {
    const existing = await db.query.sources.findFirst({ where: eq(sources.slug, sourceInput.slug) });
    if (existing) return { source: existing, isNew: false };

    const timestamp = now();
    const [source] = await db
      .insert(sources)
      .values({
        slug: sourceInput.slug,
        name: sourceInput.name,
        kind: sourceInput.kind,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return { source, isNew: true };
  }

  private async createTrading212DefaultRules(db: AppDatabase, sourceId: number) {
    const timestamp = now();
    await db.insert(classificationRules).values([
      { sourceId, normalizedDescription: "*", matchMode: "all", direction: "inflow", economicType: "transfer", createdAt: timestamp, updatedAt: timestamp },
      { sourceId, normalizedDescription: "*", matchMode: "all", direction: "outflow", economicType: "transfer", createdAt: timestamp, updatedAt: timestamp },
      { sourceId, normalizedDescription: normalizeDescription("Card purchase"), matchMode: "starts_with", direction: "outflow", economicType: "expense", createdAt: timestamp, updatedAt: timestamp },
      { sourceId, normalizedDescription: normalizeDescription("Card cashback"), matchMode: "starts_with", direction: "inflow", economicType: "income", createdAt: timestamp, updatedAt: timestamp },
    ]);
  }

  private async findOrCreateAccount(
    db: AppDatabase,
    sourceId: number,
    record: ResolvedImportRecord,
    sourceKind: ProcessedImportFile["importFile"]["source"]["kind"],
  ) {
    const identity = record.account.externalId
      ? and(eq(accounts.sourceId, sourceId), eq(accounts.externalId, record.account.externalId))
      : and(
          eq(accounts.sourceId, sourceId),
          eq(accounts.name, record.account.name),
          eq(accounts.currencyCode, record.account.currencyCode),
        );
    const existing = await db.query.accounts.findFirst({ where: identity });
    if (existing) return existing;

    const timestamp = now();
    const [account] = await db
      .insert(accounts)
      .values({
        sourceId,
        externalId: record.account.externalId,
        name: record.account.name,
        kind: sourceKind === "credit_card" ? "credit_card" : sourceKind === "robinhood" || sourceKind === "trading212" ? "investment_portfolio" : "bank_account",
        currencyCode: record.account.currencyCode,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return account;
  }
}
