CREATE SCHEMA "derslik";
--> statement-breakpoint
CREATE TABLE "derslik"."payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_payment_charge" UNIQUE("workspace_id","payment_id","charge_id"),
	CONSTRAINT "allocation_amount" CHECK ("derslik"."payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "derslik"."api_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"action" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_command_key" UNIQUE("workspace_id","actor_id","key")
);
--> statement-breakpoint
CREATE TABLE "derslik"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "derslik"."charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_workspace_id_student" UNIQUE("workspace_id","id","student_id"),
	CONSTRAINT "charge_package_unique" UNIQUE("workspace_id","package_id"),
	CONSTRAINT "charge_amount" CHECK ("derslik"."charges"."amount_minor" > 0 AND "derslik"."charges"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "derslik"."credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reverses_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_revision_unique" UNIQUE("workspace_id","lesson_id","revision"),
	CONSTRAINT "credit_reversal_unique" UNIQUE("reverses_id"),
	CONSTRAINT "credits_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "credit_delta" CHECK ("derslik"."credit_entries"."delta" IN (-1,1))
);
--> statement-breakpoint
CREATE TABLE "derslik"."lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"series_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_workspace_id_student" UNIQUE("workspace_id","id","student_id"),
	CONSTRAINT "lesson_time" CHECK ("derslik"."lessons"."ends_at" > "derslik"."lessons"."starts_at"),
	CONSTRAINT "lesson_status" CHECK ("derslik"."lessons"."status" IN ('SCHEDULED','COMPLETED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "derslik"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_unique" UNIQUE("workspace_id","user_id","role"),
	CONSTRAINT "membership_role" CHECK ("derslik"."memberships"."role" IN ('OWNER','STUDENT','GUARDIAN'))
);
--> statement-breakpoint
CREATE TABLE "derslik"."packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"granted" integer NOT NULL,
	"remaining" integer NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_workspace_id_student" UNIQUE("workspace_id","id","student_id"),
	CONSTRAINT "package_balance" CHECK ("derslik"."packages"."remaining" >= 0 AND "derslik"."packages"."remaining" <= "derslik"."packages"."granted" AND "derslik"."packages"."granted" > 0),
	CONSTRAINT "package_price" CHECK ("derslik"."packages"."price_minor" > 0 AND "derslik"."packages"."currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "derslik"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"received_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"voided_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_workspace_id_student" UNIQUE("workspace_id","id","student_id"),
	CONSTRAINT "payment_amount" CHECK ("derslik"."payments"."amount_minor" > 0 AND "derslik"."payments"."currency" = 'TRY'),
	CONSTRAINT "payment_method" CHECK ("derslik"."payments"."method" IN ('CASH','TRANSFER','OTHER'))
);
--> statement-breakpoint
CREATE TABLE "derslik"."private_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_note_student" UNIQUE("workspace_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "derslik"."students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"subject" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "students_workspace_user" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "derslik"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "derslik"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_owner_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
ALTER TABLE "derslik"."payment_allocations" ADD CONSTRAINT "payment_allocations_workspace_id_payment_id_student_id_payments_workspace_id_id_student_id_fk" FOREIGN KEY ("workspace_id","payment_id","student_id") REFERENCES "derslik"."payments"("workspace_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."payment_allocations" ADD CONSTRAINT "payment_allocations_workspace_id_charge_id_student_id_charges_workspace_id_id_student_id_fk" FOREIGN KEY ("workspace_id","charge_id","student_id") REFERENCES "derslik"."charges"("workspace_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."api_commands" ADD CONSTRAINT "api_commands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "derslik"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."api_commands" ADD CONSTRAINT "api_commands_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "derslik"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "derslik"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "derslik"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."charges" ADD CONSTRAINT "charges_workspace_id_package_id_student_id_packages_workspace_id_id_student_id_fk" FOREIGN KEY ("workspace_id","package_id","student_id") REFERENCES "derslik"."packages"("workspace_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."credit_entries" ADD CONSTRAINT "credit_entries_workspace_id_package_id_student_id_packages_workspace_id_id_student_id_fk" FOREIGN KEY ("workspace_id","package_id","student_id") REFERENCES "derslik"."packages"("workspace_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."credit_entries" ADD CONSTRAINT "credit_entries_workspace_id_lesson_id_student_id_lessons_workspace_id_id_student_id_fk" FOREIGN KEY ("workspace_id","lesson_id","student_id") REFERENCES "derslik"."lessons"("workspace_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."lessons" ADD CONSTRAINT "lessons_workspace_id_package_id_student_id_packages_workspace_id_id_student_id_fk" FOREIGN KEY ("workspace_id","package_id","student_id") REFERENCES "derslik"."packages"("workspace_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "derslik"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "derslik"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."packages" ADD CONSTRAINT "packages_workspace_id_student_id_students_workspace_id_id_fk" FOREIGN KEY ("workspace_id","student_id") REFERENCES "derslik"."students"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."payments" ADD CONSTRAINT "payments_workspace_id_student_id_students_workspace_id_id_fk" FOREIGN KEY ("workspace_id","student_id") REFERENCES "derslik"."students"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."private_notes" ADD CONSTRAINT "private_notes_workspace_id_student_id_students_workspace_id_id_fk" FOREIGN KEY ("workspace_id","student_id") REFERENCES "derslik"."students"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."students" ADD CONSTRAINT "students_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "derslik"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "derslik"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derslik"."workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "derslik"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_workspace_created" ON "derslik"."audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_workspace_created" ON "derslik"."credit_entries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "lessons_workspace_start" ON "derslik"."lessons" USING btree ("workspace_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_single_owner" ON "derslik"."memberships" USING btree ("workspace_id") WHERE "derslik"."memberships"."role" = 'OWNER' AND "derslik"."memberships"."active";--> statement-breakpoint
CREATE INDEX "packages_workspace_student" ON "derslik"."packages" USING btree ("workspace_id","student_id");--> statement-breakpoint
CREATE INDEX "payments_workspace_student" ON "derslik"."payments" USING btree ("workspace_id","student_id");--> statement-breakpoint
CREATE INDEX "students_workspace_active" ON "derslik"."students" USING btree ("workspace_id","active");