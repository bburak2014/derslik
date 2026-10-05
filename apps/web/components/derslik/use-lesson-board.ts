"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boardPageStrokes, boardScope, boardUndoStroke, LessonBoardSession, type LessonBoardState } from "@derslik/api-client";
import { boardColors, t, type BoardStrokeInput, type LessonBoard, type LessonBoardCommand, type LessonBoardReadResult } from "@derslik/contracts";
import type { PDFPageProxy } from "pdfjs-dist";
import { backend } from "@/lib/client";
import type { BoardTool } from "./board-canvas";
import { useBoardPdf, useBoardPdfPage } from "./board-pdf";
import { BoardPdfUploader } from "./board-upload";


type Pending = { command: LessonBoardCommand; key: string };
type BoardView = { documentId: string | null; page: number };

function displayBoard(shared: LessonBoard, view: BoardView | null): LessonBoard {
  if (!view) return shared;
  if (view.documentId) {
    const document = shared.documents.find((item) => item.id === view.documentId);
    if (!document || view.page < 1 || view.page > document.pageCount) return shared;
  }
  return { ...shared, ...view, canEdit: false, canClear: false };
}

export function useLessonBoard(initial: LessonBoard, base: string, onClose: () => void) {
  const [state, setState] = useState<LessonBoardState>({ board: initial, loading: false, saving: false, error: null });
  const [color, setColor] = useState<BoardStrokeInput["color"]>(boardColors[0]), [width, setWidth] = useState<BoardStrokeInput["width"]>(4);
  const [tool, setTool] = useState<BoardTool>("pen"), [note, setNote] = useState(""), [zoom, setZoom] = useState(100);
  const [drawing, setDrawing] = useState<{ stroke: BoardStrokeInput | null; epoch: number }>({ stroke: null, epoch: initial.epoch }), [pending, setPending] = useState<Pending | null>(null), [error, setError] = useState("");
  const [uploading, setUploading] = useState(false), [pdfRetry, setPdfRetry] = useState(0), [rendered, setRendered] = useState<PDFPageProxy | null>(null), [renderError, setRenderError] = useState<PDFPageProxy | null>(null);
  const [history, setHistory] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [localView, setLocalView] = useState<BoardView | null>(null);
  const mounted = useRef(true), sending = useRef(false), uploadLock = useRef(false);
  const uploader = useMemo(() => new BoardPdfUploader(base), [base]);
  const session = useMemo(() => new LessonBoardSession({
    initial,
    load: (revision) => {
      if (document.visibilityState === "hidden") return Promise.resolve({ data: null });
      const url = revision === undefined ? base : `${base}?revision=${revision}`;
      return backend<LessonBoardReadResult>(url);
    },
    change: (command, key) => backend<{ data: LessonBoard }>(base, command, key),
    onChange: (next) => {
      if (next.board && !next.board.canEdit) setDrawing({ stroke: null, epoch: next.board.epoch });
      setState(next);
    },
  }), [base, initial]);
  useEffect(() => {
    mounted.current = true; session.start();
    return () => { mounted.current = false; session.stop(); };
  }, [session]);
  const sharedBoard = state.board ?? initial, board = displayBoard(sharedBoard, localView);
  const following = board === sharedBoard, scope = boardScope(board), scopeKey = `${board.epoch}:${scope.documentId}:${scope.page}`;
  const currentDrawing = drawing.epoch === board.epoch && (drawing.stroke?.documentId ?? null) === scope.documentId && (drawing.stroke?.page ?? 0) === scope.page;
  const draft = currentDrawing ? drawing.stroke : null;
  function setDraft(stroke: BoardStrokeInput | null) {
    if (!sending.current) setDrawing({ stroke, epoch: board.epoch });
  }
  function zoomTo(value: number) { setDraft(null); setZoom(value); }
  const pdfState = useBoardPdf(base, scope.documentId, pdfRetry), pageState = useBoardPdfPage(pdfState.pdf, board.page);
  const ready = !scope.documentId || (!!pageState.page && rendered === pageState.page);
  const failedRender = pageState.page && renderError === pageState.page;
  const pdfError = pdfState.error || pageState.error || (failedRender ? t("liveLesson.pdfError") : "");
  const navigationDisabled = state.saving || !!pending || uploading;
  const toolsDisabled = !board.canEdit || navigationDisabled;
  const visible = boardPageStrokes(board), undo = boardUndoStroke(board);
  const redo = history.scope === scopeKey ? history.ids.at(-1) : undefined;
  const onPdfReady = useCallback((page: PDFPageProxy) => setRendered(page), []);
  const onPdfError = useCallback(() => setRenderError(pageState.page ?? null), [pageState.page]);
  async function save(change: Pending) {
    if (sending.current) return;
    sending.current = true; setPending(change);
    const saved = await session.save(change.command, change.key);
    sending.current = false;
    if (!mounted.current) return;
    if (!saved) { setError(session.state.error ?? t("liveLesson.connectionError")); return; }
    setPending(null); setDraft(null); setError("");
    const command = change.command;
    if (command.action === "stroke.remove")
      setHistory((previous) => ({ scope: scopeKey, ids: [...(previous.scope === scopeKey ? previous.ids : []), command.id] }));
    else if (command.action === "stroke.restore")
      setHistory((previous) => ({ ...previous, ids: previous.ids.filter((id) => id !== command.id) }));
    else if (command.action !== "document.select") setHistory({ scope: scopeKey, ids: [] });
  }
  function change(command: LessonBoardCommand) { void save({ command, key: crypto.randomUUID() }); }
  function remove(id: string) { change({ action: "stroke.remove", epoch: board.epoch, id, ...scope }); }
  function select(documentId: string | null, page: number) {
    if (navigationDisabled) return;
    setDraft(null);
    if (sharedBoard.canClear) change({ action: "document.select", epoch: sharedBoard.epoch, documentId, page });
    else setLocalView({ documentId, page });
  }
  function follow() { if (!navigationDisabled) { setDraft(null); setLocalView(null); } }
  function close() {
    if (!state.saving && !uploading && (!pending || window.confirm(t("liveLesson.unsavedWarning")))) onClose();
  }
  async function upload(file: File) {
    if (uploadLock.current || toolsDisabled || !board.canClear) return;
    uploadLock.current = true; setUploading(true); setError("");
    try {
      const document = await uploader.upload(file);
      if (mounted.current) await save({ command: { action: "document.add", epoch: session.state.board?.epoch ?? board.epoch, ...document }, key: crypto.randomUUID() });
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t("liveLesson.pdfError")); }
    finally { uploadLock.current = false; if (mounted.current) setUploading(false); }
  }
  const viewport = pageState.page?.getViewport({ scale: 1 });
  const aspect = viewport ? viewport.width / viewport.height : 5 / 3;
  const statusError = !!(error || state.error || pending), busy = state.saving || uploading;
  const followTeacher = sharedBoard.canClear ? undefined : follow;
  return { board, state, color, setColor, width, setWidth, tool, setTool, note, setNote, zoom, setZoom: zoomTo,
    draft, setDraft, pending, setPending, error, setError, uploading, pdfRetry, setPdfRetry,
    scope, scopeKey, pageState, ready, pdfError, toolsDisabled, navigationDisabled, following, follow, followTeacher, sharedBoard, visible, undo, redo, onPdfReady, onPdfError,
    save, change, remove, select, close, upload, aspect, statusError, busy, session };
}
