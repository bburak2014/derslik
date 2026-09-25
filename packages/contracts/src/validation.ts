import { z } from "zod";

// Hata iletileri çeviri anahtarıdır; API yanıtı isteğin dilinde yazar.
const id = z.string().uuid();
const short = z.string().trim().min(1).max(120);
const amount = z
  .string()
  .regex(/^\d{1,10}$/)
  .refine((x) => Number(x) > 0 && Number(x) <= 999999999, "api.invalidAmount");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (x) =>
      !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().startsWith(x),
    "api.invalidDate",
  );
const version = z.number().int().min(0);
const fields = {
  name: short,
  grade: z.string().trim().max(50),
  subject: short,
  phone: z.string().trim().max(30),
  email: z.union([z.literal(""), z.string().email().max(150)]),
};
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("student.create"), ...fields }),
  z.object({ action: z.literal("student.update"), id, version, ...fields }),
  z.object({ action: z.literal("student.archive"), id, version }),
  z.object({ action: z.literal("student.restore"), id, version }),
  z.object({
    action: z.literal("package.create"),
    studentId: id,
    name: short,
    granted: z.number().int().min(1).max(100),
    priceMinor: amount,
    expiresOn: day.nullable(),
  }),
  z.object({
    action: z.literal("lesson.create"),
    studentId: id,
    packageId: id,
    topic: short,
    startsAt: z.string().datetime({ offset: true }),
    duration: z.number().int().min(15).max(180),
    location: z.string().trim().max(100),
    makeupForId: id.optional(),
    weeks: z.number().int().min(1).max(8),
  }),
  z.object({ action: z.literal("lesson.complete"), id, version }),
  z.object({ action: z.literal("lesson.reverse"), id, version }),
  z.object({ action: z.literal("lesson.cancel"), id, version }),
  z.object({
    action: z.literal("lesson.reschedule"),
    id,
    version,
    startsAt: z.string().datetime({ offset: true }),
    duration: z.number().int().min(15).max(180),
  }),
  z.object({
    action: z.literal("payment.create"),
    studentId: id,
    amountMinor: amount,
    receivedOn: day,
    method: z.enum(["TRANSFER", "CASH", "OTHER"]),
    reference: z.string().trim().max(200),
  }),
  z.object({ action: z.literal("payment.void"), id, version }),
  z.object({
    action: z.literal("note.save"),
    studentId: id,
    body: z.string().trim().max(5000),
    version,
  }),
  z.object({ action: z.literal("seed") }),
]);
export type Command = z.infer<typeof commandSchema>;
export const requestIdSchema = id;
