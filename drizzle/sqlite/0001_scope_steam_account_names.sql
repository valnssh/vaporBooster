DROP INDEX IF EXISTS `steam_account_account_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `steam_account_owner_name_unique` ON `steam_account` (`user_id`,`account_name`) WHERE "steam_account"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `steam_account_local_name_unique` ON `steam_account` (`account_name`) WHERE "steam_account"."user_id" IS NULL;
