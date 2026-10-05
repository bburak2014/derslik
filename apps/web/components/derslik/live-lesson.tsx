"use client";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { Video, PencilLine, Link } from "lucide-react";
import { isMeetingUrl, t, type Lesson, type LessonBoardReadResult, type LessonBoard } from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "./loading";
import { FormError } from "./feedback";
import { LessonBoardDialog } from "./lesson-board";
import type { Mutate } from "./workspace";

export function LiveLessonActions({ lesson, base, disabled = false, editMeeting }: Readonly<{
  lesson: Lesson; base: string; disabled?: boolean; editMeeting?: () => void;
}>) {
  const [initial, setInitial] = useState<LessonBoard | null>(null),
    [loading, setLoading] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true), opening = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function openBoard() {
    if (opening.current || disabled) return;
    opening.current = true;
    setLoading(true); setError("");
    try {
      const reply = await backend<LessonBoardReadResult>(base);
      if (!reply.data) throw new Error(t("liveLesson.connectionError"));
      if (mounted.current) setInitial(reply.data);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : t("liveLesson.connectionError"));
    } finally { opening.current = false; if (mounted.current) setLoading(false); }
  }
  if (lesson.status === "CANCELLED") return null;
  return <div className="space-y-1">
    <div className="flex flex-wrap gap-2">
      {lesson.status === "SCHEDULED" && lesson.meeting_url && isMeetingUrl(lesson.meeting_url) && <Button size="sm" variant="outline" asChild disabled={disabled}>
        <a href={lesson.meeting_url} target="_blank" rel="noopener noreferrer" aria-disabled={disabled} tabIndex={disabled ? -1 : undefined} onClick={(event) => { if (disabled) event.preventDefault(); }}><Video />{t("liveLesson.join")}</a>
      </Button>}
      <Button size="sm" variant="outline" disabled={disabled || loading} onClick={() => void openBoard()}>{loading ? <Spinner /> : <PencilLine />}{t("liveLesson.board")}</Button>
      {lesson.status === "SCHEDULED" && editMeeting && <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={editMeeting} aria-label={t("liveLesson.editMeeting")}><Link /></Button>}
    </div>
    {error && <FormError>{error}</FormError>}
    {initial && <LessonBoardDialog initial={initial} base={base} title={lesson.topic} onClose={() => setInitial(null)} />}
  </div>;
}

export function MeetingLinkDialog({ lesson, mutate, busy, onClose }: Readonly<{
  lesson: Lesson; mutate: Mutate; busy: boolean; onClose: () => void;
}>) {
  const [url, setUrl] = useState(lesson.meeting_url ?? ""), [error, setError] = useState("");
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const meetingUrl = url.trim() || null;
    if (meetingUrl && !isMeetingUrl(meetingUrl)) { setError(t("api.meetingUrlInvalid")); return; }
    setError("");
    try {
      if (await mutate({ action: "lesson.meeting.update", id: lesson.id, version: lesson.version, meetingUrl }, t("liveLesson.meetingSaved"))) onClose();
    } catch (e) { setError(e instanceof Error ? e.message : t("common.failed")); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex h-[min(80dvh,24rem)] flex-col overflow-hidden" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{t("liveLesson.editMeeting")}</DialogTitle><DialogDescription>{lesson.topic}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <Label htmlFor="meeting-link-edit">{t("liveLesson.meetingUrl")}</Label>
          <Input id="meeting-link-edit" type="url" maxLength={2048} autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("liveLesson.meetingPlaceholder")} />
          <p className="text-muted-foreground text-sm">{t("liveLesson.meetingHint")}</p>
          {error && <FormError>{error}</FormError>}
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button disabled={busy}>{busy && <Spinner />}{t("common.save")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
