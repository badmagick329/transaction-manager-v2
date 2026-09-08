CREATE TABLE `recurring_payment_methods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`description` text NOT NULL,
	`effective_date` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `recurring_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_methods_payment_date_unique` ON `recurring_payment_methods` (`payment_id`,`effective_date`);