CREATE TABLE `amazon_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`tracking_start` text NOT NULL
);

--> statement-breakpoint
INSERT INTO `amazon_settings` (`id`, `tracking_start`) VALUES (1, '2024-01-01');
