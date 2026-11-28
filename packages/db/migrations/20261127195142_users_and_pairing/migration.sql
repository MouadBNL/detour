CREATE TABLE `extension_tokens` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`browser` text NOT NULL,
	`device_name` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	CONSTRAINT `fk_extension_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pairing_sessions` (
	`id` text PRIMARY KEY,
	`device_code_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`browser` text NOT NULL,
	`device_name` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`approved_at` integer,
	`consumed_at` integer,
	CONSTRAINT `fk_pairing_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_tokens_token_hash_unique` ON `extension_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `extension_tokens_user_id_idx` ON `extension_tokens` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_sessions_device_code_hash_unique` ON `pairing_sessions` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_sessions_user_code_unique` ON `pairing_sessions` (`user_code`);--> statement-breakpoint
CREATE INDEX `pairing_sessions_expires_at_idx` ON `pairing_sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);