import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View,
  type GestureResponderEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText, TSpan } from "react-native-svg";
import * as Crypto from "expo-crypto";
import {
  boardColors, boardTools, boardWidths, maxBoardDocuments, maxBoardStrokes, t,
  type BoardStrokeInput, type LessonBoard, type LessonBoardCommand,
} from "@derslik/contracts";
import {
  boardGesturePoints, boardHitStroke, boardNoteLayout, boardPageStrokes, boardPoint, boardScope, boardStrokePath, boardUndoStroke,
  LessonBoardSession, type LessonBoardState,
} from "@derslik/api-client";
import { client } from "./core";
import { Button, CloseButton, confirmAction, ErrorText, useTheme, type IconName } from "./ui";
import { NativeBoardPdf, type NativePdfPage } from "./lesson-board-pdf";
import { uploadBoardPdf, type BoardPdfReservations, type BoardPdfUpload } from "./lesson-board-upload";

type BoardScope = { workspaceId: string; studentId: string; lessonId: string; portal: boolean };
type PendingChange = { command: LessonBoardCommand; key: string };
type Tool = NonNullable<BoardStrokeInput["tool"]> | "eraser";
type PdfState = { scope: string; page: number; url: string; ready: boolean; aspectRatio: number; error: string };
type RedoState = { scope: string; ids: string[] };
type LocalBoardScope = Pick<LessonBoard, "documentId" | "page">;
const toolIcons: Record<Tool, IconName> = {
  pen: "pencil-outline", highlighter: "brush-outline", line: "remove-outline", rectangle: "square-outline",
  ellipse: "ellipse-outline", note: "text-outline", eraser: "backspace-outline",
};
function pageKey(board: LessonBoard) {
  const scope = boardScope(board);
  return `${scope.documentId ?? "whiteboard"}:${scope.page}`;
}
function nativePaperAspect(documentId: string | null, pdf: PdfState) {
  return documentId && pdf.scope === documentId && pdf.ready ? pdf.aspectRatio : 5 / 3;
}
function nativeLocalBoard(shared: LessonBoard, local: LocalBoardScope | null) {
  if (!local) return null;
  if (local.documentId) {
    const document = shared.documents?.find((item) => item.id === local.documentId);
    if (!document || local.page < 1 || local.page > document.pageCount) return null;
  } else if (local.page !== 0) return null;
  return { ...shared, ...local, canEdit: false, canClear: false };
}
function visibleNativeDraft(draft: BoardStrokeInput | null, epoch: number, board: LessonBoard, pending: boolean) {
  if (!draft || (!board.canEdit && !pending) || epoch !== board.epoch) return null;
  const scope = boardScope(board);
  return (draft.documentId ?? null) === scope.documentId && (draft.page ?? 0) === scope.page ? draft : null;
}

