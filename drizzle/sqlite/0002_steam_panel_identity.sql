CREATE UNIQUE INDEX IF NOT EXISTS `account_steam_identity_idx` ON `account` (`provider_id`,`account_id`) WHERE "account"."provider_id" = 'steam';
