"use client";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { Video, VideoPlayback } from "@derslik/api-client";
import { backend } from "@/lib/client";
import { Spinner } from "@/components/derslik/loading";
export function VideoPlayer({
  video,
  mediaPath,
  canAsk,
  initialTime,
  onAsk,
  onProgress,
}: {
  video: Video;
  mediaPath: string;
  canAsk: boolean;
  initialTime: number;
  onAsk: (seconds: number) => void;
  onProgress: (seconds: number) => Promise<void>;
}) {
  const ref = useRef<HTMLVideoElement>(null),
    position = useRef(initialTime),
    playing = useRef(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  const progressFn = useRef(onProgress);
  useEffect(() => {
    progressFn.current = onProgress;
  });
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      hls: Hls | undefined;
    async function load() {
      try {
        const { data } = await backend<{ data: VideoPlayback }>(
          mediaPath + `/videos/${video.id}/playback`,
        );
        if (stopped) return;
        const el = ref.current!;
        hls?.destroy();
        const restore = () => {
          el.currentTime = position.current;
          setReady(true);
          if (playing.current) void el.play().catch(() => {});
        };
        el.addEventListener("loadedmetadata", restore, { once: true });
        if (el.canPlayType("application/vnd.apple.mpegurl")) el.src = data.url;
        else if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(data.url);
          hls.attachMedia(el);
          hls.on(Hls.Events.ERROR, (_, event) => {
            if (event.fatal)
              setError("Video oynatılamadı. Kapatıp yeniden açın.");
          });
        } else throw new Error("Bu tarayıcı video oynatmayı desteklemiyor.");
        timer = setTimeout(
          () => void load(),
          Math.max(30000, data.expiresAt - Date.now() - 45000),
        );
        setError("");
      } catch (e) {
        setError((e as Error).message);
        ref.current?.pause();
      }
    }
    void load();
    const interval = setInterval(() => {
      if (position.current > 0)
        void progressFn
          .current(
            Math.min(Math.floor(position.current), video.duration_seconds || 0),
          )
          .catch(() => {});
    }, 30000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(interval);
      hls?.destroy();
      if (position.current > 0)
        void progressFn
          .current(
            Math.min(Math.floor(position.current), video.duration_seconds || 0),
          )
          .catch(() => {});
    };
  }, [video.id, mediaPath]);
  return (
    <div>
      <video
        ref={ref}
        controls
        playsInline
        className="lesson-video"
        onTimeUpdate={() => {
          position.current = ref.current?.currentTime || 0;
        }}
        onPlay={() => {
          playing.current = true;
        }}
        onPause={() => {
          playing.current = false;
        }}
      />
      {!ready && !error && (
        <p role="status" className="player-loading">
          <Spinner /> Video açılıyor…
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {canAsk && (
        <button
          className="primary-button"
          disabled={!ready}
          onClick={() => {
            ref.current?.pause();
            onAsk(
              Math.min(
                Math.floor(position.current),
                video.duration_seconds || 0,
              ),
            );
          }}
        >
          Bu saniyeye soru ekle
        </button>
      )}
    </div>
  );
}