export function NativeLessonBoard({ initial, title, onClose, ...scope }: Readonly<BoardScope & {
  initial: LessonBoard; title: string; onClose: () => void;
}>) {
  const { colors, styles, section } = useTheme();
  const [state, setState] = useState<LessonBoardState>({ board: initial, loading: false, saving: false, error: null }),
    [color, setColor] = useState<BoardStrokeInput["color"]>(boardColors[0]),
    [width, setWidth] = useState<BoardStrokeInput["width"]>(4),
    [tool, setTool] = useState<Tool>("pen"),
    [noteText, setNoteText] = useState(""),
    [draft, setDraft] = useState<BoardStrokeInput | null>(null),
    [draftEpoch, setDraftEpoch] = useState(initial.epoch),
    [pending, setPending] = useState<PendingChange | null>(null),
    [redo, setRedo] = useState<RedoState>({ scope: "", ids: [] }),
    [pdf, setPdf] = useState<PdfState>({ scope: "", page: 0, url: "", ready: false, aspectRatio: 5 / 3, error: "" }),
    [pdfRetry, setPdfRetry] = useState(0),
    [zoom, setZoom] = useState(1),
    [canvasWidth, setCanvasWidth] = useState(0),
    [panEnabled, setPanEnabled] = useState(false),
    [localView, setLocalView] = useState<LocalBoardScope | null>(null),
    [uploading, setUploading] = useState(false),
    [upload, setUpload] = useState<BoardPdfUpload | null>(null),
    [error, setError] = useState("");
  const gesture = useRef<{ stroke: BoardStrokeInput; epoch: number; scope: string } | null>(null),
    uploadReservations = useRef<BoardPdfReservations>(new Map()),
    displayedPage = useRef(pageKey(initial)),
    frame = useRef({ width: 0, height: 0 }), mounted = useRef(true), sending = useRef(false);
  const { workspaceId, studentId, lessonId, portal } = scope;
  const acceptState = useCallback((next: LessonBoardState) => {
    if (next.board && !next.board.canEdit && gesture.current) {
      gesture.current = null; setDraft(null);
    }
    setState(next);
  }, []);
  // eslint-disable-next-line react-hooks/refs -- The constructor only stores callbacks; acceptState reads gesture refs when publish runs from start/refresh/save outside render.
  const session = useMemo(() => new LessonBoardSession({
    initial,
    load: (revision) => AppState.currentState === "active"
      ? client.lessonBoard(workspaceId, studentId, lessonId, portal, revision) : Promise.resolve({ data: null }),
    change: (command, key) => client.changeLessonBoard(workspaceId, studentId, lessonId, command, key, portal),
    onChange: acceptState,
  }), [workspaceId, studentId, lessonId, portal, initial, acceptState]);
  useEffect(() => {
    mounted.current = true;
    session.start();
    return () => { mounted.current = false; session.stop(); };
  }, [session]);
  const sharedBoard = state.board ?? initial, localBoard = nativeLocalBoard(sharedBoard, localView);
  const board = localBoard ?? sharedBoard, active = boardScope(board), activeKey = pageKey(board);
  useEffect(() => { displayedPage.current = activeKey; }, [activeKey]);
  const documentKey = active.documentId ?? "";
  const historyKey = `${activeKey}:${board.epoch}`;
  const paperAspect = nativePaperAspect(active.documentId, pdf), canvasHeight = 1000 / paperAspect;
  const documents = board.documents ?? [], strokes = boardPageStrokes(board);
  const document = documents.find((item) => item.id === active.documentId);
  useEffect(() => {
    if (!active.documentId) return;
    let cancelled = false;
    client.lessonBoardDocument(workspaceId, studentId, lessonId, active.documentId, portal)
      .then(({ data }) => {
        if (!cancelled) setPdf({ scope: documentKey, page: 0, url: data.url, ready: false, aspectRatio: 5 / 3, error: "" });
      }).catch(() => {
        if (!cancelled) setPdf({ scope: documentKey, page: 0, url: "", ready: false, aspectRatio: 5 / 3, error: t("liveLesson.pdfError") });
      });
    return () => { cancelled = true; };
  }, [workspaceId, studentId, lessonId, portal, active.documentId, documentKey, pdfRetry]);
  const busy = state.saving || uploading;
  const save = useCallback(async (next: PendingChange) => {
    if (sending.current) return;
    sending.current = true;
    setPending(next);
    try {
      const saved = await session.save(next.command, next.key);
      if (!mounted.current) return;
      if (!saved) { setError(session.state.error ?? t("liveLesson.connectionError")); return; }
      setPending(null); setDraft(null); setError("");
      const action = next.command.action;
      if (action === "stroke.remove") {
        const { id } = next.command;
        setRedo((previous) => ({ scope: historyKey, ids: [...(previous.scope === historyKey ? previous.ids.filter((item) => item !== id) : []), id] }));
      } else if (action === "stroke.restore") {
        const { id } = next.command;
        setRedo((previous) => ({ ...previous, ids: previous.ids.filter((item) => item !== id) }));
      } else setRedo({ scope: historyKey, ids: [] });
      if (action === "stroke.add" && next.command.stroke.tool === "note") setNoteText("");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally { sending.current = false; }
  }, [session, historyKey]);
  const change = useCallback((command: LessonBoardCommand) => {
    void save({ command, key: Crypto.randomUUID() });
  }, [save]);
  const pdfReady = !active.documentId || (pdf.scope === documentKey && pdf.page === active.page && pdf.ready);
  const toolsEditable = board.canEdit && !busy && !pending;
  const editable = toolsEditable && !panEnabled && pdfReady && board.strokes.length < maxBoardStrokes;
  const responder = useMemo(() => {
    const point = (event: GestureResponderEvent) => boardPoint(event.nativeEvent.locationX, event.nativeEvent.locationY, frame.current.width, frame.current.height);
    // eslint-disable-next-line react-hooks/refs -- PanResponder registers callbacks; refs are only read when native gestures invoke them.
    return PanResponder.create({
      onStartShouldSetPanResponder: () => editable && !sending.current && !gesture.current && frame.current.width > 0,
      onMoveShouldSetPanResponder: () => editable && !sending.current && !gesture.current,
      onPanResponderGrant: (event) => {
        if (!editable || sending.current || gesture.current) return;
        if (tool === "eraser") {
          const hit = boardHitStroke(board, point(event), paperAspect);
          if (hit) change({ action: "stroke.remove", epoch: board.epoch, id: hit.id, ...active });
          return;
        }
        if (tool === "note" && !noteText.trim()) return;
        const next: BoardStrokeInput = {
          id: Crypto.randomUUID(), color, width, tool, ...active, points: [point(event)],
          ...(tool === "note" ? { text: noteText.trim() } : {}),
        };
        gesture.current = { stroke: next, epoch: board.epoch, scope: activeKey };
        setDraftEpoch(board.epoch);
        setDraft(next);
      },
      onPanResponderMove: (event) => {
        const current = gesture.current;
        if (!current) return;
        if (!editable || current.scope !== activeKey || current.epoch !== board.epoch) { gesture.current = null; setDraft(null); return; }
        const next = { ...current.stroke, points: boardGesturePoints(current.stroke, point(event)) };
        gesture.current = { ...current, stroke: next }; setDraft(next);
      },
      onPanResponderRelease: (event?: GestureResponderEvent) => {
        const current = gesture.current;
        gesture.current = null;
        if (!current) return;
        if (!editable || current.scope !== activeKey || current.epoch !== board.epoch) { setDraft(null); return; }
        const last = event ? point(event) : current.stroke.points.at(-1)!;
        const stroke = { ...current.stroke, points: boardGesturePoints(current.stroke, last) };
        setDraft(stroke);
        change({ action: "stroke.add", epoch: current.epoch, stroke });
      },
      onPanResponderTerminate: () => { gesture.current = null; setDraft(null); },
      onPanResponderTerminationRequest: () => false,
    });
  }, [editable, tool, noteText, color, width, board, active, activeKey, paperAspect, change]);
  function close() {
    if (busy) return;
    if (pending) confirmAction(t("liveLesson.discardDrawing"), t("liveLesson.unsavedWarning"), onClose, setError);
    else onClose();
  }
  function discard() { setPending(null); setDraft(null); setError(""); void session.refresh(); }
  function changeZoom(value: number) {
    gesture.current = null; setDraft(null); setZoom(value);
  }
  function selectView(documentId: string | null, page: number) {
    if (busy || pending) return;
    gesture.current = null; setDraft(null);
    if (sharedBoard.canClear && toolsEditable)
      change({ action: "document.select", epoch: sharedBoard.epoch, documentId, page });
    else setLocalView({ documentId, page });
  }
  function followTeacher() {
    if (busy || pending) return;
    gesture.current = null; setDraft(null); setLocalView(null);
  }
  async function choosePdf() {
    if (!board.canClear || busy || pending || documents.length >= maxBoardDocuments) return;
    setUploading(true); setError("");
    try {
      const candidate = await uploadBoardPdf(workspaceId, studentId, uploadReservations.current);
      if (!mounted.current) return;
      if (candidate) setUpload(candidate);
      else setUploading(false);
    } catch (e) {
      if (mounted.current) { setError((e as Error).message); setUploading(false); }
    }
  }
  function uploadedPdfReady(page: NativePdfPage) {
    if (!upload || !mounted.current) return;
    const candidate = upload;
    setUpload(null); setUploading(false);
    change({ action: "document.add", epoch: board.epoch, id: candidate.id, pageCount: page.pageCount });
  }
  function pdfPageReady(page: NativePdfPage) {
    if (displayedPage.current !== activeKey) return;
    setPdf((previous) => ({ ...previous, page: active.page, ready: true, aspectRatio: page.aspectRatio, error: "" }));
  }
  function pdfPageError() {
    if (displayedPage.current !== activeKey) return;
    setPdf((previous) => ({ ...previous, ready: false, error: t("liveLesson.pdfError") }));
  }
  const undo = boardUndoStroke(board), redoId = redo.scope === historyKey ? redo.ids.at(-1) : undefined;
  const visibleDraft = visibleNativeDraft(draft, draftEpoch, board, !!pending);
  const pdfError = active.documentId && pdf.scope === documentKey ? pdf.error : "";
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <SafeAreaView style={[styles.screen, { flex: 1, backgroundColor: colors.canvas }]} edges={["top", "bottom"]}>
      <View style={[section.sheetHeader, { backgroundColor: colors.surface }]}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="easel-outline" size={23} color={colors.brand} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle}>{t("liveLesson.board")}</Text>
          <Text style={styles.muted} numberOfLines={1}>{title}</Text>
        </View>
        <CloseButton onPress={close} disabled={busy} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { gap: 16, paddingBottom: 24 }]} scrollEnabled={!visibleDraft || !!pending}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={[styles.caption, { flex: 1 }]} numberOfLines={2}>{board.canEdit ? t("liveLesson.boardHint") : t("liveLesson.readOnly")}</Text>
          {board.canClear && <Button size="sm" secondary icon="document-attach-outline" loading={uploading} disabled={!toolsEditable || documents.length >= maxBoardDocuments} onPress={() => void choosePdf()}>
            {t("liveLesson.uploadPdf")}
          </Button>}
        </View>
        <NativeBoardDocuments board={board} disabled={busy || !!pending} onSelect={selectView} />
        <NativeFollowTeacher following={!localBoard} disabled={busy || !!pending} onPress={followTeacher} />
        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 12, gap: 12 }}>
          <NativeBoardTools color={color} width={width} tool={tool} editable={toolsEditable} onColor={setColor} onWidth={setWidth} onTool={(next) => { setTool(next); setPanEnabled(false); }} />
          {tool === "note" && <TextInput value={noteText} onChangeText={setNoteText} editable={toolsEditable} maxLength={300} placeholder={t("liveLesson.notePlaceholder")} placeholderTextColor={colors.muted}
            accessibilityLabel={t("liveLesson.note")} style={{ minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.canvas }} />}
        </View>
        <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.caption, { flex: 1 }]} numberOfLines={1}>{document?.name ?? t("liveLesson.whiteboard")}</Text>
            <Text style={styles.caption}>{t("liveLesson.pageAnnotations", { count: strokes.length })}</Text>
          </View>
          <View onLayout={(event) => setCanvasWidth(event.nativeEvent.layout.width)}>
          <ScrollView horizontal scrollEnabled={panEnabled || !board.canEdit} showsHorizontalScrollIndicator={zoom > 1} contentContainerStyle={{ width: canvasWidth ? canvasWidth * zoom : "100%" }}>
          <View accessibilityLabel={t("liveLesson.board")} style={{ width: canvasWidth ? canvasWidth * zoom : "100%", aspectRatio: paperAspect, backgroundColor: "#ffffff", borderRadius: 12, overflow: "hidden" }}
            onLayout={(event) => { frame.current = event.nativeEvent.layout; }} {...responder.panHandlers}>
            {!!active.documentId && pdf.scope === documentKey && !!pdf.url && <View style={{ position: "absolute", inset: 0 }} pointerEvents="none">
              <NativeBoardPdf key={`${documentKey}:${pdfRetry}`} url={pdf.url} page={active.page} onReady={pdfPageReady} onError={pdfPageError} />
            </View>}
            {!!active.documentId && !pdfReady && <View style={{ position: "absolute", inset: 0, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", gap: 10 }}>
              {!pdfError && <ActivityIndicator color={colors.brand} />}
              <Text style={[styles.caption, { paddingHorizontal: 20, textAlign: "center" }]}>{pdfError || t("liveLesson.pdfLoading")}</Text>
            </View>}
            <Svg width="100%" height="100%" viewBox={`0 0 1000 ${canvasHeight}`} pointerEvents="none" opacity={pdfReady ? 1 : 0}>
              {!active.documentId && <G opacity={0.5}>
                {Array.from({ length: 19 }, (_, i) => <Line key={`x${i}`} x1={(i + 1) * 50} x2={(i + 1) * 50} y1={0} y2={600} stroke="#e2e5ef" strokeWidth={1} />)}
                {Array.from({ length: 11 }, (_, i) => <Line key={`y${i}`} x1={0} x2={1000} y1={(i + 1) * 50} y2={(i + 1) * 50} stroke="#e2e5ef" strokeWidth={1} />)}
              </G>}
              {strokes.map((stroke) => <NativeBoardStroke key={stroke.id} stroke={stroke} canvasHeight={canvasHeight} />)}
              {visibleDraft && !strokes.some((stroke) => stroke.id === visibleDraft.id) && <NativeBoardStroke stroke={visibleDraft} canvasHeight={canvasHeight} />}
            </Svg>
          </View>
          </ScrollView>
          </View>
          <View style={[styles.row, { justifyContent: "space-between", flexWrap: "wrap" }]}>
            <Button size="sm" secondary={!panEnabled} icon="hand-left-outline" disabled={busy || !!pending} onPress={() => setPanEnabled((value) => !value)}>{t("liveLesson.moveCanvas")}</Button>
            <View style={[styles.row, { gap: 4 }]}>
              <Button size="sm" secondary icon="remove-outline" disabled={busy || !!pending || zoom <= 1} onPress={() => changeZoom(Math.max(1, zoom - 0.5))}>{t("liveLesson.zoomOut")}</Button>
              <Pressable accessibilityRole="button" accessibilityLabel={t("liveLesson.resetZoom")} disabled={busy || !!pending} onPress={() => changeZoom(1)} style={{ minHeight: 44, minWidth: 54, alignItems: "center", justifyContent: "center" }}><Text style={styles.caption}>{Math.round(zoom * 100)}%</Text></Pressable>
              <Button size="sm" secondary icon="add-outline" disabled={busy || !!pending || zoom >= 2} onPress={() => changeZoom(Math.min(2, zoom + 0.5))}>{t("liveLesson.zoomIn")}</Button>
            </View>
          </View>
          {!!pdfError && <Button size="sm" secondary icon="refresh-outline" onPress={() => setPdfRetry((value) => value + 1)}>{t("liveLesson.retry")}</Button>}
          {document && <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Button size="sm" secondary icon="chevron-back-outline" disabled={busy || !!pending || active.page <= 1} onPress={() => selectView(document.id, active.page - 1)}>{t("liveLesson.previousPage")}</Button>
            <Text style={styles.caption}>{active.page} / {document.pageCount}</Text>
            <Button size="sm" secondary trailingIcon="chevron-forward-outline" disabled={busy || !!pending || active.page >= document.pageCount} onPress={() => selectView(document.id, active.page + 1)}>{t("liveLesson.nextPage")}</Button>
          </View>}
        </View>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <Button secondary size="sm" icon="arrow-undo-outline" disabled={!toolsEditable || !undo} onPress={() => undo && change({ action: "stroke.remove", epoch: board.epoch, id: undo.id, ...active })}>{t("liveLesson.undo")}</Button>
          <Button secondary size="sm" icon="arrow-redo-outline" disabled={!toolsEditable || !redoId} onPress={() => redoId && change({ action: "stroke.restore", epoch: board.epoch, id: redoId, ...active })}>{t("liveLesson.redo")}</Button>
          {board.canClear && <Button variant="danger" size="sm" icon="trash-outline" disabled={!toolsEditable || !strokes.length} onPress={() => confirmAction(t("liveLesson.clearConfirm"), t("liveLesson.clearPageWarning"), () => change({ action: "page.clear", epoch: board.epoch, ...active }), setError)}>{t("liveLesson.clearPage")}</Button>}
        </View>
        <View style={{ minHeight: 132, gap: 8 }}>
          <View style={styles.row}>
            {busy && <ActivityIndicator color={colors.brand} size="small" />}
            <Text style={styles.caption}>{uploading ? t("liveLesson.uploadingPdf") : boardStatus(state.saving, !!pending || !!error || !!state.error)}</Text>
          </View>
          <ErrorText message={error || state.error || (board.strokes.length >= maxBoardStrokes ? t("liveLesson.boardFull") : "")} />
          {documents.length >= maxBoardDocuments && board.canClear && <Text style={styles.caption}>{t("liveLesson.documentLimit")}</Text>}
          {pending && !busy && <View style={styles.row}>
            <Button secondary size="sm" icon="refresh-outline" disabled={!board.canEdit} onPress={() => void save(pending)}>{t("liveLesson.retry")}</Button>
            <Button secondary size="sm" onPress={discard}>{t("common.cancel")}</Button>
          </View>}
        </View>
      </ScrollView>
      {upload && <View style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} pointerEvents="none">
        <NativeBoardPdf url={upload.url} page={1} onReady={uploadedPdfReady} onError={() => { setUpload(null); setUploading(false); setError(t("liveLesson.pdfError")); }} />
      </View>}
    </SafeAreaView>
  </Modal>;
}

