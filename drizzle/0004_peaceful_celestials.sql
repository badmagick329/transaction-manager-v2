CREATE TABLE `classification_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`normalized_description` text NOT NULL,
	`direction` text NOT NULL,
	`economic_type` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classification_rules_source_direction_description_unique` ON `classification_rules` (`source_id`,`direction`,`normalized_description`);--> statement-breakpoint
CREATE INDEX `classification_rules_source_idx` ON `classification_rules` (`source_id`);--> statement-breakpoint
CREATE TABLE `economic_classification_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`classification_rule_id` integer,
	`previous_economic_type` text NOT NULL,
	`new_economic_type` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `economic_classification_audits_transaction_idx` ON `economic_classification_audits` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `economic_classification_audits_rule_idx` ON `economic_classification_audits` (`classification_rule_id`);