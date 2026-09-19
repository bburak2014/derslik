CREATE TABLE `commands` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`action` text NOT NULL,
	`succeeded` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "command_succeeded" CHECK("commands"."succeeded" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commands_workspace_id` ON `commands` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `credit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`package_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`revision` integer NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`reverses_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`package_id`,`student_id`) REFERENCES `packages`(`workspace_id`,`id`,`student_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`lesson_id`,`student_id`) REFERENCES `lessons`(`workspace_id`,`id`,`student_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "credit_delta" CHECK("credit_entries"."delta" IN (-1,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_lesson_revision` ON `credit_entries` (`workspace_id`,`lesson_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_single_reversal` ON `credit_entries` (`reverses_id`);--> statement-breakpoint
CREATE INDEX `credit_workspace_created` ON `credit_entries` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`package_id` text NOT NULL,
	`topic` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`location` text NOT NULL,
	`status` text DEFAULT 'SCHEDULED' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`series_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`package_id`,`student_id`) REFERENCES `packages`(`workspace_id`,`id`,`student_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lesson_status" CHECK("lessons"."status" IN ('SCHEDULED','COMPLETED','CANCELLED')),
	CONSTRAINT "lesson_time" CHECK("lessons"."ends_at" > "lessons"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_workspace_id_student` ON `lessons` (`workspace_id`,`id`,`student_id`);--> statement-breakpoint
CREATE INDEX `lessons_workspace_start` ON `lessons` (`workspace_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`name` text NOT NULL,
	`granted` integer NOT NULL,
	`remaining` integer NOT NULL,
	`price_minor` integer NOT NULL,
	`expires_on` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`student_id`) REFERENCES `students`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "package_balance" CHECK("packages"."remaining" >= 0 AND "packages"."remaining" <= "packages"."granted" AND "packages"."granted" > 0),
	CONSTRAINT "package_price" CHECK("packages"."price_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `packages_workspace_id_student` ON `packages` (`workspace_id`,`id`,`student_id`);--> statement-breakpoint
CREATE INDEX `packages_workspace_student` ON `packages` (`workspace_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`received_on` text NOT NULL,
	`method` text NOT NULL,
	`reference` text NOT NULL,
	`voided_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`student_id`) REFERENCES `students`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_positive" CHECK("payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `payments_workspace_student` ON `payments` (`workspace_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `private_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`student_id`) REFERENCES `students`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_workspace_student` ON `private_notes` (`workspace_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`grade` text NOT NULL,
	`subject` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`is_sample` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_workspace_id` ON `students` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `students_workspace_active` ON `students` (`workspace_id`,`active`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_owner_id_unique` ON `workspaces` (`owner_id`);