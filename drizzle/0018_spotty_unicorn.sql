CREATE TABLE `recurring_spending_controls` (
	`payment_id` integer PRIMARY KEY NOT NULL,
	`control` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `recurring_payments`(`id`) ON UPDATE no action ON DELETE no action
);
