import { z } from "zod";

/** Calendar dates supported by both JavaScript and PostgreSQL (no year zero). */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "api.invalidDate")
  .refine((value) => {
    const date = new Date(value);
    return (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() >= 1 &&
      date.toISOString().startsWith(value)
    );
  }, "api.invalidDate");

/** Zod checks ISO syntax; also reject invalid instants and PostgreSQL offsets. */
export const timestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const date = new Date(value);
    const offset = /[+-](\d{2})(?::?\d{2})?$/.exec(value);
    return (
      !Number.isNaN(date.getTime()) &&
      Number(value.slice(0, 4)) >= 1 &&
      date.getUTCFullYear() >= 1 &&
      date.getUTCFullYear() <= 9999 &&
      (!offset || Number(offset[1]) <= 15)
    );
  }, "api.invalidDate");
