import React, { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import type { Video } from "@derslik/api-client";
import { request } from "./core";
import { Button, ErrorText, styles } from "./ui";
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
      if (e.status === "error")
        setError("Video oynatılamadı. Kapatıp tekrar açın.");
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
      <SafeAreaView style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.row}>
            <Text style={[styles.h2, { flex: 1 }]}>{video.title}</Text>
            <Button secondary onPress={onClose}>
              Kapat
            </Button>
          </View>
          <VideoView
            player={player}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: 12,
              backgroundColor: "#172e24",
            }}
            nativeControls
            fullscreenOptions={{ enable: true }}
            allowsPictureInPicture
          />
          <ErrorText message={error} />
          {canAsk && (
            <Button
              secondary
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
              Bu saniyeye soru ekle
            </Button>
          )}
          {at !== null && (
            <>
              <Text style={styles.label}>
                {Math.floor(at / 60)}:{String(at % 60).padStart(2, "0")} için
                sorunuz
              </Text>
              <TextInput
                multiline
                style={[
                  styles.input,
                  { height: 120, textAlignVertical: "top" },
                ]}
                accessibilityLabel="Video sorusu"
                value={question}
                onChangeText={setQuestion}
                maxLength={5000}
              />
              <Button
                disabled={busy || !question.trim()}
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
                Soruyu gönder
              </Button>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
