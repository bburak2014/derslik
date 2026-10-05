"use client";
import { isImageName, t } from "@derslik/contracts";
import { Button } from "@/components/ui/button";
import { CircleAlert, Download, RefreshCw } from "lucide-react";
import { PageLoader } from "@/components/derslik/loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormError } from "./feedback";
import { VideoPlayer } from "./video-player";
import { CalendarFeedButton } from "./calendar-feed";
import { AccessTab } from "./learning/access-tab";
import { PaymentsTab } from "./learning/payments-tab";
import { NotesTab } from "./learning/notes-tab";
import { VideosTab } from "./learning/videos-tab";
import { FilesTab } from "./learning/files-tab";
import { AssignmentsTab } from "./learning/assignments-tab";
import { MessagesView } from "./messages";
import {
  useLearningPanel,
  type LearningPanelProps,
} from "./learning/use-learning-panel";
import { ActionForm, ConfirmDialog, LessonSchedule } from "./learning/shared";
import { BookButton, BookedLessonExtra } from "./learning/booking";
import { LiveLessonActions } from "./live-lesson";

// Dışarıdan kullanılan adlar; eski içe aktarma yolları çalışmaya devam etsin.
export {
  learningTabs,
  type LearningTab,
  type LearningTabInfo,
  type NoticeFocus,
} from "./learning/shared";
export { AccountExtras } from "./learning/inbox";
export type { LearningPanelProps } from "./learning/use-learning-panel";

export function LearningPanel(props: Readonly<LearningPanelProps>) {
  const ctx = useLearningPanel(props);
  const {
    view,
    owner,
    student,
    capabilities,
    data,
    loading,
    confirmation,
    setConfirmation,
    error,
    setTab,
    form,
    setForm,
    activeVideo,
    setActiveVideo,
    filePreview,
    setFilePreview,
    media,
    reload,
    action,
    simple,
    accessReload,
    download,
    tabs,
    tab,
    refresh,
  } = ctx;
  if (loading)
    return (
      <div className="learning-panel">
        <PageLoader compact />
      </div>
    );
  return (
    <section className="learning-panel">
      {!view && (
        <div className="flex items-center justify-between gap-3">
          <Tabs
            className="min-w-0"
            value={tab}
            onValueChange={(next) => {
              setTab(next);
              if (next === "access") void accessReload();
            }}
          >
            <TabsList
              className="max-w-full justify-start overflow-x-auto"
              aria-label={t("learn.studentContent")}
            >
              {tabs.map((x) => (
                // İçerik sekmeden bağımsız çizilir; olmayan panele işaret eden
                // aria-controls kaldırılır.
                <TabsTrigger
                  key={x.id}
                  value={x.id}
                  aria-controls={undefined}
                  className="flex-none"
                >
                  {x.title}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {refresh}
        </div>
      )}
      {error && <FormError>{error}</FormError>}
      {(owner || student) &&
        ((tab === "videos" && !capabilities?.videos) ||
          (["assignments", "files"].includes(tab) && !capabilities?.files)) && (
          <Alert role="status">
            <CircleAlert />
            <AlertTitle>
              {tab === "videos"
                ? t("learn.videoUploadNotReady")
                : t("learn.fileUploadNotReady")}
            </AlertTitle>
            <AlertDescription>
              <p>{t("learn.uploadServiceDown")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void reload()}
              >
                <RefreshCw /> {t("learn.checkAgain")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      {tab === "lessons" && "lessons" in data && (
        <LessonSchedule
          lessons={data.lessons}
          renderExtra={(lesson, now) => <>
            <LiveLessonActions lesson={lesson}
              base={owner
                ? `/workspaces/${encodeURIComponent(props.workspaceId)}/students/${encodeURIComponent(props.studentId)}/lessons/${encodeURIComponent(lesson.id)}/board`
                : `/portal/${encodeURIComponent(props.workspaceId)}/${encodeURIComponent(props.studentId)}/lessons/${encodeURIComponent(lesson.id)}/board`} />
            {lesson.booked_by && <BookedLessonExtra ctx={ctx} lesson={lesson} now={now} />}
          </>}
        >
          <BookButton ctx={ctx} onOpenMessages={props.onOpenMessages} />
          {view && refresh}
          {/* Öğretmen kendi takvimini Takvim sayfasından bağlar. */}
          {!owner && <CalendarFeedButton />}
        </LessonSchedule>
      )}
      {tab === "assignments" && <AssignmentsTab ctx={ctx} />}
      {tab === "files" && <FilesTab ctx={ctx} />}
      {tab === "videos" && <VideosTab ctx={ctx} />}
      {tab === "notes" && <NotesTab ctx={ctx} />}
      {tab === "payments" && "packages" in data && <PaymentsTab ctx={ctx} />}
      {tab === "access" && owner && <AccessTab ctx={ctx} />}
      {tab === "messages" && !owner && props.chat && (
        <MessagesView
          base={`/portal/${props.workspaceId}/${props.studentId}/messages`}
          {...props.chat}
        />
      )}
      <ActionForm
        key={form?.title || "closed"}
        spec={form}
        onClose={() => setForm(null)}
      />
      <Dialog
        open={!!filePreview}
        onOpenChange={(open) => {
          if (!open) setFilePreview(null);
        }}
      >
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>{filePreview?.file.name}</DialogTitle>
            <DialogDescription>{t("learn.previewHint")}</DialogDescription>
          </DialogHeader>
          {filePreview &&
            (isImageName(filePreview.file.name) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="preview-frame"
                src={filePreview.url}
                alt={filePreview.file.name}
              />
            ) : (
              <iframe
                className="preview-frame"
                src={filePreview.url}
                title={filePreview.file.name}
              />
            ))}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void download(filePreview!.file)}
            >
              <Download size={16} /> {t("learn.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeVideo}
        onOpenChange={(open) => {
          if (!open) setActiveVideo(null);
        }}
      >
        <DialogContent className="sm:max-w-[850px]">
          <DialogHeader>
            <DialogTitle>{activeVideo?.title}</DialogTitle>
            <DialogDescription>{t("learn.videoDialogHint")}</DialogDescription>
          </DialogHeader>
          {activeVideo && (
            <VideoPlayer
              key={activeVideo.id}
              video={activeVideo}
              initialTime={
                data.progress.find((p) => p.video_id === activeVideo.id)
                  ?.seconds || 0
              }
              mediaPath={media}
              canAsk={student}
              onProgress={(seconds) =>
                action({
                  action: "video.progress",
                  videoId: activeVideo.id,
                  seconds,
                })
              }
              onAsk={(seconds) =>
                simple(
                  t("video.askHere"),
                  [
                    {
                      name: "body",
                      label: t("learn.questionAt", {
                        time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
                      }),
                      type: "textarea",
                    },
                  ],
                  (v) => ({
                    action: "question.create",
                    videoId: activeVideo.id,
                    atSeconds: seconds,
                    body: v.body,
                  }),
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        state={confirmation}
        onClose={() => setConfirmation(null)}
      />
    </section>
  );
}
