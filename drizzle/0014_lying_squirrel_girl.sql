ALTER TABLE `recurring_payment_methods` ADD `match_mode` text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_payment_methods` ADD `anchor_date` text;--> statement-breakpoint
ALTER TABLE `recurring_payment_methods` ADD `frequency` text;--> statement-breakpoint
ALTER TABLE `recurring_payment_methods` ADD `amount_minor` integer;--> statement-breakpoint
ALTER TABLE `recurring_payments` ADD `match_mode` text DEFAULT 'exact' NOT NULL;