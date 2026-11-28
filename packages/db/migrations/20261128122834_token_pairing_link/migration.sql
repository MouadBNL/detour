ALTER TABLE `extension_tokens` ADD `pairing_session_id` text REFERENCES pairing_sessions(id) ON DELETE SET NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `users_email_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `extension_tokens_pairing_session_id_unique` ON `extension_tokens` (`pairing_session_id`);