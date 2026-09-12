CREATE TABLE `recurring_transaction_decisions` (
	`payment_id` integer NOT NULL,
	`transaction_id` integer NOT NULL,
	`one_off` integer DEFAULT false NOT NULL,
	`price_warning_dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `recurring_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_decisions_payment_transaction_unique` ON `recurring_transaction_decisions` (`payment_id`,`transaction_id`);