DROP INDEX `classification_rules_source_direction_description_unique`;--> statement-breakpoint
ALTER TABLE `classification_rules` ADD `match_mode` text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `classification_rules_source_direction_description_unique` ON `classification_rules` (`source_id`,`direction`,`match_mode`,`normalized_description`);