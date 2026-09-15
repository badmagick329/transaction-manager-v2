CREATE TABLE `planned_spending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`currency_code` text NOT NULL,
	`price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`interval` integer NOT NULL,
	`unit` text NOT NULL,
	`included` integer NOT NULL
);
