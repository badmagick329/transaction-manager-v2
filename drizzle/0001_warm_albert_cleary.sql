ALTER TABLE `accounts` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_source_external_unique` ON `accounts` (`source_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `duplicate_record_count` integer DEFAULT 0 NOT NULL;