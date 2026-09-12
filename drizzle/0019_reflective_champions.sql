CREATE TABLE `amazon_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `amazon_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `amazon_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`transaction_id` integer NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`allocations` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `amazon_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amazon_link_identity` ON `amazon_links` (`order_id`,`transaction_id`,`kind`);--> statement-breakpoint
CREATE TABLE `amazon_card_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand` text NOT NULL,
	`last_four` text NOT NULL,
	`account_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amazon_mapping_identity` ON `amazon_card_mappings` (`brand`,`last_four`);--> statement-breakpoint
CREATE TABLE `amazon_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`marketplace` text NOT NULL,
	`order_id` text NOT NULL,
	`revision_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amazon_order_identity` ON `amazon_orders` (`marketplace`,`order_id`);--> statement-breakpoint
CREATE TABLE `amazon_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`data` text NOT NULL,
	`incoming_data` text NOT NULL,
	`source` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `amazon_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amazon_revision_identity` ON `amazon_revisions` (`order_id`,`fingerprint`);