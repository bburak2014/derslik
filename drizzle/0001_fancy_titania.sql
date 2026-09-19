CREATE TABLE `teaching_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`due_on` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`student_id`) REFERENCES `students`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "teaching_assignment_status" CHECK("teaching_assignments"."status" IN ('OPEN','COMPLETED','CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_assignment_scope` ON `teaching_assignments` (`workspace_id`,`id`,`student_id`);--> statement-breakpoint
CREATE INDEX `teaching_assignment_student` ON `teaching_assignments` (`workspace_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `teaching_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`assignment_id` text,
	`lesson_id` text,
	`title` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer NOT NULL,
	`state` text DEFAULT 'UPLOADING' NOT NULL,
	`upload_id` text,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`,`student_id`) REFERENCES `students`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`assignment_id`,`student_id`) REFERENCES `teaching_assignments`(`workspace_id`,`id`,`student_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`lesson_id`,`student_id`) REFERENCES `lessons`(`workspace_id`,`id`,`student_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "teaching_file_size" CHECK("teaching_files"."size" > 0 AND "teaching_files"."size" <= 262144000),
	CONSTRAINT "teaching_file_kind" CHECK("teaching_files"."kind" IN ('document','video')),
	CONSTRAINT "teaching_file_state" CHECK("teaching_files"."state" IN ('UPLOADING','READY','DELETING','DELETED'))
);
--> statement-breakpoint
CREATE INDEX `teaching_file_student` ON `teaching_files` (`workspace_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `teaching_parts` (
	`file_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `teaching_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_part_number` ON `teaching_parts` (`file_id`,`part_number`);