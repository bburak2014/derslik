import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import type { Video } from "@derslik/api-client";
import { request } from "./core";
import { t } from "@derslik/contracts";
import { Button, ErrorText, Field, Input, Kicker, useTheme } from "./ui";
export function MediaPlayer({
  video,
  path,
  initialTime,
  canAsk,
  onClose,
  action,
}: {
  video: Video;
  path: string;
  initialTime: number;
  canAsk: boolean;
  onClose: () => void;
  action: (body: unknown) => Promise<void>;
}) {
  const { colors, styles, section } = useTheme();
  const player = useVideoPlayer(null, (p) => {
      p.timeUpdateEventInterval = 1;
    }),
    [error, setError] = useState(""),
    [question, setQuestion] = useState(""),
    [at, setAt] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  const current = useRef(initialTime),
    actionRef = useRef(action);
  actionRef.current = action;
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const r = await request(path + `/videos/${video.id}/playback`);
        if (stopped) return;
        const resume = player.playing;
        await player.replaceAsync({ uri: r.data.url, contentType: "hls" });
        if (stopped) return;
        player.currentTime = current.current;
        if (resume) player.play();
        setError("");
        timer = setTimeout(
          () => void load(),
          Math.max(30000, r.data.expiresAt - Date.now() - 45000),
        );
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          player.pause();
        }
      }
    }
    void load();
    const update = player.addListener("timeUpdate", (e) => {
      current.current = e.currentTime;
    });
    const status = player.addListener("statusChange", (e) => {
      if (e.status === "error") setError(t("video.playFailed"));
    });
    const save = () => {
      if (current.current > 0)
        void actionRef
          .current({
            action: "video.progress",
            videoId: video.id,
            seconds: Math.min(
              Math.floor(current.current),
              video.duration_seconds || 0,
            ),
          })
          .catch(() => {});
    };
    const interval = setInterval(save, 30000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(interval);
      update.remove();
      status.remove();
      save();
    };
  }, [video.id, path, player]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.surface }]}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={section.sheetHeader}>
          <View style={{ flex: 1, gap: 3 }}>
            <Kicker>{t("mobile.lessonVideo")}</Kicker>
            <Text style={section.sheetTitle} numberOfLines={2}>
              {video.title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [
              section.close,
              pressed && { backgroundColor: colors.line },
            ]}
          >
            <Ionicons name="close" size={20} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <VideoView
            player={player}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: 14,
              overflow: "hidden",
              backgroundColor: colors.playerSurface,
            }}
            nativeControls
            fullscreenOptions={{ enable: true }}
            allowsPictureInPicture
          />
          <ErrorText message={error} />
          {canAsk && at === null && (
            <Button
              secondary
              icon="help-circle-outline"
              onPress={() => {
                player.pause();
                setAt(
                  Math.min(
                    Math.floor(player.currentTime),
                    video.duration_seconds || 0,
                  ),
                );
              }}
            >
              {t("video.askHere")}
            </Button>
          )}
          {at !== null && (
            <>
              <Field
                label={t("learn.questionAt", {
                  time: `${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}`,
                })}
                hint={t("mobile.questionHint")}
              >
                <Input
                  multiline
                  accessibilityLabel={t("mobile.videoQuestion")}
                  value={question}
                  onChangeText={setQuestion}
                  maxLength={5000}
                />
              </Field>
              <View style={styles.row}>
                <Button
                  secondary
                  style={{ flex: 1 }}
                  onPress={() => {
                    setAt(null);
                    setQuestion("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  icon="paper-plane-outline"
                  loading={busy}
                  disabled={busy || !question.trim()}
                  style={{ flex: 2 }}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await actionRef.current({
                        action: "question.create",
                        videoId: video.id,
                        atSeconds: at,
                        body: question,
                      });
                      setQuestion("");
                      setAt(null);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("mobile.sendQuestion")}
                </Button>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
