ALTER TABLE `accounts` ADD `coverage_required` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_batches` ADD `source_id` integer REFERENCES `sources`(`id`);
--> statement-breakpoint
CREATE INDEX `import_batches_source_idx` ON `import_batches` (`source_id`);
--> statement-breakpoint
CREATE TABLE `account_coverage_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`import_batch_id` integer,
	`origin` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_coverage_periods_account_idx` ON `account_coverage_periods` (`account_id`);
--> statement-breakpoint
CREATE INDEX `account_coverage_periods_import_batch_idx` ON `account_coverage_periods` (`import_batch_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_coverage_periods_import_unique` ON `account_coverage_periods` (`import_batch_id`,`account_id`,`start_date`,`end_date`);
