import type { BoardPoint, BoardStrokeInput, LessonBoard } from "../../contracts/src/live-lesson.ts";
import { appendBoardPoint, boardPageStrokes } from "./lesson-board.ts";

export function boardScope(board: LessonBoard) {
  return { documentId: board.documentId ?? null, page: board.page ?? 0 };
}

export function boardGesturePoints(stroke: BoardStrokeInput, point: BoardPoint): BoardPoint[] {
  if (stroke.tool === "note") return stroke.points;
  if (["line", "rectangle", "ellipse"].includes(stroke.tool ?? "pen"))
    return [stroke.points[0], point];
  return appendBoardPoint(stroke.points, point);
}

function segmentDistance(point: BoardPoint, a: BoardPoint, b: BoardPoint, verticalScale: number) {
  const dx = b.x - a.x, dy = (b.y - a.y) * verticalScale;
  const length = dx * dx + dy * dy;
  const fraction = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * verticalScale * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - fraction * dx, (point.y - a.y) * verticalScale - fraction * dy);
}

function hitShape(stroke: BoardStrokeInput, point: BoardPoint, tolerance: number, verticalScale: number) {
  const a = stroke.points[0], b = stroke.points.at(-1) ?? a;
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  if (stroke.tool === "note") {
    const height = verticalScale * 1000, note = boardNoteLayout(stroke, height);
    return point.x * 1000 >= note.x && point.x * 1000 <= note.x + note.width && point.y * height >= note.y && point.y * height <= note.y + note.height;
  }
  if (stroke.tool === "rectangle") {
    const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
    return corners.slice(1).some((corner, index) => segmentDistance(point, corners[index], corner, verticalScale) < tolerance);
  }
  if (stroke.tool === "ellipse") {
    const rx = (right - left) / 2, ry = (bottom - top) / 2;
    if (!rx || !ry) return segmentDistance(point, a, b, verticalScale) < tolerance;
    const radius = Math.hypot((point.x - (left + rx)) / rx, (point.y - (top + ry)) / ry);
    return Math.abs(radius - 1) * Math.min(rx, ry * verticalScale) < tolerance;
  }
  if (stroke.points.length === 1) return segmentDistance(point, a, a, verticalScale) < tolerance;
  return stroke.points.slice(1).some((next, index) => segmentDistance(point, stroke.points[index], next, verticalScale) < tolerance);
}

/** Shared wrapping and bounded sticky-note geometry on browser and native canvases. */
export function boardNoteLayout(stroke: BoardStrokeInput, canvasHeight = 600) {
  const letters = [...(stroke.text ?? "")], lines: string[] = [];
  for (let index = 0; index < letters.length; index += 28) lines.push(letters.slice(index, index + 28).join(""));
  const height = Math.max(64, lines.length * 24 + 24);
  return { x: Math.min(stroke.points[0].x * 1000, 720), y: Math.max(0, Math.min(stroke.points[0].y * canvasHeight, canvasHeight - height)), width: 280, height, lines };
}

/** Erase only a visible stroke the current actor is allowed to change. */
export function boardHitStroke(board: LessonBoard, point: BoardPoint, aspect = 5 / 3) {
  return [...boardPageStrokes(board)].reverse().find((stroke) =>
    (board.canClear || stroke.authorId === board.viewerId) && hitShape(stroke, point, stroke.width / 1000 + 0.012, 1 / aspect),
  );
}
