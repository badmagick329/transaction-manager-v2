import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  accountKinds,
  classificationMatchModes,
  economicDirections,
  economicTypes,
  importAttemptStatuses,
  importBatchStatuses,
  linkCreatedBy,
  linkStatuses,
  linkTypes,
  sourceKinds,
  transactionStatuses,
  transactionTypes,
} from "../../core/finance/constants";

const isoNow = () => new Date().toISOString();

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: sourceKinds }).notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    slugUnique: uniqueIndex("sources_slug_unique").on(table.slug),
  }),
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").references(() => sources.id),
    parentAccountId: integer("parent_account_id").references(() => accounts.id),
    externalId: text("external_id"),
    name: text("name").notNull(),
    kind: text("kind", { enum: accountKinds }).notNull(),
    currencyCode: text("currency_code").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    sourceIdx: index("accounts_source_idx").on(table.sourceId),
    parentIdx: index("accounts_parent_idx").on(table.parentAccountId),
    sourceExternalUnique: uniqueIndex("accounts_source_external_unique").on(table.sourceId, table.externalId),
    sourceNameCurrencyIdx: index("accounts_source_name_currency_idx").on(table.sourceId, table.name, table.currencyCode),
  }),
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    status: text("status", { enum: importBatchStatuses }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(1),
    recordCount: integer("record_count").notNull().default(0),
    duplicateRecordCount: integer("duplicate_record_count").notNull().default(0),
    errorMessage: text("error_message"),
    importedAt: text("imported_at"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    fileHashUnique: uniqueIndex("import_batches_file_hash_unique").on(table.fileHash),
  }),
);

export const importAttempts = sqliteTable(
  "import_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importBatchId: integer("import_batch_id")
      .notNull()
      .references(() => importBatches.id),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status", { enum: importAttemptStatuses }).notNull().default("pending"),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull().$defaultFn(isoNow),
    completedAt: text("completed_at"),
  },
  table => ({
    batchAttemptUnique: uniqueIndex("import_attempts_batch_attempt_unique").on(table.importBatchId, table.attemptNumber),
    batchIdx: index("import_attempts_batch_idx").on(table.importBatchId),
  }),
);

export const rawRecords = sqliteTable(
  "raw_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importBatchId: integer("import_batch_id")
      .notNull()
      .references(() => importBatches.id),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id"),
    sourceRecordHash: text("source_record_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    batchIdx: index("raw_records_batch_idx").on(table.importBatchId),
    sourceHashUnique: uniqueIndex("raw_records_source_hash_unique").on(table.sourceId, table.sourceRecordHash),
  }),
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    rawRecordId: integer("raw_record_id").references(() => rawRecords.id),
    externalId: text("external_id"),
    sourceTransactionHash: text("source_transaction_hash"),
    transactionType: text("transaction_type", { enum: transactionTypes }).notNull(),
    economicType: text("economic_type", { enum: economicTypes }).notNull(),
    status: text("status", { enum: transactionStatuses }).notNull().default("posted"),
    amountMinor: integer("amount_minor").notNull(),
    currencyCode: text("currency_code").notNull(),
    transactionDate: text("transaction_date").notNull(),
    postedDate: text("posted_date"),
    description: text("description").notNull(),
    rawDescription: text("raw_description"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    accountDateIdx: index("transactions_account_date_idx").on(table.accountId, table.transactionDate),
    dateIdx: index("transactions_date_idx").on(table.transactionDate, table.id),
    rawRecordIdx: index("transactions_raw_record_idx").on(table.rawRecordId),
    sourceExternalUnique: uniqueIndex("transactions_source_external_unique").on(table.sourceId, table.externalId),
  }),
);

export const transactionTypeCorrections = sqliteTable(
  "transaction_type_corrections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    previousType: text("previous_type").notNull(),
    correctedType: text("corrected_type").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    transactionUnique: uniqueIndex("transaction_type_corrections_transaction_unique").on(table.transactionId),
  }),
);

export const classificationRules = sqliteTable(
  "classification_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    normalizedDescription: text("normalized_description").notNull(),
    matchMode: text("match_mode", { enum: classificationMatchModes }).notNull().default("exact"),
    direction: text("direction", { enum: economicDirections }).notNull(),
    economicType: text("economic_type", { enum: economicTypes }).notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    sourceDirectionDescriptionUnique: uniqueIndex("classification_rules_source_direction_description_unique").on(
      table.sourceId,
      table.direction,
      table.matchMode,
      table.normalizedDescription,
    ),
  }),
);

export const economicClassificationAudits = sqliteTable(
  "economic_classification_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    classificationRuleId: integer("classification_rule_id"),
    previousEconomicType: text("previous_economic_type", { enum: economicTypes }).notNull(),
    newEconomicType: text("new_economic_type", { enum: economicTypes }).notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    transactionIdx: index("economic_classification_audits_transaction_idx").on(table.transactionId),
    ruleIdx: index("economic_classification_audits_rule_idx").on(table.classificationRuleId),
  }),
);

export const transactionLinks = sqliteTable(
  "transaction_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromTransactionId: integer("from_transaction_id")
      .notNull()
      .references(() => transactions.id),
    toTransactionId: integer("to_transaction_id")
      .notNull()
      .references(() => transactions.id),
    linkType: text("link_type", { enum: linkTypes }).notNull(),
    status: text("status", { enum: linkStatuses }).notNull().default("pending"),
    confidenceScore: integer("confidence_score"),
    matchReason: text("match_reason"),
    createdBy: text("created_by", { enum: linkCreatedBy }).notNull(),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  table => ({
    fromIdx: index("transaction_links_from_idx").on(table.fromTransactionId),
    toIdx: index("transaction_links_to_idx").on(table.toTransactionId),
    pairTypeUnique: uniqueIndex("transaction_links_pair_type_unique").on(table.fromTransactionId, table.toTransactionId, table.linkType),
  }),
);

export const schema = {
  sources,
  accounts,
  importBatches,
  importAttempts,
  transactionTypeCorrections,
  classificationRules,
  economicClassificationAudits,
  rawRecords,
  transactions,
  transactionLinks,
};
