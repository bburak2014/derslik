"use client";
import { useRef } from "react";
import { LoaderCircle, LockKeyhole, PencilLine, X, Check } from "lucide-react";
import { maxBoardStrokes, t, type LessonBoard } from "@derslik/contracts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BoardCanvas } from "./board-canvas";
import { BoardDocuments, BoardPageControls, BoardTools } from "./board-controls";
import { BoardPdfCanvas } from "./board-pdf";
import { useLessonBoard } from "./use-lesson-board";
import "./lesson-board.css";

export { BoardCanvas } from "./board-canvas";
type Studio = ReturnType<typeof useLessonBoard>;

export function LessonBoardDialog({ initial, base, title, onClose }: Readonly<{
  initial: LessonBoard; base: string; title: string; onClose: () => void;
}>) {
  const studio = useLessonBoard(initial, base, onClose);
  const input = useRef<HTMLInputElement>(null);
  return <Dialog open onOpenChange={(open) => { if (!open) studio.close(); }}>
    <DialogContent className="lesson-studio" showCloseButton={false}>
      <DialogHeader className="studio-header">
        <div className="studio-brand"><PencilLine size={23} /></div>
        <div className="studio-heading"><div className="studio-eyebrow">{t("liveLesson.lessonStudio")}</div><DialogTitle>{title}</DialogTitle><DialogDescription>{t("liveLesson.studioDescription")}</DialogDescription></div>
        <span className="studio-access">{studio.board.canEdit ? <PencilLine size={14} /> : <LockKeyhole size={14} />}{t(studio.board.canEdit ? "liveLesson.sharedCanvas" : "liveLesson.viewOnly")}</span>
        <button type="button" className="studio-close" aria-label={t("liveLesson.close")} disabled={studio.busy} onClick={studio.close}><X size={20} /></button>
      </DialogHeader>
      <div className="studio-body">
        <BoardDocuments board={studio.board} disabled={studio.navigationDisabled} uploading={studio.uploading} onSelect={studio.select} onUpload={() => input.current?.click()} />
        <input ref={input} className="hidden" type="file" accept="application/pdf,.pdf" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void studio.upload(file); }} />
        <BoardWorkspace studio={studio} />
      </div>
      <BoardFooter studio={studio} />
    </DialogContent>
  </Dialog>;
}

function BoardWorkspace({ studio: s }: Readonly<{ studio: Studio }>) {
  const { board, scope, pageState } = s;
  const paperWidth = scope.documentId ? `${s.zoom}%` : `min(${s.zoom}%,calc((100cqh - 56px) * ${s.aspect} * ${s.zoom / 100}))`;
  function clear() {
    if (window.confirm(t("liveLesson.clearPageWarning"))) s.change({ action: "page.clear", epoch: board.epoch, ...scope });
  }
  return <main className="studio-workspace">
    <BoardTools tool={s.tool} color={s.color} width={s.width} note={s.note} disabled={s.toolsDisabled} onTool={s.setTool} onColor={s.setColor} onWidth={s.setWidth} onNote={s.setNote}
      undo={s.undo ? () => s.remove(s.undo!.id) : undefined}
      redo={s.redo ? () => s.change({ action: "stroke.restore", epoch: board.epoch, id: s.redo!, ...scope }) : undefined}
      clear={board.canClear ? clear : undefined} hasMarks={s.visible.length > 0} />
    <div className="studio-stage" aria-busy={!!scope.documentId && !s.ready && !s.pdfError}>
      <div className={`studio-paper${scope.documentId ? " studio-paper-pdf" : " studio-paper-grid"}`} style={{ aspectRatio: s.aspect, width: paperWidth, maxWidth: `${(scope.documentId ? 640 : 1000) * s.zoom / 100}px` }}>
        {pageState.page && <BoardPdfCanvas key={`${s.scopeKey}:${s.pdfRetry}`} page={pageState.page} onReady={s.onPdfReady} onError={s.onPdfError} />}
        <BoardCanvas key={`${s.scopeKey}:${s.zoom}:${board.canEdit}`} board={board} editable={!s.toolsDisabled && s.ready && !s.pdfError && board.strokes.length < maxBoardStrokes}
          color={s.color} width={s.width} tool={s.tool} note={s.note} draft={s.draft} onDraft={s.setDraft} onErase={s.remove} aspect={s.aspect}
          onStroke={(stroke, epoch) => s.change({ action: "stroke.add", epoch, stroke })} />
        <BoardPaperState studio={s} />
      </div>
    </div>
    <BoardPageControls board={board} disabled={s.navigationDisabled} zoom={s.zoom} onZoom={s.setZoom} onPage={(page) => s.select(scope.documentId, page)} following={s.following} onFollow={s.followTeacher} />
  </main>;
}

function BoardPaperState({ studio: s }: Readonly<{ studio: Studio }>) {
  if (s.scope.documentId) {
    if (s.ready && !s.pdfError) return null;
    return <div className="studio-pdf-state">
      {s.pdfError ? <><LockKeyhole size={28} /><p>{s.pdfError}</p><button type="button" onClick={() => s.setPdfRetry((value) => value + 1)}>{t("liveLesson.retry")}</button></>
        : <><LoaderCircle size={28} className="animate-spin" /><p>{t("liveLesson.pdfLoading")}</p></>}
    </div>;
  }
  if (s.visible.length || s.draft) return null;
  return <div className="studio-empty" aria-hidden="true"><PencilLine size={28} /><strong>{t("liveLesson.emptyCanvasTitle")}</strong><span>{t("liveLesson.emptyCanvasHint")}</span></div>;
}

function BoardFooter({ studio: s }: Readonly<{ studio: Studio }>) {
  let status = t("liveLesson.synced");
  if (s.statusError) status = t("liveLesson.connectionError");
  if (s.busy) status = t("liveLesson.saving");
  let hint = t(s.board.canEdit ? "liveLesson.boardHint" : "liveLesson.readOnly");
  if (s.board.strokes.length >= maxBoardStrokes) hint = t("liveLesson.boardFull");
  function discard() { s.setPending(null); s.setDraft(null); s.setError(""); void s.session.refresh(); }
  return <div className="studio-footer" aria-live="polite">
    <div className={`studio-sync${s.statusError ? " studio-sync-error" : ""}`}>{s.busy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}<span>{status}</span></div>
    <div className="studio-feedback"><p role={s.statusError ? "alert" : undefined}>{s.error || s.state.error || hint}</p>
      {s.pending && !s.state.saving && <div><button type="button" onClick={() => void s.save(s.pending!)}>{t("liveLesson.retry")}</button><button type="button" onClick={discard}>{t("liveLesson.discardDrawing")}</button></div>}
    </div>
    <span className="studio-annotation-count">{t("liveLesson.pageAnnotations", { count: s.visible.length })}</span>
  </div>;
}
