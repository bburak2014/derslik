import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import {
  isMeetingUrl,
  t,
  type Lesson,
  type LessonBoard,
} from "@derslik/contracts";
import { client } from "./core";
import { Button, ErrorText, type FormField, useTheme } from "./ui";
import { NativeLessonBoard } from "./lesson-board";

export const meetingField = (value?: string | null): FormField => ({
  key: "meetingUrl",
  label: t("liveLesson.meetingUrl"),
  hint: t("liveLesson.meetingHint"),
  placeholder: t("liveLesson.meetingPlaceholder"),
  value: value ?? "",
  required: false,
  maxLength: 2048,
  keyboard: "email-address",
});

export function LiveLessonActions({
  lesson,
  workspaceId,
  portal = false,
  disabled = false,
  onEditMeeting,
}: Readonly<{
  lesson: Lesson;
  workspaceId: string;
  portal?: boolean;
  disabled?: boolean;
  onEditMeeting?: () => void;
}>) {
  const { styles } = useTheme();
  const [board, setBoard] = useState<LessonBoard | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    opening = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function openBoard() {
    if (opening.current || disabled) return;
    opening.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await client.lessonBoard(
        workspaceId,
        lesson.student_id,
        lesson.id,
        portal,
      );
      if (!result.data) throw new Error(t("liveLesson.connectionError"));
      if (mounted.current) setBoard(result.data);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      opening.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  async function join() {
    try {
      const url = lesson.meeting_url ?? "";
      if (!isMeetingUrl(url)) throw new Error(t("liveLesson.meetingOpenError"));
      await Linking.openURL(url);
      if (mounted.current) setError("");
    } catch {
      if (mounted.current) setError(t("liveLesson.meetingOpenError"));
    }
  }
  if (lesson.status === "CANCELLED") return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        {lesson.status === "SCHEDULED" && !!lesson.meeting_url && (
          <Button
            size="sm"
            icon="videocam-outline"
            disabled={disabled}
            onPress={() => void join()}
          >
            {t("liveLesson.join")}
          </Button>
        )}
        <Button
          secondary
          size="sm"
          icon="brush-outline"
          loading={loading}
          disabled={disabled}
          onPress={() => void openBoard()}
        >
          {t("liveLesson.board")}
        </Button>
        {lesson.status === "SCHEDULED" && onEditMeeting && (
          <Button
            secondary
            size="sm"
            icon="link-outline"
            disabled={disabled}
            onPress={onEditMeeting}
          >
            {t("liveLesson.editMeeting")}
          </Button>
        )}
      </View>
      {lesson.status === "SCHEDULED" && !lesson.meeting_url && (
        <Text style={styles.caption}>{t("liveLesson.noMeeting")}</Text>
      )}
      {!portal && (
        <Text style={styles.caption}>{t("liveLesson.recordingHint")}</Text>
      )}
      <ErrorText message={error} />
      {board && (
        <NativeLessonBoard
          initial={board}
          workspaceId={workspaceId}
          studentId={lesson.student_id}
          lessonId={lesson.id}
          title={lesson.topic}
          portal={portal}
          onClose={() => setBoard(null)}
        />
      )}
    </View>
  );
}
