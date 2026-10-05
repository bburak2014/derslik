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
export const maxBoardDocuments = 5;
export const maxBoardPages = 100;
export const boardTools = [
  "pen",
  "highlighter",
  "line",
  "rectangle",
  "ellipse",
  "note",
] as const;
const boardPageScope = {
  documentId: z.string().uuid().nullable().default(null),
  page: z.number().int().min(0).max(maxBoardPages).default(0),
};
export const boardPointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const boardStrokeInputSchema = z
  .object({
    id: z.string().uuid(),
    points: z.array(boardPointSchema).min(1).max(maxBoardPoints),
    color: z.enum(boardColors),
    width: z.union([z.literal(2), z.literal(4), z.literal(8)]),
    ...boardPageScope,
    tool: z.enum(boardTools).default("pen"),
    text: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((stroke, ctx) => {
    let validPoints = true;
    if (stroke.tool === "note") validPoints = stroke.points.length === 1;
    else if (["line", "rectangle", "ellipse"].includes(stroke.tool))
      validPoints = stroke.points.length === 2;
    if (
      !validPoints ||
      (stroke.tool === "note") !== (stroke.text !== undefined)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api.boardStrokeInvalid",
      });
    if ((stroke.documentId === null) !== (stroke.page === 0))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api.boardPageInvalid",
      });
  });
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
      ...boardPageScope,
    })
    .strict(),
  z
    .object({
      action: z.literal("stroke.restore"),
      epoch,
      id: z.string().uuid(),
      ...boardPageScope,
    })
    .strict(),
  z
    .object({
      action: z.literal("document.add"),
      epoch,
      id: z.string().uuid(),
      pageCount: z.number().int().min(1).max(maxBoardPages),
    })
    .strict(),
  z
    .object({ action: z.literal("document.select"), epoch, ...boardPageScope })
    .strict(),
  z
    .object({ action: z.literal("page.clear"), epoch, ...boardPageScope })
    .strict(),
  z.object({ action: z.literal("board.clear"), epoch }).strict(),
]);

export type BoardPoint = z.infer<typeof boardPointSchema>;
export type BoardStrokeInput = z.input<typeof boardStrokeInputSchema>;
export type BoardStroke = z.output<typeof boardStrokeInputSchema> & {
  authorId: string;
};
export type LessonBoardCommand = z.input<typeof lessonBoardCommandSchema>;
export type BoardDocument = { id: string; name: string; pageCount: number };
export type LessonBoard = {
  id: string;
  revision: number;
  epoch: number;
  viewerId: string;
  canEdit: boolean;
  canClear: boolean;
  documents: BoardDocument[];
  documentId: string | null;
  page: number;
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