function boardStatus(busy: boolean, pending: boolean) {
  if (busy) return t("liveLesson.saving");
  if (pending) return t("liveLesson.connectionError");
  return t("liveLesson.synced");
}

function NativeFollowTeacher({ following, disabled, onPress }: Readonly<{ following: boolean; disabled: boolean; onPress: () => void }>) {
  const { colors, styles } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("liveLesson.followTeacher")} accessibilityState={{ selected: following, disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 42, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: following ? colors.brandSoft : colors.surface }}>
    <Ionicons name={following ? "checkmark-circle-outline" : "radio-button-off-outline"} size={18} color={colors.brand} />
    <Text style={styles.caption}>{t("liveLesson.followTeacher")}</Text>
  </Pressable>;
}

function NativeBoardStroke({ stroke, canvasHeight }: Readonly<{ stroke: BoardStrokeInput; canvasHeight: number }>) {
  const first = stroke.points[0], last = stroke.points.at(-1)!;
  const x = first.x * 1000, y = first.y * canvasHeight, endX = last.x * 1000, endY = last.y * canvasHeight;
  const shape = { stroke: stroke.color, strokeWidth: stroke.width, fill: "none" };
  if (stroke.tool === "note") {
    const note = boardNoteLayout(stroke, canvasHeight);
    return <G><Rect x={note.x} y={note.y} width={note.width} height={note.height} rx={12} fill="#fff4c2" stroke={stroke.color} strokeWidth={1} />
      <SvgText x={note.x + 14} y={note.y + 30} fill={stroke.color} fontSize={18}>{note.lines.map((line, i) => <TSpan key={note.lines.slice(0, i + 1).join("\n")} x={note.x + 14} dy={i ? 24 : 0}>{line}</TSpan>)}</SvgText></G>;
  }
  if (stroke.tool === "line") return <Line x1={x} y1={y} x2={endX} y2={endY} {...shape} strokeLinecap="round" />;
  if (stroke.tool === "rectangle") return <Rect x={Math.min(x, endX)} y={Math.min(y, endY)} width={Math.abs(endX - x)} height={Math.abs(endY - y)} {...shape} />;
  if (stroke.tool === "ellipse") return <Ellipse cx={(x + endX) / 2} cy={(y + endY) / 2} rx={Math.abs(endX - x) / 2} ry={Math.abs(endY - y) / 2} {...shape} />;
  const highlighted = stroke.tool === "highlighter", weight = highlighted ? stroke.width * 5 : stroke.width;
  if (stroke.points.length === 1) return <Circle cx={x} cy={y} r={weight / 2} fill={stroke.color} opacity={highlighted ? 0.3 : 1} />;
  return <Path d={boardStrokePath(stroke.points, canvasHeight)} stroke={stroke.color} strokeWidth={weight} opacity={highlighted ? 0.3 : 1} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
}

