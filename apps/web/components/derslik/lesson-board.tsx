"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { appendBoardPoint, boardPoint, boardStrokePath, boardUndoStroke, LessonBoardSession, type LessonBoardState } from "@derslik/api-client";
import { boardColors, boardWidths, maxBoardStrokes, t, type BoardStrokeInput, type LessonBoard, type LessonBoardCommand, type LessonBoardReadResult } from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "./loading";
import { FormError } from "./feedback";

type Pending = { command: LessonBoardCommand; key: string };

function point(event: PointerEvent<SVGSVGElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  return boardPoint(event.clientX - box.left, event.clientY - box.top, box.width, box.height);
}

export function BoardCanvas({ board, editable, color, width, draft, onDraft, onStroke }: Readonly<{
  board: LessonBoard;
  editable: boolean;
  color: BoardStrokeInput["color"];
  width: BoardStrokeInput["width"];
  draft: BoardStrokeInput | null;
  onDraft: (stroke: BoardStrokeInput | null) => void;
  onStroke: (stroke: BoardStrokeInput, epoch: number) => void;
}>) {
  const gesture = useRef<{ stroke: BoardStrokeInput; epoch: number; pointer: number } | null>(null);
  function down(event: PointerEvent<SVGSVGElement>) {
    if (!editable || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    const stroke = { id: crypto.randomUUID(), points: [point(event)], color, width };
    gesture.current = { stroke, epoch: board.epoch, pointer: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    onDraft(stroke);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (current?.pointer !== event.pointerId) return;
    const stroke = { ...current.stroke, points: appendBoardPoint(current.stroke.points, point(event)) };
    gesture.current = { ...current, stroke };
    onDraft(stroke);
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (current?.pointer !== event.pointerId) return;
    gesture.current = null;
    const stroke = { ...current.stroke, points: appendBoardPoint(current.stroke.points, point(event)) };
    onDraft(stroke);
    onStroke(stroke, current.epoch);
  }
  return (
    <svg viewBox="0 0 1000 600" role="img" aria-label={t("liveLesson.board")}
      className="block shrink-0 aspect-[5/3] w-full touch-none rounded-xl border bg-white"
      style={{ cursor: editable ? "crosshair" : "default" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={() => { gesture.current = null; onDraft(null); }}>
      {[...board.strokes, ...(draft && !board.strokes.some((stroke) => stroke.id === draft.id) ? [draft] : [])].map((stroke) =>
        stroke.points.length === 1
          ? <circle key={stroke.id} cx={stroke.points[0].x * 1000} cy={stroke.points[0].y * 600} r={stroke.width / 2} fill={stroke.color} />
          : <path key={stroke.id} d={boardStrokePath(stroke.points)} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />,
      )}
    </svg>
  );
}

export function LessonBoardDialog({ initial, base, title, onClose }: Readonly<{
  initial: LessonBoard; base: string; title: string; onClose: () => void;
}>) {
  const [state, setState] = useState<LessonBoardState>({ board: initial, loading: false, saving: false, error: null }),
    [color, setColor] = useState<BoardStrokeInput["color"]>(boardColors[0]),
    [width, setWidth] = useState<BoardStrokeInput["width"]>(4),
    [draft, setDraft] = useState<BoardStrokeInput | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [error, setError] = useState("");
  const mounted = useRef(true), sending = useRef(false);
  const session = useMemo(() => new LessonBoardSession({
    initial,
    load: (revision) => {
      if (document.visibilityState === "hidden") return Promise.resolve({ data: null });
      const url = revision === undefined ? base : `${base}?revision=${revision}`;
      return backend<LessonBoardReadResult>(url);
    },
    change: (command, key) => backend<{ data: LessonBoard }>(base, command, key),
    onChange: setState,
  }), [base, initial]);
  useEffect(() => {
    mounted.current = true;
    session.start();
    return () => { mounted.current = false; session.stop(); };
  }, [session]);
  const board = state.board ?? initial;
  async function save(change: Pending) {
    if (sending.current) return;
    sending.current = true;
    setPending(change);
    const saved = await session.save(change.command, change.key);
    sending.current = false;
    if (!mounted.current) return;
    if (saved) { setPending(null); setDraft(null); setError(""); }
    else setError(session.state.error ?? t("liveLesson.connectionError"));
  }
  function change(command: LessonBoardCommand) {
    void save({ command, key: crypto.randomUUID() });
  }
  function close() {
    if (!state.saving && (!pending || window.confirm(t("liveLesson.unsavedWarning")))) onClose();
  }
  const undo = boardUndoStroke(board);
  const toolsDisabled = !board.canEdit || state.saving || !!pending;
  const colors = ["black", "blue", "red", "green"] as const;
  let status = t("liveLesson.synced");
  if (error || state.error || pending) status = t("liveLesson.connectionError");
  if (state.saving) status = t("liveLesson.saving");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="flex h-[min(90dvh,50rem)] flex-col overflow-hidden sm:max-w-4xl" showCloseButton={!state.saving}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("liveLesson.board")} · {title}</DialogTitle>
          <DialogDescription className="min-h-10">{board.canEdit ? t("liveLesson.boardHint") : t("liveLesson.readOnly")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2" aria-label={t("liveLesson.pen")}>
            {boardColors.map((choice, index) => <Button key={choice} size="icon-sm" variant="outline"
              aria-label={t(`liveLesson.${colors[index]}`)} aria-pressed={choice === color}
              disabled={toolsDisabled} onClick={() => setColor(choice)}
              className={choice === color ? "ring-primary ring-2 ring-offset-2" : ""}>
              <span className="size-5 rounded-full" style={{ backgroundColor: choice }} />
            </Button>)}
            {boardWidths.map((choice) => <Button key={choice} size="sm" variant={choice === width ? "default" : "outline"}
              aria-pressed={choice === width} disabled={toolsDisabled} onClick={() => setWidth(choice)}>{choice}</Button>)}
            <Button size="sm" variant="outline" disabled={toolsDisabled || !undo}
              onClick={() => undo && change({ action: "stroke.remove", epoch: board.epoch, id: undo.id })}>{t("liveLesson.undo")}</Button>
            {board.canClear && <Button size="sm" variant="outline" disabled={toolsDisabled || !board.strokes.length}
              onClick={() => { if (window.confirm(t("liveLesson.clearWarning"))) change({ action: "board.clear", epoch: board.epoch }); }}>{t("liveLesson.clear")}</Button>}
          </div>
          <BoardCanvas board={board} editable={!toolsDisabled && board.strokes.length < maxBoardStrokes}
            color={color} width={width} draft={draft} onDraft={setDraft}
            onStroke={(stroke, epoch) => change({ action: "stroke.add", epoch, stroke })} />
          <div className="min-h-24 space-y-2" aria-live="polite">
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              {state.saving && <Spinner />}{status}
            </p>
            {(error || state.error) && <FormError>{error || state.error}</FormError>}
            {board.strokes.length >= maxBoardStrokes && <p className="text-sm">{t("liveLesson.boardFull")}</p>}
            {pending && !state.saving && <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void save(pending)}>{t("liveLesson.retry")}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setPending(null); setDraft(null); setError(""); void session.refresh(); }}>{t("liveLesson.discardDrawing")}</Button>
            </div>}
          </div>
        </div>
        <DialogFooter className="shrink-0"><Button variant="outline" disabled={state.saving} onClick={close}>{t("liveLesson.close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
