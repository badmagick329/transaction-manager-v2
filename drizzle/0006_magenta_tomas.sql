DROP INDEX `classification_rules_source_idx`;--> statement-breakpoint
CREATE INDEX `accounts_source_name_currency_idx` ON `accounts` (`source_id`,`name`,`currency_code`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`transaction_date`,`id`);