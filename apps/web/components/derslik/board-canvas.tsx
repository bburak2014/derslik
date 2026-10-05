"use client";
import { useRef, type PointerEvent } from "react";
import { boardGesturePoints, boardHitStroke, boardNoteLayout, boardPageStrokes, boardPoint, boardScope, boardStrokePath } from "@derslik/api-client";
import { t, type BoardStrokeInput, type LessonBoard } from "@derslik/contracts";

export type BoardTool = NonNullable<BoardStrokeInput["tool"]> | "eraser";

function point(event: PointerEvent<SVGSVGElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  return boardPoint(event.clientX - box.left, event.clientY - box.top, box.width, box.height);
}

function BoardMark({ stroke, canvasHeight }: Readonly<{ stroke: BoardStrokeInput; canvasHeight: number }>) {
  const a = stroke.points[0], b = stroke.points.at(-1) ?? a;
  const props = { stroke: stroke.color, strokeWidth: stroke.width, fill: "none" };
  const x = Math.min(a.x, b.x) * 1000, y = Math.min(a.y, b.y) * canvasHeight;
  const width = Math.abs(b.x - a.x) * 1000, height = Math.abs(b.y - a.y) * canvasHeight;
  if (stroke.tool === "rectangle") return <rect x={x} y={y} width={width} height={height} rx={2} {...props} />;
  if (stroke.tool === "ellipse") return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...props} />;
  if (stroke.tool === "note") {
    const note = boardNoteLayout(stroke, canvasHeight);
    return <g><rect x={note.x} y={note.y} width={note.width} height={note.height} rx={12} fill="#fff4c2" stroke={stroke.color} strokeWidth={1} />
      <text x={note.x + 14} y={note.y + 30} fill={stroke.color} fontSize={18} fontFamily="sans-serif">{note.lines.map((line, index) => <tspan key={`${stroke.id}-${index}`} x={note.x + 14} dy={index ? 24 : 0}>{line}</tspan>)}</text>
    </g>;
  }
  const weight = stroke.tool === "highlighter" ? stroke.width * 5 : stroke.width;
  if (stroke.points.length === 1) return <circle cx={a.x * 1000} cy={a.y * canvasHeight} r={weight / 2} fill={stroke.color} opacity={stroke.tool === "highlighter" ? 0.3 : 1} />;
  return <path d={boardStrokePath(stroke.points, canvasHeight)} {...props} strokeWidth={stroke.tool === "highlighter" ? stroke.width * 5 : stroke.width}
    opacity={stroke.tool === "highlighter" ? 0.3 : 1} strokeLinecap="round" strokeLinejoin="round" />;
}

export function BoardCanvas({ board, editable, color, width, draft, onDraft, onStroke, tool = "pen", note = "", onErase, aspect = 5 / 3 }: Readonly<{
  board: LessonBoard; editable: boolean; color: BoardStrokeInput["color"]; width: BoardStrokeInput["width"];
  draft: BoardStrokeInput | null; onDraft: (stroke: BoardStrokeInput | null) => void;
  onStroke: (stroke: BoardStrokeInput, epoch: number) => void;
  tool?: BoardTool; note?: string; onErase?: (id: string) => void; aspect?: number;
}>) {
  const gesture = useRef<{ stroke: BoardStrokeInput; epoch: number; pointer: number } | null>(null);
  function down(event: PointerEvent<SVGSVGElement>) {
    if (!editable || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    if (tool === "eraser") {
      const hit = boardHitStroke(board, point(event), aspect);
      if (hit) onErase?.(hit.id);
      return;
    }
    if (tool === "note" && !note.trim()) return;
    const stroke: BoardStrokeInput = { id: crypto.randomUUID(), points: [point(event)], color, width, tool, ...boardScope(board), ...(tool === "note" ? { text: note.trim() } : {}) };
    if (tool === "note") { onStroke(stroke, board.epoch); return; }
    if (["line", "rectangle", "ellipse"].includes(tool)) stroke.points.push(stroke.points[0]);
    gesture.current = { stroke, epoch: board.epoch, pointer: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    onDraft(stroke);
  }
  function currentGesture(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (current?.pointer !== event.pointerId) return null;
    if (!editable || current.epoch !== board.epoch || current.stroke.documentId !== (board.documentId ?? null) || current.stroke.page !== (board.page ?? 0)) {
      gesture.current = null; onDraft(null); return null;
    }
    return current;
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = currentGesture(event);
    if (!current) return;
    const stroke = { ...current.stroke, points: boardGesturePoints(current.stroke, point(event)) };
    gesture.current = { ...current, stroke }; onDraft(stroke);
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    const current = currentGesture(event);
    if (!current) return;
    gesture.current = null;
    const stroke = { ...current.stroke, points: boardGesturePoints(current.stroke, point(event)) };
    onDraft(stroke); onStroke(stroke, current.epoch);
  }
  function cancel(event: PointerEvent<SVGSVGElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = null; onDraft(null);
  }
  const strokes = boardPageStrokes(board);
  const visibleDraft = draft && (draft.documentId ?? null) === (board.documentId ?? null) && (draft.page ?? 0) === (board.page ?? 0) && !strokes.some((stroke) => stroke.id === draft.id) ? [draft] : [];
  const canvasHeight = 1000 / aspect;
  return <svg viewBox={`0 0 1000 ${canvasHeight}`} preserveAspectRatio="none" role="img" aria-label={t("liveLesson.board")}
    className="absolute inset-0 block size-full touch-none" style={{ cursor: editable ? "crosshair" : "default" }}
    onPointerDown={down} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {[...strokes, ...visibleDraft].map((stroke) => <BoardMark key={stroke.id} stroke={stroke} canvasHeight={canvasHeight} />)}
  </svg>;
}
