CREATE TABLE `tag_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tag_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`normalized_description` text NOT NULL,
	`match_mode` text DEFAULT 'exact' NOT NULL,
	`direction` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tag_rules_tag_idx` ON `tag_rules` (`tag_id`);--> statement-breakpoint
CREATE INDEX `tag_rules_source_idx` ON `tag_rules` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_rules_match_unique` ON `tag_rules` (`tag_id`,`source_id`,`direction`,`match_mode`,`normalized_description`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_unique` ON `tags` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `transaction_manual_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_manual_tags_transaction_idx` ON `transaction_manual_tags` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_manual_tags_tag_idx` ON `transaction_manual_tags` (`tag_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_manual_tags_assignment_unique` ON `transaction_manual_tags` (`transaction_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `transaction_tag_rule_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`tag_rule_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_rule_id`) REFERENCES `tag_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_tag_rule_matches_transaction_idx` ON `transaction_tag_rule_matches` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_tag_rule_matches_rule_idx` ON `transaction_tag_rule_matches` (`tag_rule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_tag_rule_matches_unique` ON `transaction_tag_rule_matches` (`transaction_id`,`tag_rule_id`);