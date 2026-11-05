CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `steam_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_name` text NOT NULL,
	`refresh_token` text,
	`iv` text,
	`auth_tag` text,
	`shared_secret` text,
	`custom_title` text,
	`persona_state` integer DEFAULT 7,
	`auto_reply_message` text,
	`games` text,
	`boost_started_at` integer,
	`status` text DEFAULT 'IDLE' NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `steam_account_account_name_unique` ON `steam_account` (`account_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `steam_account_user_id_idx` ON `steam_account` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `steam_chat_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`steam_id_other` text NOT NULL,
	`sender_name` text,
	`content` text NOT NULL,
	`direction` text DEFAULT 'incoming' NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `steam_account`(`id`) ON UPDATE no action ON DELETE cascade
);
