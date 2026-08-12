import { and, desc, eq, inArray } from "drizzle-orm";
import { automaticEconomicType, descriptionMatchesRule, economicDirectionForAmount, ruleMatchPriority } from "../../app/classification";
import type { ImportBatchSummary, ImportRepository, ProcessedImportFile, ResolvedImportRecord } from "../../app/ports/import-repository";
import { createSourceRecordHash, resolveImportRecordAccounts } from "../../app/use-cases/import-standard-file";
import type { AppDatabase } from "./client";
import { ensureTrading212DefaultRules } from "./ensure-trading212-default-rules";
import { applyTagRulesForTransactions } from "./drizzle-tagging-repository";
import { accounts, classificationRules, economicClassificationAudits, importAttempts, importBatches, rawRecords, sources, transactions } from "./schema";

const now = () => new Date().toISOString();
const insertBatchSize = 100;

function inBatches<T>(items: T[], size = insertBatchSize) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function accountKey(account: ResolvedImportRecord["account"]) {
  return account.externalId ? `external:${account.externalId}` : `name:${account.name}\u0000${account.currencyCode}`;
}

function accountKindForSource(sourceKind: ProcessedImportFile["importFile"]["source"]["kind"]) {
  return sourceKind === "credit_card" ? "credit_card" : sourceKind === "robinhood" || sourceKind === "trading212" ? "investment_portfolio" : "bank_account";
}

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
    if (input.importFile.source.kind !== "bank" && input.importFile.source.kind !== "credit_card" && input.importFile.source.kind !== "paypal" && input.importFile.source.kind !== "robinhood" && input.importFile.source.kind !== "trading212") {
      throw new Error("Only bank, credit-card, PayPal, Robinhood, and Trading 212 imports are supported in this version.");
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
        await ensureTrading212DefaultRules(tx, source.id);
      }
      const sourceRules = await tx.select().from(classificationRules).where(eq(classificationRules.sourceId, source.id));
      const records = resolveImportRecordAccounts(input.importFile);
      const existingAccounts = await tx.select().from(accounts).where(eq(accounts.sourceId, source.id));
      const accountsByKey = new Map(existingAccounts.map(account => [account.externalId ? `external:${account.externalId}` : `name:${account.name}\u0000${account.currencyCode}`, account]));
      const missingAccountInputs = new Map<string, ResolvedImportRecord["account"]>();
      for (const record of records) {
        const key = accountKey(record.account);
        if (!accountsByKey.has(key)) missingAccountInputs.set(key, record.account);
      }
      if (missingAccountInputs.size > 0) {
        const createdAccounts = await tx
          .insert(accounts)
          .values([...missingAccountInputs.values()].map(account => ({
            sourceId: source.id,
            externalId: account.externalId,
            name: account.name,
            kind: accountKindForSource(input.importFile.source.kind),
            currencyCode: account.currencyCode,
            createdAt: timestamp,
            updatedAt: timestamp,
          })))
          .returning();
        for (const account of createdAccounts) {
          accountsByKey.set(account.externalId ? `external:${account.externalId}` : `name:${account.name}\u0000${account.currencyCode}`, account);
        }
      }

      const recordsWithHashes = records.map(record => ({ record, sourceRecordHash: createSourceRecordHash(record) }));
      const existingSourceRecordHashes = await this.findExistingSourceRecordHashes(tx, source.id, recordsWithHashes.map(item => item.sourceRecordHash));
      let duplicateRecordCount = 0;
      const seenSourceRecordHashes = new Set(existingSourceRecordHashes);
      const newRecords = [] as Array<{ record: ResolvedImportRecord; sourceRecordHash: string; accountId: number; classificationRule: typeof classificationRules.$inferSelect | undefined; economicType: typeof transactions.$inferInsert.economicType }>;
      for (const { record, sourceRecordHash } of recordsWithHashes) {
        if (seenSourceRecordHashes.has(sourceRecordHash)) {
          duplicateRecordCount += 1;
          continue;
        }
        seenSourceRecordHashes.add(sourceRecordHash);
        const account = accountsByKey.get(accountKey(record.account));
        if (!account) throw new Error(`Unable to resolve account for ${record.description}.`);
        const direction = economicDirectionForAmount(record.amountMinor);
        const matchingRules = sourceRules
          .filter(rule => rule.direction === direction)
          .filter(rule => descriptionMatchesRule(record.description, rule.normalizedDescription, rule.matchMode))
          .sort(
            (left, right) =>
              ruleMatchPriority(right.matchMode) - ruleMatchPriority(left.matchMode) ||
              right.normalizedDescription.length - left.normalizedDescription.length ||
              right.id - left.id,
          );
        const classificationRule = matchingRules[0];
        const specificRule = matchingRules.find(rule => rule.matchMode !== "all");
        const automaticType = automaticEconomicType(source.slug, record.transactionType ?? "unclassified", record.amountMinor);
        const economicType = specificRule?.economicType ?? automaticType ?? classificationRule?.economicType ?? "unclassified";
        newRecords.push({ record, sourceRecordHash, accountId: account.id, classificationRule: specificRule ?? (automaticType ? undefined : classificationRule), economicType });
      }

      for (const recordsBatch of inBatches(newRecords)) {
        const insertedRawRecords = await tx
          .insert(rawRecords)
          .values(recordsBatch.map(({ record, sourceRecordHash }) => ({
            importBatchId: batch.id,
            sourceId: source.id,
            externalId: record.externalId ?? null,
            sourceRecordHash,
            payloadJson: JSON.stringify({ source: input.importFile.source, record }),
            createdAt: timestamp,
          })))
          .returning({ id: rawRecords.id, sourceRecordHash: rawRecords.sourceRecordHash });
        const rawRecordIdsByHash = new Map(insertedRawRecords.map(rawRecord => [rawRecord.sourceRecordHash, rawRecord.id]));
        await tx.insert(transactions).values(recordsBatch.map(({ record, sourceRecordHash, accountId, economicType }) => ({
          sourceId: source.id,
          accountId,
          rawRecordId: rawRecordIdsByHash.get(sourceRecordHash),
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
        })));
        const transactionRows = await tx
          .select({ id: transactions.id, sourceTransactionHash: transactions.sourceTransactionHash })
          .from(transactions)
          .where(and(eq(transactions.sourceId, source.id), inArray(transactions.sourceTransactionHash, recordsBatch.map(item => item.sourceRecordHash))));
        const transactionIdsByHash = new Map(transactionRows.map(transaction => [transaction.sourceTransactionHash, transaction.id]));
        await applyTagRulesForTransactions(tx, source.id, transactionRows.map(transaction => transaction.id));
        const audits = recordsBatch.flatMap(({ sourceRecordHash, classificationRule, economicType }) => {
          const transactionId = transactionIdsByHash.get(sourceRecordHash);
          return economicType !== "unclassified" && transactionId ? [{
            transactionId,
            classificationRuleId: classificationRule?.id ?? null,
            previousEconomicType: "unclassified" as const,
            newEconomicType: economicType,
            reason: classificationRule ? "rule_applied_on_import" : "source_type_default_on_import",
            createdAt: timestamp,
          }] : [];
        });
        if (audits.length > 0) await tx.insert(economicClassificationAudits).values(audits);
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

  private async findExistingSourceRecordHashes(
    db: AppDatabase,
    sourceId: number,
    hashes: string[],
  ) {
    const existingHashes = new Set<string>();
    for (const hashesBatch of inBatches([...new Set(hashes)])) {
      const rows = await db
        .select({ sourceRecordHash: rawRecords.sourceRecordHash })
        .from(rawRecords)
        .where(and(eq(rawRecords.sourceId, sourceId), inArray(rawRecords.sourceRecordHash, hashesBatch)));
      for (const row of rows) existingHashes.add(row.sourceRecordHash);
    }
    return existingHashes;
  }
}
