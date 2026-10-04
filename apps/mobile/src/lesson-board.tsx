import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import * as Crypto from "expo-crypto";
import {
  boardColors,
  boardWidths,
  maxBoardStrokes,
  t,
  type BoardStrokeInput,
  type LessonBoard,
  type LessonBoardCommand,
} from "@derslik/contracts";
import {
  appendBoardPoint,
  boardPoint,
  boardStrokePath,
  boardUndoStroke,
  LessonBoardSession,
  type LessonBoardState,
} from "@derslik/api-client";
import { client } from "./core";
import { Button, CloseButton, confirmAction, ErrorText, useTheme } from "./ui";

type BoardScope = {
  workspaceId: string;
  studentId: string;
  lessonId: string;
  portal: boolean;
};
type PendingChange = { command: LessonBoardCommand; key: string };

export function NativeLessonBoard({
  initial,
  title,
  onClose,
  ...scope
}: Readonly<
  BoardScope & {
    initial: LessonBoard;
    title: string;
    onClose: () => void;
  }
>) {
  const { colors, styles, section } = useTheme();
  const [state, setState] = useState<LessonBoardState>({
      board: initial,
      loading: false,
      saving: false,
      error: null,
    }),
    [color, setColor] = useState<BoardStrokeInput["color"]>(boardColors[0]),
    [width, setWidth] = useState<BoardStrokeInput["width"]>(4),
    [draft, setDraft] = useState<BoardStrokeInput | null>(null),
    [pending, setPending] = useState<PendingChange | null>(null),
    [error, setError] = useState("");
  const gesture = useRef<{ stroke: BoardStrokeInput; epoch: number } | null>(
      null,
    ),
    frame = useRef({ width: 0, height: 0 }),
    mounted = useRef(true),
    sending = useRef(false);
  const { workspaceId, studentId, lessonId, portal } = scope;
  const session = useMemo(
    () =>
      new LessonBoardSession({
        initial,
        load: (revision) =>
          AppState.currentState === "active"
            ? client.lessonBoard(
                workspaceId,
                studentId,
                lessonId,
                portal,
                revision,
              )
            : Promise.resolve({ data: null }),
        change: (command, key) =>
          client.changeLessonBoard(
            workspaceId,
            studentId,
            lessonId,
            command,
            key,
            portal,
          ),
        onChange: setState,
      }),
    [workspaceId, studentId, lessonId, portal, initial],
  );
  useEffect(() => {
    mounted.current = true;
    session.start();
    return () => {
      mounted.current = false;
      session.stop();
    };
  }, [session]);
  const board = state.board ?? initial;
  const busy = state.saving;
  const save = useCallback(
    async (change: PendingChange) => {
      if (sending.current) return;
      sending.current = true;
      setPending(change);
      try {
        const saved = await session.save(change.command, change.key);
        if (mounted.current) {
          if (saved) {
            setPending(null);
            setDraft(null);
            setError("");
          } else
            setError(session.state.error ?? t("liveLesson.connectionError"));
        }
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      } finally {
        sending.current = false;
      }
    },
    [session],
  );
  const change = useCallback(
    (command: LessonBoardCommand) => {
      void save({ command, key: Crypto.randomUUID() });
    },
    [save],
  );
  const editable =
    board.canEdit &&
    !busy &&
    !pending &&
    board.strokes.length < maxBoardStrokes;
  const responder = useMemo(() => {
    const point = (event: GestureResponderEvent) =>
      boardPoint(
        event.nativeEvent.locationX,
        event.nativeEvent.locationY,
        frame.current.width,
        frame.current.height,
      );
    // eslint-disable-next-line react-hooks/refs -- PanResponder.create registers these callbacks; refs are read only when a native gesture invokes them.
    return PanResponder.create({
      onStartShouldSetPanResponder: () => editable && frame.current.width > 0,
      onMoveShouldSetPanResponder: () => editable,
      onPanResponderGrant: (event) => {
        const next = {
          id: Crypto.randomUUID(),
          color,
          width,
          points: [point(event)],
        };
        gesture.current = { stroke: next, epoch: board.epoch };
        setDraft(next);
      },
      onPanResponderMove: (event) => {
        if (!gesture.current) return;
        const next = {
          ...gesture.current.stroke,
          points: appendBoardPoint(gesture.current.stroke.points, point(event)),
        };
        gesture.current = { ...gesture.current, stroke: next };
        setDraft(next);
      },
      onPanResponderRelease: () => {
        if (!gesture.current) return;
        const { stroke, epoch } = gesture.current;
        gesture.current = null;
        change({ action: "stroke.add", epoch, stroke });
      },
      onPanResponderTerminate: () => {
        gesture.current = null;
        setDraft(null);
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [editable, color, width, board.epoch, change]);
  const undo = boardUndoStroke(board);
  function close() {
    if (busy) return;
    if (pending?.command.action === "stroke.add")
      confirmAction(
        t("liveLesson.discardDrawing"),
        t("liveLesson.unsavedWarning"),
        onClose,
        setError,
      );
    else onClose();
  }
  function discard() {
    setPending(null);
    setDraft(null);
    setError("");
    void session.refresh();
  }
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.surface }]}
        edges={["top", "bottom"]}
      >
        <View style={section.sheetHeader}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={section.sheetTitle}>{t("liveLesson.board")}</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <CloseButton onPress={close} disabled={busy} />
        </View>
        <ScrollView
          contentContainerStyle={[styles.body, { gap: 16 }]}
          scrollEnabled={!draft || !!pending}
        >
          <Text style={[styles.muted, { height: 48 }]} numberOfLines={2}>
            {board.canEdit
              ? t("liveLesson.boardHint")
              : t("liveLesson.readOnly")}
          </Text>
          <NativeBoardTools
            color={color}
            width={width}
            editable={board.canEdit && !busy && !pending}
            onColor={setColor}
            onWidth={setWidth}
          />
          <View
            accessibilityLabel={t("liveLesson.board")}
            style={{
              width: "100%",
              aspectRatio: 5 / 3,
              backgroundColor: "#ffffff",
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 12,
              overflow: "hidden",
            }}
            onLayout={(event) => {
              frame.current = event.nativeEvent.layout;
            }}
            {...responder.panHandlers}
          >
            <Svg
              width="100%"
              height="100%"
              viewBox="0 0 1000 600"
              pointerEvents="none"
            >
              {board.strokes.map((stroke) => (
                <NativeBoardStroke key={stroke.id} stroke={stroke} />
              ))}
              {draft &&
                !board.strokes.some((stroke) => stroke.id === draft.id) && (
                  <NativeBoardStroke stroke={draft} />
                )}
            </Svg>
          </View>
          <View style={styles.row}>
            <Button
              secondary
              size="sm"
              icon="arrow-undo-outline"
              disabled={!board.canEdit || busy || !!pending || !undo}
              onPress={() =>
                undo &&
                change({
                  action: "stroke.remove",
                  epoch: board.epoch,
                  id: undo.id,
                })
              }
            >
              {t("liveLesson.undo")}
            </Button>
            {board.canClear && (
              <Button
                variant="danger"
                size="sm"
                icon="trash-outline"
                disabled={
                  !board.canEdit || busy || !!pending || !board.strokes.length
                }
                onPress={() =>
                  confirmAction(
                    t("liveLesson.clearConfirm"),
                    t("liveLesson.clearWarning"),
                    () =>
                      change({ action: "board.clear", epoch: board.epoch }),
                    setError,
                  )
                }
              >
                {t("liveLesson.clear")}
              </Button>
            )}
          </View>
          <View style={{ minHeight: 132, gap: 8 }}>
            <View style={styles.row}>
              {busy && <ActivityIndicator color={colors.brand} size="small" />}
              <Text style={styles.caption}>
                {boardStatus(busy, !!pending || !!error || !!state.error)}
              </Text>
            </View>
            <ErrorText
              message={
                error ||
                state.error ||
                (board.strokes.length >= maxBoardStrokes
                  ? t("liveLesson.boardFull")
                  : "")
              }
            />
            {pending && !busy && (
              <View style={styles.row}>
                <Button
                  secondary
                  size="sm"
                  icon="refresh-outline"
                  disabled={!board.canEdit}
                  onPress={() => void save(pending)}
                >
                  {t("liveLesson.retry")}
                </Button>
                <Button secondary size="sm" onPress={discard}>
                  {t("common.cancel")}
                </Button>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function boardStatus(busy: boolean, pending: boolean) {
  if (busy) return t("liveLesson.saving");
  if (pending) return t("liveLesson.connectionError");
  return t("liveLesson.synced");
}

function NativeBoardStroke({ stroke }: Readonly<{ stroke: BoardStrokeInput }>) {
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    return (
      <Circle
        cx={point.x * 1000}
        cy={point.y * 600}
        r={stroke.width / 2}
        fill={stroke.color}
      />
    );
  }
  return (
    <Path
      d={boardStrokePath(stroke.points)}
      stroke={stroke.color}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

function NativeBoardTools({
  color,
  width,
  editable,
  onColor,
  onWidth,
}: Readonly<{
  color: BoardStrokeInput["color"];
  width: BoardStrokeInput["width"];
  editable: boolean;
  onColor: (color: BoardStrokeInput["color"]) => void;
  onWidth: (width: BoardStrokeInput["width"]) => void;
}>) {
  const { colors, styles } = useTheme();
  const names = ["black", "blue", "red", "green"] as const;
  return (
    <View style={[styles.row, { justifyContent: "space-between" }]}>
      <View style={styles.row}>
        {boardColors.map((choice, i) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            accessibilityLabel={t(`liveLesson.${names[i]}`)}
            accessibilityState={{
              selected: color === choice,
              disabled: !editable,
            }}
            disabled={!editable}
            onPress={() => onColor(choice)}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: choice,
              borderWidth: color === choice ? 3 : 1,
              borderColor: color === choice ? colors.marker : colors.line,
              opacity: editable ? 1 : 0.5,
            }}
          />
        ))}
      </View>
      <View style={styles.row}>
        {boardWidths.map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            accessibilityLabel={`${t("liveLesson.pen")} ${choice}`}
            accessibilityState={{
              selected: width === choice,
              disabled: !editable,
            }}
            disabled={!editable}
            onPress={() => onWidth(choice)}
            style={{
              width: 42,
              height: 42,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor:
                width === choice ? colors.brandSoft : colors.surface,
              opacity: editable ? 1 : 0.5,
            }}
          >
            <View
              style={{
                width: 24,
                height: choice,
                borderRadius: choice / 2,
                backgroundColor: colors.text,
              }}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
