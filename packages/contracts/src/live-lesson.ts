import { z } from "zod";

const meetingHosts = new Set([
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "meet.jit.si",
  "zoom.us",
]);

/** Only provider HTTPS links are opened from a lesson; never arbitrary schemes. */
export function isMeetingUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value) || /[\\\u0000-\u0020\u007f]/.test(value))
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname !== "/" &&
      (meetingHosts.has(url.hostname) || url.hostname.endsWith(".zoom.us"))
    );
  } catch {
    return false;
  }
}

export const meetingUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(isMeetingUrl, "api.meetingUrlInvalid")
  .transform((value) => new URL(value).href)
  .pipe(z.string().max(2048))
  .nullable();

export const boardColors = [
  "#172554",
  "#2563eb",
  "#dc2626",
  "#16a34a",
] as const;
export const boardWidths = [2, 4, 8] as const;
export const maxBoardPoints = 128;
export const maxBoardStrokes = 500;
export const boardPointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const boardStrokeInputSchema = z
  .object({
    id: z.string().uuid(),
    points: z.array(boardPointSchema).min(1).max(maxBoardPoints),
    color: z.enum(boardColors),
    width: z.union([z.literal(2), z.literal(4), z.literal(8)]),
  })
  .strict();
const epoch = z.number().int().nonnegative();
export const lessonBoardCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("stroke.add"),
      epoch,
      stroke: boardStrokeInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("stroke.remove"),
      epoch,
      id: z.string().uuid(),
    })
    .strict(),
  z.object({ action: z.literal("board.clear"), epoch }).strict(),
]);

export type BoardPoint = z.infer<typeof boardPointSchema>;
export type BoardStrokeInput = z.infer<typeof boardStrokeInputSchema>;
export type BoardStroke = BoardStrokeInput & { authorId: string };
export type LessonBoardCommand = z.infer<typeof lessonBoardCommandSchema>;
export type LessonBoard = {
  id: string;
  revision: number;
  epoch: number;
  viewerId: string;
  canEdit: boolean;
  canClear: boolean;
  strokes: BoardStroke[];
};
export type LessonBoardReadResult = {
  data: LessonBoard | null;
  access?: { canEdit: boolean; canClear: boolean };
};
export type LessonBoardMutationResult = {
  data: LessonBoard;
  replayed: boolean;
};
