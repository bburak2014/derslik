"use client";
import { LearningPanel } from "./learning-panel";
import { useState } from "react";
import {
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
  LockKeyhole,
  Mail,
  Phone,
  CalendarDays,
  Wallet,
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  Send,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/derslik/loading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  money,
  dateKey,
  dayLabel,
  type WorkspaceData,
  type Student,
  type PrivateNote,
} from "@/lib/domain/types";
import {
  StudentAvatar,
  balanceFor,
  creditsFor,
  CreditBadge,
  LessonRows,
  Empty,
} from "./views";
import { ToneBadge } from "./feedback";
import type { Actions, Mutate } from "./workspace";
import { t } from "@derslik/contracts";

function NoteEditor({
  studentId,
  note,
  mutate,
  busy,
}: {
  studentId: string;
  note?: PrivateNote;
  mutate: Mutate;
  busy: boolean;
}) {
  const [body, setBody] = useState(note?.body || "");
  return (
    <form
      className="private-note-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        await mutate(
          { action: "note.save", studentId, body, version: note?.version || 0 },
          t("detail.noteSaved"),
        );
      }}
    >
      <div className="private-note-label">
        <LockKeyhole size={16} />
        <Label htmlFor="private-note">{t("detail.privateNote")}</Label>
      </div>
      <p>{t("detail.privateNoteHint")}</p>
      <Textarea
        id="private-note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("detail.notePlaceholder")}
        maxLength={5000}
        rows={7}
      />
      <div className="flex justify-between items-center mt-3">
        <small>{body.length} / 5000</small>
        <Button
          type="submit"
          size="sm"
          disabled={busy || body === (note?.body || "")}
        >
          {busy ? <Spinner /> : null} {t("detail.saveNote")}
        </Button>
      </div>
    </form>
  );
}

