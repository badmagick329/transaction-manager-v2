CREATE TABLE `recurring_payment_links` (
	`transaction_id` integer PRIMARY KEY NOT NULL,
	`payment_id` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `recurring_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` integer NOT NULL,
	`currency_code` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`frequency` text NOT NULL,
	`anchor_date` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
