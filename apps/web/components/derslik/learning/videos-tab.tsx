"use client";
import {
  uploadTus,
  type Video,
  type VideoReservation,
} from "@derslik/api-client";
import { dayLabel, t } from "@derslik/contracts";
import { backend, formText } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  Video as VideoIcon,
} from "lucide-react";
import { Spinner } from "@/components/derslik/loading";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToneBadge } from "../feedback";
import { type LearningCtx } from "./use-learning-panel";
import {
  GENERAL,
  SectionHeading,
  EmptyNote,
  IconAction,
  UploadAside,
} from "./shared";

export function VideosTab({ ctx }: Readonly<{ ctx: LearningCtx }>) {
  const {
    studentId,
    view,
    owner,
    capabilities,
    data,
    setConfirmation,
    setError,
    setActiveVideo,
    busy,
    setBusy,
    progress,
    setProgress,
    getUploadSession,
    setUploadSession,
    media,
    reload,
    simple,
    refresh,
  } = ctx;
  return (
    <>
      <SectionHeading
        title={t("learn.videosTitle")}
        description={t("learn.videosText")}
      >
        {view && refresh}
      </SectionHeading>
      {owner && (
        <div className="upload-layout">
          <Card className="gap-5">
            <CardHeader>
              <CardTitle>{t("learn.uploadVideo")}</CardTitle>
              <CardDescription>{t("learn.uploadVideoHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!capabilities?.videos) return;
                  const f = new FormData(e.currentTarget),
                    file = f.get("file") as File,
                    lesson = formText(f, "lessonId");
                  if (!file?.size) return;
                  setBusy(true);
                  setError("");
                  setProgress(0);
                  try {
                    const fingerprint = [
                      file.name,
                      file.size,
                      file.lastModified,
                      f.get("title"),
                      f.get("duration"),
                      lesson,
                      studentId,
                    ].join(":");
                    let upload = getUploadSession();
                    if (upload?.fingerprint !== fingerprint) {
                      const r = await backend<{ data: VideoReservation }>(
                        media + "/videos",
                        {
                          title: f.get("title"),
                          lessonId: lesson === GENERAL ? null : lesson || null,
                          sizeBytes: file.size,
                          maxDurationSeconds: Number(f.get("duration")) * 60,
                        },
                      );
                      upload = {
                        fingerprint,
                        id: r.data.id,
                        url: r.data.uploadUrl,
                      };
                      setUploadSession(upload);
                    }
                    await uploadTus(
                      upload!.url,
                      {
                        size: file.size,
                        slice: (a, b) => file.slice(a, b),
                      },
                      { onProgress: setProgress },
                    );
                    await backend(media + `/videos/${upload!.id}/refresh`, {});
                    setUploadSession(null);
                    await reload();
                  } catch (e) {
                    // Yenileme hatayı temizler; mesaj ondan sonra yazılır.
                    await reload();
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="video-lesson">{t("learn.lesson")}</Label>
                  <Select name="lessonId" defaultValue={GENERAL}>
                    <SelectTrigger id="video-lesson" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GENERAL}>
                        {t("learn.generalVideo")}
                      </SelectItem>
                      {data.lessons.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.topic} · {dayLabel(l.starts_at)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                  <div className="grid gap-2">
                    <Label htmlFor="video-title">{t("learn.videoTitle")}</Label>
                    <Input
                      id="video-title"
                      name="title"
                      required
                      maxLength={150}
                      placeholder={t("learn.videoTitlePlaceholder")}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="video-duration">
                      {t("learn.maxDuration")}
                    </Label>
                    <Input
                      id="video-duration"
                      name="duration"
                      type="number"
                      min={1}
                      max={120}
                      defaultValue={60}
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="video-file">{t("learn.videoFile")}</Label>
                  <Input
                    id="video-file"
                    name="file"
                    type="file"
                    accept="video/*"
                    disabled={busy || !capabilities?.videos}
                    required
                  />
                  <p className="text-muted-foreground text-xs">
                    {t("learn.videoLimits")}
                  </p>
                </div>
                {progress !== null && (
                  <Progress
                    value={Math.round(progress * 100)}
                    aria-label={t("learn.uploadProgress")}
                  />
                )}
                <Button
                  type="submit"
                  className="justify-self-start"
                  disabled={busy || !capabilities?.videos}
                >
                  {busy ? <Spinner /> : <Upload />}
                  {busy
                    ? t("learn.uploadingPercent", {
                        percent: Math.round((progress || 0) * 100),
                      })
                    : t("learn.uploadVideoSubmit")}
                </Button>
              </form>
            </CardContent>
          </Card>
          <UploadAside kind="videos" />
        </div>
      )}
      <ItemGroup className="gap-3">
        {!data.videos.length && (
          <EmptyNote
            role="listitem"
            icon={VideoIcon}
            title={t("learn.noVideos")}
          >
            {t("learn.noVideosHint")}
          </EmptyNote>
        )}
        {data.videos.map((v) => {
          const questions = data.questions.filter((q) => q.video_id === v.id);
          return (
            <Item
              role="listitem"
              variant="outline"
              className="bg-card"
              key={v.id}
              data-notice-target={v.id}
            >
              <ItemMedia variant="icon">
                <VideoIcon />
              </ItemMedia>
              <ItemContent className="min-w-36">
                <ItemTitle>{v.title}</ItemTitle>
                <ItemDescription>
                  {v.status === "READY"
                    ? t("learn.minutes", {
                        count: Math.ceil((v.duration_seconds || 0) / 60),
                      })
                    : t("learn.videoProcessing")}
                  {questions.length > 0 &&
                    " · " +
                      t("learn.questionCount", { count: questions.length })}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto gap-1">
                {(v.delete_requested || v.status !== "READY") && (
                  <ToneBadge
                    className="mr-1"
                    tone={
                      v.delete_requested || v.status === "FAILED"
                        ? "danger"
                        : "warn"
                    }
                  >
                    {videoPendingLabel(v)}
                  </ToneBadge>
                )}
                {v.status === "READY" && !v.delete_requested && (
                  <IconAction
                    label={t("learn.openVideo")}
                    icon={<Play />}
                    onClick={() => setActiveVideo(v)}
                  />
                )}
                {owner && (
                  <>
                    <IconAction
                      label={t("sub.refresh")}
                      icon={<RefreshCw />}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await backend(media + `/videos/${v.id}/refresh`, {});
                          await reload();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    <IconAction
                      danger
                      label={t("common.delete")}
                      icon={<Trash2 />}
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          title: t("learn.deleteVideoTitle"),
                          description: t("learn.deleteVideoBody"),
                          action: t("common.delete"),
                          perform: async () => {
                            setBusy(true);
                            try {
                              await backend(
                                media + `/videos/${v.id}/delete`,
                                {},
                              );
                              await reload();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          },
                        })
                      }
                    />
                  </>
                )}
              </ItemActions>
              {questions.length > 0 && (
                <div className="grid basis-full gap-3 border-t pt-4">
                  {questions.map((q) => (
                    <div className="grid gap-2 text-sm" key={q.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="tabular-nums">
                          {Math.floor(q.at_seconds / 60)}:
                          {String(q.at_seconds % 60).padStart(2, "0")}
                        </Badge>
                        <span className="font-medium">
                          {t("learn.studentQuestion")}
                        </span>
                        {q.resolved && (
                          <ToneBadge tone="ok">{t("learn.answered")}</ToneBadge>
                        )}
                      </div>
                      <p className="leading-relaxed">{q.body}</p>
                      {q.answer && (
                        <p className="bg-muted/50 rounded-md border p-3 leading-relaxed">
                          {q.answer}
                        </p>
                      )}
                      {owner && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-self-start"
                          onClick={() =>
                            simple(
                              t("learn.answerTitle"),
                              [
                                {
                                  name: "answer",
                                  label: t("learn.yourReply"),
                                  type: "textarea",
                                  value: q.answer,
                                },
                              ],
                              (val) => ({
                                action: "question.answer",
                                questionId: q.id,
                                answer: val.answer,
                                resolved: true,
                                version: q.version,
                              }),
                            )
                          }
                        >
                          <MessageSquare />
                          {q.answer ? t("learn.editAnswer") : t("learn.reply")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Item>
          );
        })}
      </ItemGroup>
    </>
  );
}

function videoPendingLabel(v: Video) {
  if (v.delete_requested) return t("learn.deletePending");
  if (v.status === "FAILED") return t("learn.videoFailed");
  return t("learn.videoPreparing");
}
