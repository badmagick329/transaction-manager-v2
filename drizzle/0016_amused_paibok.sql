CREATE TABLE `recurring_review_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`report` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_review_reports_request_id_unique` ON `recurring_review_reports` (`request_id`);