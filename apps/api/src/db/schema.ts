import { sql } from "drizzle-orm";
import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  unique,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";

export const app = pgSchema("derslik");
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const users = app.table("users", {
  id: uuid("id").primaryKey(),
  createdAt: createdAt(),
});
export const workspaces = app.table(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Europe/Istanbul"),
    createdAt: createdAt(),
  },
  (t) => [unique("workspace_owner_unique").on(t.ownerId)],
);
export const memberships = app.table(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("membership_unique").on(t.workspaceId, t.userId, t.role),
    uniqueIndex("workspace_single_owner")
      .on(t.workspaceId)
      .where(sql`${t.role} = 'OWNER' AND ${t.active}`),
    check("membership_role", sql`${t.role} IN ('OWNER','STUDENT','GUARDIAN')`),
  ],
);
export const students = app.table(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    grade: text("grade").notNull().default(""),
    subject: text("subject").notNull(),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("students_workspace_id").on(t.workspaceId, t.id),
    unique("students_workspace_user").on(t.workspaceId, t.userId),
    index("students_workspace_active").on(t.workspaceId, t.active),
  ],
);
export const packages = app.table(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    name: text("name").notNull(),
    granted: integer("granted").notNull(),
    remaining: integer("remaining").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("TRY"),
    expiresOn: date("expires_on"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("packages_workspace_id_student").on(
      t.workspaceId,
      t.id,
      t.studentId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.studentId],
      foreignColumns: [students.workspaceId, students.id],
    }),
    check(
      "package_balance",
      sql`${t.remaining} >= 0 AND ${t.remaining} <= ${t.granted} AND ${t.granted} > 0`,
    ),
    check("package_price", sql`${t.priceMinor} > 0 AND ${t.currency} = 'TRY'`),
    index("packages_workspace_student").on(t.workspaceId, t.studentId),
  ],
);
export const lessons = app.table(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    packageId: uuid("package_id").notNull(),
    topic: text("topic").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location").notNull().default(""),
    status: text("status").notNull().default("SCHEDULED"),
    version: integer("version").notNull().default(0),
    seriesId: uuid("series_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("lessons_workspace_id_student").on(t.workspaceId, t.id, t.studentId),
    foreignKey({
      columns: [t.workspaceId, t.packageId, t.studentId],
      foreignColumns: [packages.workspaceId, packages.id, packages.studentId],
    }),
    check("lesson_time", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "lesson_status",
      sql`${t.status} IN ('SCHEDULED','COMPLETED','CANCELLED')`,
    ),
    index("lessons_workspace_start").on(t.workspaceId, t.startsAt),
  ],
);
export const creditEntries = app.table(
  "credit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    packageId: uuid("package_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
    revision: integer("revision").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    reversesId: uuid("reverses_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("credit_revision_unique").on(t.workspaceId, t.lessonId, t.revision),
    unique("credit_reversal_unique").on(t.reversesId),
    unique("credits_workspace_id").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.packageId, t.studentId],
      foreignColumns: [packages.workspaceId, packages.id, packages.studentId],
    }),
    foreignKey({
      columns: [t.workspaceId, t.lessonId, t.studentId],
      foreignColumns: [lessons.workspaceId, lessons.id, lessons.studentId],
    }),
    check("credit_delta", sql`${t.delta} IN (-1,1)`),
    index("credit_workspace_created").on(t.workspaceId, t.createdAt),
  ],
);
export const charges = app.table(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    packageId: uuid("package_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("TRY"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("charges_workspace_id_student").on(t.workspaceId, t.id, t.studentId),
    unique("charge_package_unique").on(t.workspaceId, t.packageId),
    foreignKey({
      columns: [t.workspaceId, t.packageId, t.studentId],
      foreignColumns: [packages.workspaceId, packages.id, packages.studentId],
    }),
    check("charge_amount", sql`${t.amountMinor} > 0 AND ${t.currency} = 'TRY'`),
  ],
);
export const payments = app.table(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("TRY"),
    receivedOn: date("received_on").notNull(),
    method: text("method").notNull(),
    reference: text("reference").notNull().default(""),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("payments_workspace_id_student").on(
      t.workspaceId,
      t.id,
      t.studentId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.studentId],
      foreignColumns: [students.workspaceId, students.id],
    }),
    check(
      "payment_amount",
      sql`${t.amountMinor} > 0 AND ${t.currency} = 'TRY'`,
    ),
    check("payment_method", sql`${t.method} IN ('CASH','TRANSFER','OTHER')`),
    index("payments_workspace_student").on(t.workspaceId, t.studentId),
  ],
);
export const allocations = app.table(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    chargeId: uuid("charge_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("allocation_payment_charge").on(
      t.workspaceId,
      t.paymentId,
      t.chargeId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.paymentId, t.studentId],
      foreignColumns: [payments.workspaceId, payments.id, payments.studentId],
    }),
    foreignKey({
      columns: [t.workspaceId, t.chargeId, t.studentId],
      foreignColumns: [charges.workspaceId, charges.id, charges.studentId],
    }),
    check("allocation_amount", sql`${t.amountMinor} > 0`),
  ],
);
export const privateNotes = app.table(
  "private_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("private_note_student").on(t.workspaceId, t.studentId),
    foreignKey({
      columns: [t.workspaceId, t.studentId],
      foreignColumns: [students.workspaceId, students.id],
    }),
  ],
);
export const apiCommands = app.table(
  "api_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    key: uuid("key").notNull(),
    requestHash: text("request_hash").notNull(),
    action: text("action").notNull(),
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [unique("api_command_key").on(t.workspaceId, t.actorId, t.key)],
);
export const auditEvents = app.table(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    resourceId: uuid("resource_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_workspace_created").on(t.workspaceId, t.createdAt)],
);
