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
          "Özel notunuz kaydedildi.",
        );
      }}
    >
      <div className="private-note-label">
        <LockKeyhole size={16} />
        <Label htmlFor="private-note">Yalnızca benim notum</Label>
      </div>
      <p>Bu not öğretmen çalışma alanınıza özeldir.</p>
      <Textarea
        id="private-note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Bir sonraki derste hatırlamak istedikleriniz…"
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
          {busy ? <Spinner /> : null} Notu kaydet
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
}: {
  workspaceId?: string;
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
  });
  const current =
    tabState.id === student?.id
      ? tabState
      : { id: student?.id ?? "", tab: "packages", invite: 0 };
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
                      <ToneBadge tone="warn">Örnek öğrenci</ToneBadge>
                    )}
                    {!student.active && (
                      <ToneBadge tone="muted">Arşivlendi</ToneBadge>
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
                  <Pencil /> Düzenle
                </Button>
                {workspaceId && !!student.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTabState((prev) => ({
                        id: student.id,
                        tab: "learning",
                        invite:
                          (prev.id === student.id ? prev.invite : 0) + 1,
                      }))
                    }
                  >
                    <Send /> Davet gönder
                  </Button>
                )}
                {student.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => actions.archiveStudent(student)}
                    disabled={busy}
                  >
                    <Archive /> Arşivle
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => actions.restoreStudent(student)}
                    disabled={busy}
                  >
                    <ArchiveRestore /> Aktife al
                  </Button>
                )}
              </div>
            </SheetHeader>
            <div className="detail-stats">
              <div>
                <span>Kalan ders hakkı</span>
                <strong>
                  {creditsFor(data, student.id)}
                  <small>ders</small>
                </strong>
              </div>
              <div>
                <span>Açık bakiye</span>
                <strong>{money(balanceFor(data, student.id))}</strong>
              </div>
              <div>
                <span>Tamamlanan</span>
                <strong>
                  {lessons.filter((l) => l.status === "COMPLETED").length}
                  <small>ders</small>
                </strong>
              </div>
            </div>
            <Tabs
              value={current.tab}
              onValueChange={(v) =>
                setTabState({ id: student.id, tab: v, invite: 0 })
              }
              key={student.id}
              className="detail-tabs"
            >
              {/* Dar ekranda sekmeler alt satıra kırılmak yerine yana kayar;
                  paneldeki diğer sekme şeritleriyle aynı davranış. */}
              <TabsList className="mx-6 mt-5 max-w-[calc(100%-3rem)] shrink-0 justify-start overflow-x-auto">
                <TabsTrigger value="packages" className="flex-none">
                  Paketler
                </TabsTrigger>
                <TabsTrigger value="lessons" className="flex-none">
                  Dersler
                </TabsTrigger>
                <TabsTrigger value="notes" className="flex-none">
                  Özel not
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-none">
                  Hareketler
                </TabsTrigger>
                {workspaceId && (
                  <TabsTrigger value="learning" className="flex-none">
                    Ödev, PDF, video ve erişim
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="packages" className="detail-tab-content">
                <div className="flex flex-wrap justify-between gap-3 mb-5">
                  <h2>Ders paketleri</h2>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actions.newPayment(student.id)}
                      disabled={busy}
                    >
                      <Wallet /> Tahsilat
                    </Button>
                    {!!student.active && (
                      <Button
                        size="sm"
                        onClick={() => actions.newPackage(student.id)}
                        disabled={busy}
                      >
                        <Plus /> Paket ekle
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
                            {money(p.price_minor)} · {p.granted} ders
                          </p>
                        </div>
                        <CreditBadge count={p.remaining} unit="hak" />
                      </div>
                      <Progress
                        value={(p.remaining / p.granted) * 100}
                        className="h-1.5 mt-5 mb-2"
                      />
                      <div className="package-meta">
                        <span>
                          {p.granted - p.remaining} / {p.granted} ders
                          kullanıldı
                        </span>
                        <span>
                          {p.expires_on
                            ? (p.expires_on < dateKey()
                                ? "Süresi doldu · "
                                : "Son gün: ") +
                              dayLabel(p.expires_on + "T12:00:00+03:00", {
                                year: "numeric",
                                month: "short",
                              })
                            : "Süre sınırı yok"}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={BookOpen}
                    title="Henüz ders paketi yok."
                    text="Bir paket tanımlayarak öğrencinin ders haklarını ve ücretini kaydedin."
                    action={
                      student.active ? (
                        <Button onClick={() => actions.newPackage(student.id)}>
                          <Plus /> Paket ekle
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </TabsContent>
              <TabsContent value="lessons">
                <div className="flex justify-between items-center gap-3 px-6 py-5">
                  <h2>Ders geçmişi</h2>
                  {!!student.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actions.newLesson(student.id)}
                    >
                      <Plus /> Ders planla
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
                    title="Henüz planlanmış ders yok."
                    text="Öğrencinin paketiyle ilk dersi planlayarak başlayın."
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
                <h2 className="mb-5">Ders hakkı hareketleri</h2>
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
                              ? "Ders hakkı iade edildi"
                              : "Ders tamamlandı"}
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
                    title="Henüz ders hakkı hareketi yok."
                    text="Ders tamamladığınızda kullanım ve iade kayıtları burada görünür."
                  />
                )}
              </TabsContent>
              {workspaceId && (
                <TabsContent value="learning" className="detail-tab-content">
                  <LearningPanel
                    // Kısayoldan gelindiğinde panel yeniden kurulsun ki
                    // "Davetler" sekmesi ve form açılış anında gelsin.
                    key={current.invite ? "invite-" + current.invite : "normal"}
                    workspaceId={workspaceId}
                    studentId={student.id}
                    studentName={student.name}
                    studentPhone={student.phone}
                    initialTab={current.invite ? "access" : undefined}
                    autoInvite={current.invite > 0}
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
