CREATE TABLE `import_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_batch_id` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_attempts_batch_attempt_unique` ON `import_attempts` (`import_batch_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `import_attempts_batch_idx` ON `import_attempts` (`import_batch_id`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `attempt_count` integer DEFAULT 1 NOT NULL;