function NativeBoardDocuments({ board, disabled, onSelect }: Readonly<{ board: LessonBoard; disabled: boolean; onSelect: (id: string | null, page: number) => void }>) {
  const { colors, styles } = useTheme();
  const documents = [{ id: null, name: t("liveLesson.whiteboard") }, ...(board.documents ?? [])];
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
    {documents.map((document) => <Pressable key={document.id ?? "whiteboard"} accessibilityRole="button" accessibilityLabel={document.name} accessibilityState={{ selected: (board.documentId ?? null) === document.id, disabled }} disabled={disabled}
      onPress={() => onSelect(document.id, document.id ? 1 : 0)} style={{ minHeight: 44, maxWidth: 210, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: (board.documentId ?? null) === document.id ? colors.brandSoft : colors.surface }}>
      <Ionicons name={document.id ? "document-text-outline" : "easel-outline"} size={18} color={colors.brand} />
      <Text numberOfLines={1} style={[styles.caption, { flexShrink: 1 }]}>{document.name}</Text>
    </Pressable>)}
  </ScrollView>;
}

function NativeBoardTools({ color, width, tool, editable, onColor, onWidth, onTool }: Readonly<{
  color: BoardStrokeInput["color"]; width: BoardStrokeInput["width"]; tool: Tool; editable: boolean;
  onColor: (color: BoardStrokeInput["color"]) => void; onWidth: (width: BoardStrokeInput["width"]) => void; onTool: (tool: Tool) => void;
}>) {
  const { colors, styles } = useTheme(), names = ["black", "blue", "red", "green"] as const;
  const tools: Tool[] = [...boardTools, "eraser"];
  return <View style={{ gap: 12 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {tools.map((choice) => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={t(`liveLesson.${choice}`)} accessibilityState={{ selected: tool === choice, disabled: !editable }} disabled={!editable} onPress={() => onTool(choice)}
        style={{ width: 74, minHeight: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1, borderColor: tool === choice ? colors.brand : colors.line, backgroundColor: tool === choice ? colors.brandSoft : colors.surface, opacity: editable ? 1 : 0.5 }}>
        <Ionicons name={toolIcons[choice]} size={20} color={tool === choice ? colors.brand : colors.text} />
        <Text style={[styles.caption, { fontSize: 10 }]} numberOfLines={1}>{t(`liveLesson.${choice}`)}</Text>
      </Pressable>)}
    </ScrollView>
    <View style={[styles.row, { justifyContent: "space-between" }]}>
      <View style={[styles.row, { gap: 8 }]}>{boardColors.map((choice, i) => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={t(`liveLesson.${names[i]}`)} accessibilityState={{ selected: color === choice, disabled: !editable }} disabled={!editable} onPress={() => onColor(choice)}
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: choice, borderWidth: color === choice ? 3 : 1, borderColor: color === choice ? colors.marker : colors.line, opacity: editable ? 1 : 0.5 }} />)}</View>
      <View style={[styles.row, { gap: 4 }]}>{boardWidths.map((choice) => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={`${t("liveLesson.pen")} ${choice}`} accessibilityState={{ selected: width === choice, disabled: !editable }} disabled={!editable} onPress={() => onWidth(choice)}
        style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: width === choice ? colors.brandSoft : colors.surface, opacity: editable ? 1 : 0.5 }}>
        <View style={{ width: 20, height: choice, borderRadius: choice / 2, backgroundColor: colors.text }} />
      </Pressable>)}</View>
    </View>
  </View>;
}
