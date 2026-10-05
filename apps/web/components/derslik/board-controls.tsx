"use client";
import { ArrowLeft, ArrowRight, Circle, Eraser, FileText, Highlighter, Minus, Pencil, Plus, Redo2, Square, Trash2, Type, Undo2, Upload, LayoutTemplate } from "lucide-react";
import { boardColors, boardWidths, maxBoardDocuments, t, type BoardStrokeInput, type LessonBoard } from "@derslik/contracts";
import type { BoardTool } from "./board-canvas";

const tools = [
  { id: "pen", icon: Pencil }, { id: "highlighter", icon: Highlighter },
  { id: "line", icon: Minus }, { id: "rectangle", icon: Square },
  { id: "ellipse", icon: Circle }, { id: "note", icon: Type }, { id: "eraser", icon: Eraser },
] as const;
const colorNames = ["black", "blue", "red", "green"] as const;

export function BoardTools({ tool, color, width, disabled, note, onTool, onColor, onWidth, onNote, undo, redo, clear, hasMarks = true }: Readonly<{
  tool: BoardTool; color: BoardStrokeInput["color"]; width: BoardStrokeInput["width"]; disabled: boolean; note: string;
  onTool: (value: BoardTool) => void; onColor: (value: BoardStrokeInput["color"]) => void; onWidth: (value: BoardStrokeInput["width"]) => void; onNote: (value: string) => void;
  undo?: () => void; redo?: () => void; clear?: () => void; hasMarks?: boolean;
}>) {
  return <div className="studio-tools">
    <div className="studio-tool-row" role="toolbar" aria-label={t("liveLesson.drawingTools")}>
      <div className="studio-tool-group">{tools.map(({ id, icon: Icon }) => <button type="button" key={id} className="studio-tool" aria-label={t(`liveLesson.${id}`)} title={t(`liveLesson.${id}`)}
        aria-pressed={tool === id} disabled={disabled} onClick={() => onTool(id)}><Icon size={19} /></button>)}</div>
      <div className="studio-tool-group">{boardColors.map((value, index) => <button type="button" key={value} className="studio-swatch" aria-label={t(`liveLesson.${colorNames[index]}`)}
        title={t(`liveLesson.${colorNames[index]}`)} aria-pressed={color === value} disabled={disabled} onClick={() => onColor(value)}><span style={{ backgroundColor: value }} /></button>)}</div>
      <div className="studio-tool-group">{boardWidths.map((value) => <button type="button" key={value} className="studio-tool studio-width" title={`${t("liveLesson.strokeWidth")} ${value}`} aria-label={`${t("liveLesson.strokeWidth")} ${value}`}
        aria-pressed={width === value} disabled={disabled} onClick={() => onWidth(value)}><span style={{ width: value + 2, height: value + 2 }} /><small>{value}</small></button>)}</div>
      <div className="studio-tool-group studio-history">
        <button type="button" className="studio-tool" aria-label={t("liveLesson.undo")} title={t("liveLesson.undo")} disabled={disabled || !undo} onClick={undo}><Undo2 size={19} /></button>
        <button type="button" className="studio-tool" aria-label={t("liveLesson.redo")} title={t("liveLesson.redo")} disabled={disabled || !redo} onClick={redo}><Redo2 size={19} /></button>
        {clear && <button type="button" className="studio-tool studio-danger" aria-label={t("liveLesson.clearPage")} title={t("liveLesson.clearPage")} disabled={disabled || !hasMarks} onClick={clear}><Trash2 size={18} /></button>}
      </div>
    </div>
    <div className="studio-tool-hint">
      <span className="studio-tool-name">{t(`liveLesson.${tool}`)}</span>
      {tool === "note" ? <input maxLength={300} value={note} disabled={disabled} aria-label={t("liveLesson.notePlaceholder")} placeholder={t("liveLesson.notePlaceholder")} onChange={(event) => onNote(event.target.value)} />
        : <span>{t(tool === "eraser" ? "liveLesson.eraserHint" : "liveLesson.toolHint")}</span>}
    </div>
  </div>;
}

export function BoardDocuments({ board, disabled, uploading, onSelect, onUpload }: Readonly<{
  board: LessonBoard; disabled: boolean; uploading: boolean; onSelect: (id: string | null, page: number) => void; onUpload: () => void;
}>) {
  const documents = board.documents ?? [];
  return <aside className="studio-documents" aria-label={t("liveLesson.documents")}>
    <div className="studio-section-label">{t("liveLesson.documents")}<span>{documents.length}/{maxBoardDocuments}</span></div>
    <div className="studio-document-list">
      <button type="button" className="studio-document" aria-pressed={!board.documentId} disabled={disabled} onClick={() => onSelect(null, 0)}>
        <span className="studio-document-icon"><LayoutTemplate size={19} /></span><span><strong>{t("liveLesson.whiteboard")}</strong><small>{t("liveLesson.freeCanvas")}</small></span>
      </button>
      {documents.map((document) => <button type="button" key={document.id} className="studio-document" aria-pressed={board.documentId === document.id}
        disabled={disabled} onClick={() => onSelect(document.id, 1)} title={document.name}>
        <span className="studio-document-icon studio-pdf-icon"><FileText size={19} /></span><span><strong>{document.name}</strong><small>{t("liveLesson.documentPages", { count: document.pageCount })}</small></span>
      </button>)}
      {board.canClear && <button type="button" className="studio-upload" disabled={disabled || documents.length >= maxBoardDocuments} onClick={onUpload}>
        <Upload size={20} /><span>{t(uploading ? "liveLesson.uploadingPdf" : "liveLesson.uploadPdf")}</span><small>{t("liveLesson.pdfUploadHint")}</small>
      </button>}
    </div>
    <div className="studio-document-tip"><FileText size={24} /><p>{t("liveLesson.documentsHint")}</p></div>
  </aside>;
}

export function BoardPageControls({ board, disabled, zoom, onPage, onZoom, following = true, onFollow }: Readonly<{
  board: LessonBoard; disabled: boolean; zoom: number; onPage: (page: number) => void; onZoom: (zoom: number) => void;
  following?: boolean; onFollow?: () => void;
}>) {
  const document = board.documents?.find((item) => item.id === board.documentId);
  return <div className="studio-page-controls">
    <div className="studio-page-nav">
      <button type="button" aria-label={t("liveLesson.previousPage")} disabled={disabled || !document || board.page <= 1} onClick={() => onPage(board.page - 1)}><ArrowLeft size={16} /></button>
      <span>{document ? `${board.page} / ${document.pageCount}` : t("liveLesson.whiteboard")}</span>
      <button type="button" aria-label={t("liveLesson.nextPage")} disabled={disabled || !document || board.page >= document.pageCount} onClick={() => onPage(board.page + 1)}><ArrowRight size={16} /></button>
    </div>
    {onFollow && <button type="button" className="studio-follow" disabled={disabled} aria-pressed={following} onClick={onFollow}>{t("liveLesson.followTeacher")}</button>}
    <div className="studio-zoom">
      <button type="button" aria-label={t("liveLesson.zoomOut")} disabled={zoom <= 75} onClick={() => onZoom(zoom - 25)}><Minus size={16} /></button>
      <button type="button" aria-label={t("liveLesson.resetZoom")} onClick={() => onZoom(100)}>{zoom}%</button>
      <button type="button" aria-label={t("liveLesson.zoomIn")} disabled={zoom >= 200} onClick={() => onZoom(zoom + 25)}><Plus size={16} /></button>
    </div>
  </div>;
}
