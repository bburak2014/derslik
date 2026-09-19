import { z } from "zod";
import { commandSchema } from "../../../packages/contracts/src/validation.js";

// Reuse the same validated domain payloads as the current web client.
export const commands = Object.fromEntries(
  commandSchema.options.map((schema) => [schema.shape.action.value, schema]),
);
export const uuid = z.string().uuid();
export const version = z
  .object({ version: z.number().int().nonnegative() })
  .strict();
export const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().nonnegative().max(100_000).default(0),
});
export function command<T extends string>(action: T, input: unknown) {
  const data = z.record(z.unknown()).parse(input);
  return commandSchema.parse({ ...data, action });
}
