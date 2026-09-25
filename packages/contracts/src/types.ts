import { intlLocale, t } from "./i18n/index.ts";

export type Student = {
  id: string;
  name: string;
  grade: string;
  subject: string;
  phone: string;
  email: string;
  active: number;
  is_sample: number;
  version: number;
  created_at: string;
};
export type LessonPackage = {
  id: string;
  student_id: string;
  name: string;
  granted: number;
  remaining: number;
  price_minor: string;
  expires_on: string | null;
  created_at: string;
};
export type Lesson = {
  id: string;
  student_id: string;
  package_id: string;
  topic: string;
  starts_at: string;
  ends_at: string;
  location: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  version: number;
  series_id: string | null;
  makeup_for_id?: string | null;
  created_at: string;
};
export type Payment = {
  id: string;
  student_id: string;
  amount_minor: string;
  received_on: string;
  method: "TRANSFER" | "CASH" | "OTHER";
  reference: string;
  voided_at: string | null;
  version: number;
  created_at: string;
};
export type CreditEntry = {
  id: string;
  student_id: string;
  package_id: string;
  lesson_id: string;
  delta: number;
  reason: string;
  created_at: string;
};
export type PrivateNote = {
  student_id: string;
  body: string;
  version: number;
  updated_at: string;
};
export type WorkspaceData = {
  students: Student[];
  packages: LessonPackage[];
  lessons: Lesson[];
  payments: Payment[];
  credits: CreditEntry[];
  notes: PrivateNote[];
  serverTime: string;
};
export type View = "overview" | "calendar" | "students" | "payments";
export const emptyWorkspace: WorkspaceData = {
  students: [],
  packages: [],
  lessons: [],
  payments: [],
  credits: [],
  notes: [],
  serverTime: "",
};
export const money = (minor: string | number) =>
  new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
export const dateKey = (date: Date | string = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
// The API rule (learning.service assignment.submit): a student may hand in or
// edit an open assignment until its due date, Istanbul calendar day included.
// After that only a first, late hand-in is accepted.
export const canEditSubmission = (
  assignment: { status: string; due_on: string | null },
  submitted: boolean,
  today = dateKey(),
) =>
  assignment.status === "OPEN" &&
  (!submitted || !assignment.due_on || assignment.due_on >= today);
export const timeLabel = (date: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
export const dayLabel = (
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {},
) =>
  new Intl.DateTimeFormat(intlLocale(), {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    ...options,
  }).format(new Date(date));
export function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00+03:00");
  d.setUTCDate(d.getUTCDate() + days);
  return dateKey(d);
}
export function parseLira(value: string): string {
  const v = value.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v))
    throw new Error(t("common.amountFormat"));
  const [whole, decimal = ""] = v.split(".");
  return String(Number(whole) * 100 + Number(decimal.padEnd(2, "0")));
}
