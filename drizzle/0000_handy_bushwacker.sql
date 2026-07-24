CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer,
	`parent_account_id` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency_code` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_source_idx` ON `accounts` (`source_id`);--> statement-breakpoint
CREATE INDEX `accounts_parent_idx` ON `accounts` (`parent_account_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`imported_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_file_hash_unique` ON `import_batches` (`file_hash`);--> statement-breakpoint
CREATE TABLE `raw_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_batch_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`external_id` text,
	`source_record_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `raw_records_batch_idx` ON `raw_records` (`import_batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `raw_records_source_hash_unique` ON `raw_records` (`source_id`,`source_record_hash`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_slug_unique` ON `sources` (`slug`);--> statement-breakpoint
CREATE TABLE `transaction_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_transaction_id` integer NOT NULL,
	`to_transaction_id` integer NOT NULL,
	`link_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confidence_score` integer,
	`match_reason` text,
	`created_by` text NOT NULL,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`from_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_links_from_idx` ON `transaction_links` (`from_transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_links_to_idx` ON `transaction_links` (`to_transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`raw_record_id` integer,
	`external_id` text,
	`source_transaction_hash` text,
	`transaction_type` text NOT NULL,
	`economic_type` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency_code` text NOT NULL,
	`transaction_date` text NOT NULL,
	`posted_date` text,
	`description` text NOT NULL,
	`raw_description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_record_id`) REFERENCES `raw_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_raw_record_idx` ON `transactions` (`raw_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_external_unique` ON `transactions` (`source_id`,`external_id`);