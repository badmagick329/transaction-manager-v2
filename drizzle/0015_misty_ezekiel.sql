CREATE TABLE `recurring_review_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`decision` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_review_decisions_request_id_unique` ON `recurring_review_decisions` (`request_id`);