export function StudentDetail({
  student,
  data,
  actions,
  onClose,
  mutate,
  busy,
  workspaceId,
  focus,
}: {
  workspaceId?: string;
  /** Bildirimden gelindiyse "Öğrenme" sekmesi Paylaşımlar'da açılır. */
  focus?: import("./learning-panel").NoticeFocus | null;
  student: Student | null;
  data: WorkspaceData;
  actions: Actions;
  onClose: () => void;
  mutate: Mutate;
  busy: boolean;
}) {
  // invite bir sayaç: kısayola arka arkaya basıldığında da panel yeniden
  // kurulsun ve davet formu tekrar açılsın.
  const [tabState, setTabState] = useState({
    id: "",
    tab: "packages",
    invite: 0,
    notice: 0,
  });
  if (focus && focus.studentId === student?.id && focus.at !== tabState.notice)
    setTabState({
      id: focus.studentId,
      tab: "learning",
      invite: 0,
      notice: focus.at,
    });
  const current =
    tabState.id === student?.id
      ? tabState
      : { id: student?.id ?? "", tab: "packages", invite: 0, notice: 0 };
  const packages = data.packages.filter((p) => p.student_id === student?.id),
    lessons = data.lessons.filter((l) => l.student_id === student?.id),
    credits = data.credits.filter((c) => c.student_id === student?.id);
  return (
    <Sheet
      open={!!student}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="student-detail w-full sm:max-w-[690px] overflow-y-auto gap-0">
        {student && (
          <>
            <SheetHeader className="detail-header">
              <div className="flex gap-4 items-center">
                <StudentAvatar student={student} large />
                <div>
                  <SheetTitle className="text-2xl tracking-tight">
                    {student.name}
                  </SheetTitle>
                  <SheetDescription>
                    {student.subject}
                    {student.grade ? " · " + student.grade : ""}
                  </SheetDescription>
                  <div className="flex gap-2 mt-2">
                    {!!student.is_sample && (
                      <ToneBadge tone="warn">
                        {t("detail.sampleStudent")}
                      </ToneBadge>
                    )}
                    {!student.active && (
                      <ToneBadge tone="muted">{t("detail.archived")}</ToneBadge>
                    )}
                  </div>
                </div>
              </div>
              <div className="detail-contact">
                {student.phone && (
                  <span>
                    <Phone size={13} />
                    {student.phone}
                  </span>
                )}
                {student.email && (
                  <span>
                    <Mail size={13} />
                    {student.email}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.editStudent(student)}
                  disabled={busy}
                >
                  <Pencil /> {t("common.edit")}
                </Button>
                {workspaceId && !!student.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTabState((prev) => ({
                        id: student.id,
                        tab: "learning",
                        invite: (prev.id === student.id ? prev.invite : 0) + 1,
                        notice: prev.notice,
                      }))
                    }
                  >
                    <Send /> {t("detail.sendInvite")}
                  </Button>
                )}
                {student.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => actions.archiveStudent(student)}
                    disabled={busy}
                  >
                    <Archive /> {t("detail.archive")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => actions.restoreStudent(student)}
                    disabled={busy}
                  >
                    <ArchiveRestore /> {t("detail.restore")}
                  </Button>
                )}
              </div>
            </SheetHeader>
            <div className="detail-stats">
              <div>
                <span>{t("detail.creditsLeft")}</span>
                <strong>
                  {creditsFor(data, student.id)}
                  <small>
                    {t("common.lessonUnit", {
                      count: creditsFor(data, student.id),
                    })}
                  </small>
                </strong>
              </div>
              <div>
                <span>{t("students.openBalance")}</span>
                <strong>{money(balanceFor(data, student.id))}</strong>
              </div>
              <div>
                <span>{t("overview.figureCompleted")}</span>
                <strong>
                  {lessons.filter((l) => l.status === "COMPLETED").length}
                  <small>
                    {t("common.lessonUnit", {
                      count: lessons.filter((l) => l.status === "COMPLETED")
                        .length,
                    })}
                  </small>
                </strong>
              </div>
            </div>
            <Tabs
              value={current.tab}
              onValueChange={(v) =>
                setTabState((prev) => ({
                  id: student.id,
                  tab: v,
                  invite: 0,
                  notice: prev.notice,
                }))
              }
              key={student.id}
              className="detail-tabs"
            >
              {/* Dar ekranda sekmeler alt satıra kırılmak yerine yana kayar;
                  paneldeki diğer sekme şeritleriyle aynı davranış. */}
              <TabsList className="mx-6 mt-5 max-w-[calc(100%-3rem)] shrink-0 justify-start overflow-x-auto">
                <TabsTrigger value="packages" className="flex-none">
                  {t("detail.tabPackages")}
                </TabsTrigger>
                <TabsTrigger value="lessons" className="flex-none">
                  {t("nav.lessons")}
                </TabsTrigger>
                <TabsTrigger value="notes" className="flex-none">
                  {t("detail.tabNote")}
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-none">
                  {t("detail.tabHistory")}
                </TabsTrigger>
                {workspaceId && (
                  <TabsTrigger value="learning" className="flex-none">
                    {t("detail.tabLearning")}
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="packages" className="detail-tab-content">
                <div className="flex flex-wrap justify-between gap-3 mb-5">
                  <h2>{t("detail.packagesTitle")}</h2>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actions.newPayment(student.id)}
                      disabled={busy}
                    >
                      <Wallet /> {t("overview.collect")}
                    </Button>
                    {!!student.active && (
                      <Button
                        size="sm"
                        onClick={() => actions.newPackage(student.id)}
                        disabled={busy}
                      >
                        <Plus /> {t("overview.addPackage")}
                      </Button>
                    )}
                  </div>
                </div>
                {packages.length ? (
                  packages.map((p) => (
                    <div className="package-card" key={p.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3>{p.name}</h3>
                          <p>
                            {money(p.price_minor)} ·{" "}
                            {t("common.lessonCount", { count: p.granted })}
                          </p>
                        </div>
                        <CreditBadge count={p.remaining} unit="credits" />
                      </div>
                      <Progress
                        value={(p.remaining / p.granted) * 100}
                        className="h-1.5 mt-5 mb-2"
                      />
                      <div className="package-meta">
                        <span>
                          {t("detail.used", {
                            used: p.granted - p.remaining,
                            count: p.granted,
                          })}
                        </span>
                        <span>
                          {p.expires_on
                            ? t(
                                p.expires_on < dateKey()
                                  ? "detail.expiredOn"
                                  : "detail.lastDay",
                                {
                                  date: dayLabel(
                                    p.expires_on + "T12:00:00+03:00",
                                    { year: "numeric", month: "short" },
                                  ),
                                },
                              )
                            : t("detail.noExpiry")}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={BookOpen}
                    title={t("detail.noPackages")}
                    text={t("detail.noPackagesHint")}
                    action={
                      student.active ? (
                        <Button onClick={() => actions.newPackage(student.id)}>
                          <Plus /> {t("overview.addPackage")}
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </TabsContent>
              <TabsContent value="lessons">
                <div className="flex justify-between items-center gap-3 px-6 py-5">
                  <h2>{t("detail.lessonHistory")}</h2>
                  {!!student.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actions.newLesson(student.id)}
                    >
                      <Plus /> {t("ws.planLesson")}
                    </Button>
                  )}
                </div>
                {lessons.length ? (
                  <LessonRows
                    lessons={[...lessons].reverse()}
                    data={data}
                    actions={actions}
                    busy={busy}
                    showDate
                  />
                ) : (
                  <Empty
                    icon={CalendarDays}
                    title={t("detail.noLessons")}
                    text={t("detail.noLessonsHint")}
                  />
                )}
              </TabsContent>
              <TabsContent value="notes" className="detail-tab-content">
                <NoteEditor
                  key={
                    student.id +
                    ":" +
                    (data.notes.find((n) => n.student_id === student.id)
                      ?.version || 0)
                  }
                  studentId={student.id}
                  note={data.notes.find((n) => n.student_id === student.id)}
                  mutate={mutate}
                  busy={busy}
                />
              </TabsContent>
              <TabsContent value="history" className="detail-tab-content">
                <h2 className="mb-5">{t("detail.creditHistory")}</h2>
                {credits.length ? (
                  <div className="credit-history">
                    {credits.map((c) => (
                      <div className="credit-history-row" key={c.id}>
                        <span
                          className={`history-icon ${c.delta > 0 ? "positive" : ""}`}
                        >
                          {c.delta > 0 ? (
                            <ArrowDownLeft size={17} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </span>
                        <div>
                          <strong>
                            {c.delta > 0
                              ? t("detail.creditReturned")
                              : t("detail.lessonCompleted")}
                          </strong>
                          <p>
                            {
                              data.lessons.find((l) => l.id === c.lesson_id)
                                ?.topic
                            }
                          </p>
                          <small>
                            {dayLabel(c.created_at, {
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        </div>
                        <b>{c.delta > 0 ? "+1" : "−1"}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={t("detail.noHistory")}
                    text={t("detail.noHistoryHint")}
                  />
                )}
              </TabsContent>
              {workspaceId && (
                <TabsContent value="learning" className="detail-tab-content">
                  <LearningPanel
                    // Kısayoldan gelindiğinde panel yeniden kurulsun ki
                    // "Davetler" sekmesi ve form açılış anında gelsin.
                    key={
                      current.invite
                        ? "invite-" + current.invite
                        : focus?.at === current.notice
                          ? "notice-" + current.notice
                          : "normal"
                    }
                    workspaceId={workspaceId}
                    studentId={student.id}
                    studentName={student.name}
                    studentPhone={student.phone}
                    initialTab={
                      current.invite
                        ? "access"
                        : focus?.at === current.notice
                          ? "notes"
                          : undefined
                    }
                    autoInvite={current.invite > 0}
                    focus={
                      !current.invite && focus?.at === current.notice
                        ? { id: focus.itemId, at: focus.at }
                        : undefined
                    }
                  />
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
