CREATE TABLE `transaction_type_corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`previous_type` text NOT NULL,
	`corrected_type` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_type_corrections_transaction_unique` ON `transaction_type_corrections` (`transaction_id`);