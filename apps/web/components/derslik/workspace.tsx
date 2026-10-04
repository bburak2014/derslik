"use client";
import { TeachingHub, isTeachingView, type TeachingView } from "./teaching-hub";
import { AccountExtras, type NoticeFocus } from "./learning-panel";
import { t, upper, type MessageKey, type Showcase } from "@derslik/contracts";
import { useState, useRef, useEffect, useCallback } from "react";
import { workspaceResponse } from "@/lib/workspace-prefetch";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Users,
  Wallet,
  Plus,
  Search,
  RefreshCw,
  FlaskConical,
  FileText,
  Video,
  ClipboardList,
  Store,
  MessageCircle,
} from "lucide-react";
import { ShowcaseView } from "./showcase";
import {
  CHAT_FROM_LIST,
  MessagesView,
  chatFromSearch,
  chatSearch,
  useMessageThreads,
} from "./messages";
import { SidebarAccount, Topbar } from "./shell";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { PageLoader, Spinner } from "@/components/derslik/loading";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  emptyWorkspace,
  dateKey,
  type WorkspaceData,
  type View as CoreView,
  type Lesson,
  type Student,
  type Payment,
} from "@/lib/domain/types";
import type { Command } from "@/lib/domain/validation";
import { Overview, CalendarView, StudentsView, PaymentsView } from "./views";
import { RecordDialog, type ModalState } from "./record-dialog";
import { StudentDetail } from "./student-detail";
import { useWorkspaceTools } from "./use-workspace-tools";
import { MeetingLinkDialog } from "./live-lesson";

type View = CoreView | TeachingView | "showcase" | "messages";
const navigation: { id: View; label: MessageKey; icon: typeof Users }[] = [
  { id: "overview", label: "nav.overview", icon: LayoutDashboard },
  { id: "calendar", label: "nav.calendar", icon: CalendarDays },
  { id: "students", label: "nav.students", icon: Users },
  { id: "messages", label: "nav.messages", icon: MessageCircle },
  { id: "payments", label: "nav.payments", icon: Wallet },
  { id: "assignments", label: "nav.assignments", icon: ClipboardList },
  { id: "files", label: "nav.files", icon: FileText },
  { id: "videos", label: "nav.videos", icon: Video },
  { id: "showcase", label: "nav.showcase", icon: Store },
];
const viewFromUrl = (search: string): View => {
  const v = new URLSearchParams(search).get("view");
  return navigation.some((n) => n.id === v) ? (v as View) : "overview";
};
/** Sunucuda sayfanın sorgu dizesi, tarayıcıda adres çubuğu (ilk açılışta
 *  ikisi aynıdır; çizimler eşleşir). */
const clientSearch = (initial: string) =>
  typeof location === "undefined" ? initial : location.search;
const titles: Record<View, { title: MessageKey; subtitle: MessageKey }> = {
  messages: {
    title: "chat.title",
    subtitle: "chat.subtitleTeacher",
  },
  showcase: {
    title: "nav.showcase",
    subtitle: "dir.showcaseSubtitle",
  },
  assignments: {
    title: "nav.assignments",
    subtitle: "ws.assignmentsSubtitle",
  },
  files: {
    title: "nav.files",
    subtitle: "ws.filesSubtitle",
  },
  videos: {
    title: "nav.videos",
    subtitle: "ws.videosSubtitle",
  },
  overview: {
    title: "ws.overviewTitle",
    subtitle: "ws.overviewSubtitle",
  },
  calendar: {
    title: "nav.calendar",
    subtitle: "ws.calendarSubtitle",
  },
  students: {
    title: "ws.studentsTitle",
    subtitle: "ws.studentsSubtitle",
  },
  payments: {
    title: "nav.payments",
    subtitle: "ws.paymentsSubtitle",
  },
};
export type Actions = {
  liveBase?: (lesson: Lesson) => string;
  meeting?: (lesson: Lesson) => void;
  makeup?: (lesson: Lesson) => void;
  openStudent: (id: string) => void;
  newPackage: (id?: string) => void;
  newLesson: (id?: string) => void;
  newPayment: (id?: string) => void;
  complete: (lesson: Lesson) => void;
  reverse: (lesson: Lesson) => void;
  cancel: (lesson: Lesson) => void;
  reschedule: (lesson: Lesson) => void;
  voidPayment: (payment: Payment) => void;
  editStudent: (student: Student) => void;
  archiveStudent: (student: Student) => void;
  restoreStudent: (student: Student) => void;
};
export type Mutate = (command: Command, message: string) => Promise<boolean>;

/** Form değişse de kapanışta ilk açan öğeye dön; yeni forma odak çalma. */
function useRecordModal() {
  const [modal, setModal] = useState<ModalState | null>(null);
  const trigger = useRef<HTMLElement | null>(null),
    open = useRef(false);
  function changeModal(next: ModalState | null) {
    if (next && !open.current) {
      const active = document.activeElement;
      trigger.current = active instanceof HTMLElement ? active : null;
    }
    open.current = next !== null;
    setModal(next);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (!open.current && trigger.current?.isConnected)
      trigger.current.focus({ preventScroll: true });
  }
  return { modal, setModal: changeModal, restoreFocus };
}

function Navigation({
  view,
  onNavigate,
  count,
  requests,
  unread,
}: Readonly<{
  view: View;
  onNavigate: (view: View) => void;
  count: number;
  /** Vitrindeki yanıt bekleyen ders istekleri. */
  requests: number;
  /** Öğrenci ve velilerden gelen okunmamış mesajlar. */
  unread: number;
}>) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {navigation.map(({ id, label, icon: Icon }) => (
        <SidebarMenuItem key={id}>
          <SidebarMenuButton
            isActive={id === view}
            className="h-12 gap-3 px-4 text-sm"
            onClick={() => {
              onNavigate(id);
              setOpenMobile(false);
            }}
          >
            <Icon />
            <span>{t(label)}</span>
            {id === "students" && count > 0 && (
              <span className="nav-count">{count}</span>
            )}
            {id === "showcase" && requests > 0 && (
              <span className="nav-count nav-count-marker">{requests}</span>
            )}
            {id === "messages" && unread > 0 && (
              <span className="nav-count nav-count-marker">{unread}</span>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
export default function Workspace({
  displayName,
  connected,
  onSignout,
  switcher,
  focus,
  onNotice,
  initialSearch = "",
}: Readonly<{
  displayName: string;
  connected: import("@derslik/api-client").Access;
  onSignout: () => void;
  /** Workspace picker. It lives inside the sidebar because the sidebar is
   *  position:fixed from the top of the viewport — anything rendered above it
   *  as a sibling is covered, taking keyboard focus out of sight with it. */
  switcher?: React.ReactNode;
  /** Bildirimden açılacak yer ve bildirime tıklanınca çağrılan işlev. */
  focus?: NoticeFocus | null;
  onNotice?: (target: import("@derslik/contracts").NoticeTarget) => void;
  /** Sayfanın sorgu dizesi: sunucu ve istemci ilk çizimde aynı görünümü seçer. */
  initialSearch?: string;
}>) {
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false);
  // Tarayıcıda adres çubuğunun kendisi okunur: erişim değişip alan yeniden
  // kurulduğunda sayfanın ilk açılıştaki sorgu dizesi eskimiş olabilir.
  const [view, setView] = useState<View>(() =>
      viewFromUrl(clientSearch(initialSearch)),
    ),
    [search, setSearch] = useState(""),
    [selectedDay, setSelectedDay] = useState(dateKey()),
    [studentId, setStudentId] = useState<string | null>(null),
    // Mesajlar görünümünde açık yazışma ve öğrenci süzgeci (adres çubuğunda).
    [chat, setChat] = useState(() =>
      chatFromSearch(clientSearch(initialSearch)),
    ),
    // Mesaj bildirimine dokunulan an: açık yazışma ve liste yenilenir.
    [chatFocus, setChatFocus] = useState(0);
  const [signoutOpen, setSignoutOpen] = useState(false);
  const [meetingLesson, setMeetingLesson] = useState<Lesson | null>(null);
  const { modal, setModal, restoreFocus } = useRecordModal();
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    command: Command;
    message: string;
  } | null>(null);
  const inFlight = useRef(false),
    retryKeys = useRef(new Map<string, string>());
  const reload = useCallback(async () => {
    try {
      const r = await workspaceResponse();
      const json = (await r.json()) as WorkspaceData & { error?: string };
      if (!r.ok) throw new Error(json.error || t("ws.loadFailed"));
      setData(json);
      setLoadError("");
      return true;
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : t("common.checkConnection"),
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void reload();
  }, [reload]);
  // İlk durum zaten adresten kuruldu; burada yalnızca geri/ileri izlenir.
  // Açılışta yeniden okunsaydı ilk çizimde uygulanan bildirim (ör. portaldan
  // gelen mesaj bildirimi) eski adresle ezilirdi.
  useEffect(() => {
    const sync = () => {
      setView(viewFromUrl(location.search));
      setChat(chatFromSearch(location.search));
      // Bildirimle açılan yazışmadan geri dönüldü: adres yeniden yazılmaz.
      setChatFocus(0);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(v: View) {
    setView(v);
    setSearch("");
    setHubFocus(null);
    setShowcaseFocus(null);
    setCalendarFocus(false);
    setChat({ thread: null, student: null });
    setChatFocus(0);
    window.history.pushState({}, "", "/?view=" + v);
  }
  /** Mesajlar görünümünde yazışma (null: liste) açar; öğrenci dosyasından
   *  gelindiyse liste o öğrencinin yazışmalarıyla sınırlı kalır. */
  function openChat(thread: string | null, student: string | null = null) {
    const fromList = !!thread && view === "messages" && !chat.thread;
    setView("messages");
    setChat({ thread, student });
    setSearch("");
    setHubFocus(null);
    setShowcaseFocus(null);
    setCalendarFocus(false);
    setChatFocus(0);
    window.history.pushState(
      fromList ? CHAT_FROM_LIST : {},
      "",
      "/" + chatSearch(thread, student),
    );
  }
  // Bildirim: ödev ve videolar kendi sayfalarında o öğrenciyle açılır;
  // paylaşımlar öğrenci dosyasının "Öğrenme" sekmesinde. Prop değişince
  // render sırasında uygulanır (React'in önerdiği "önceki değeri sakla" yolu).
  const [appliedFocus, setAppliedFocus] = useState(0),
    [hubFocus, setHubFocus] = useState<NoticeFocus | null>(null),
    [notesFocus, setNotesFocus] = useState<NoticeFocus | null>(null),
    [showcaseFocus, setShowcaseFocus] = useState<{
      id: string | null;
      at: number;
    } | null>(null),
    [calendarFocus, setCalendarFocus] = useState(false),
    [requests, setRequests] = useState(0);
  // Kenar çubuğundaki okunmamış mesaj sayacı ve Mesajlar görünümü aynı
  // listeyi kullanır; liste görünürken dakikada bir yenilenir.
  const chatStore = useMessageThreads(`/workspaces/${connected.id}/messages`);
  // Kenar çubuğundaki istek sayacı sayfa açılışında bir kez alınır; vitrin
  // sayfası açıkken oradaki liste sayacı günceller.
  useEffect(() => {
    let alive = true;
    backend<{ data: Showcase }>(`/workspaces/${connected.id}/showcase`)
      .then(
        (r) =>
          alive &&
          setRequests(
            r.data.requests.filter((x) => x.status === "PENDING").length,
          ),
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [connected.id]);
  // Bildirimin bölümüne göre görünüm ve vurgular ayarlanır; render sırasında
  // yalnızca aşağıdaki koşul içinden çağrılır.
  function applyFocusSection(target: NoticeFocus) {
    if (target.section === "requests") {
      setView("showcase");
      setShowcaseFocus({ id: target.itemId, at: target.at });
      setStudentId(null);
    } else if (target.section === "myRequests") {
      // Öğrenci bildirimi; öğretmen görünümünde açılacak yeri yok.
    } else if (target.section === "messages") {
      // Mesaj bildirimi: yazışma Mesajlar görünümünde açılır.
      setView("messages");
      setChat({ thread: target.itemId, student: null });
      setSearch("");
      setHubFocus(null);
      setShowcaseFocus(null);
      setNotesFocus(null);
      setStudentId(null);
    } else if (target.section === "lessons") {
      // Ders hatırlatması: takvim o dersin gününde açılır.
      const lesson = data.lessons.find((l) => l.id === target.itemId);
      setSelectedDay(dateKey(lesson?.starts_at));
      setView("calendar");
      setSearch("");
      setHubFocus(null);
      setShowcaseFocus(null);
      setStudentId(null);
    } else if (target.section === "notes") {
      setNotesFocus(target);
      setStudentId(target.studentId);
    } else {
      setView(target.section);
      setHubFocus(target);
      setShowcaseFocus(null);
      setSearch("");
      setStudentId(null);
    }
  }
  if (
    focus &&
    focus.at !== appliedFocus &&
    focus.workspaceId === connected.id
  ) {
    setAppliedFocus(focus.at);
    setCalendarFocus(focus.section === "lessons");
    // Önceki mesaj bildirimi yeni bildirimin adresini ezmesin.
    setChatFocus(focus.section === "messages" ? focus.at : 0);
    applyFocusSection(focus);
  }
  // Adres çubuğu render sırasında değişemez (Next yönlendiricisini günceller).
  const focusedView = focusedViewOf(
    showcaseFocus,
    calendarFocus,
    chatFocus,
    hubFocus?.section,
  );
  const focusedUrl = focusedUrlOf(focusedView, chat);
  useEffect(() => {
    if (focusedUrl) window.history.pushState({}, "", "/" + focusedUrl);
  }, [focusedUrl, appliedFocus]);
  /** Öğrenci dosyasındaki "Mesajlar": tek yazışma doğrudan, birden çoksa o
   *  öğrencinin listesi açılır. Bağlı hesabı yoksa false döner. */
  async function openStudentChat(id: string) {
    // Liste en fazla bir dakika eski; yeni kabul edilen davet de görünsün diye
    // tıklamada yeniden alınır (alınamazsa eldeki liste kullanılır).
    const list = (await chatStore.reload()) ?? chatStore.threads;
    const own = list?.filter((x) => x.studentId === id);
    if (own && !own.length) return false;
    setStudentId(null);
    openChat(own?.length === 1 ? own[0].linkId : null, id);
    return true;
  }
  const mutate: Mutate = async (command, message) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    const signature = JSON.stringify(command);
    const key = retryKeys.current.get(signature) || crypto.randomUUID();
    retryKeys.current.set(signature, key);
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Derslik-Client": "web",
        },
        body: signature,
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(result.error || t("ws.saveFailed"));
      retryKeys.current.delete(signature);
      const refreshed = await reload();
      toast.success(message, {
        description: refreshed ? undefined : t("ws.savedRefresh"),
      });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ws.saveRetry"));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  useWorkspaceTools(data, mutate, setModal);
  const makeupLesson = (l: Lesson) =>
    setModal({
      type: "lesson",
      studentId: l.student_id,
      date: dateKey(),
      makeupForId: l.id,
    });
  const actions: Actions = {
    makeup: makeupLesson,
    openStudent: setStudentId,
    newPackage: (id) => setModal({ type: "package", studentId: id }),
    newLesson: (id) =>
      setModal({ type: "lesson", studentId: id, date: selectedDay }),
    newPayment: (id) => setModal({ type: "payment", studentId: id }),
    complete: (l) =>
      setConfirmation({
        title: t("confirm.completeTitle"),
        description: t("confirm.completeBody"),
        command: { action: "lesson.complete", id: l.id, version: l.version },
        message: t("confirm.completeDone"),
      }),
    reverse: (l) =>
      setConfirmation({
        title: t("confirm.reverseTitle"),
        description: t("confirm.reverseBody"),
        command: { action: "lesson.reverse", id: l.id, version: l.version },
        message: t("confirm.reverseDone"),
      }),
    cancel: (l) =>
      setConfirmation({
        title: t("confirm.cancelTitle"),
        description: t("confirm.cancelBody"),
        command: { action: "lesson.cancel", id: l.id, version: l.version },
        message: t("confirm.cancelDone"),
      }),
    reschedule: (l) => setModal({ type: "reschedule", lesson: l }),
    meeting: (l) => setMeetingLesson(l),
    liveBase: (l) => `/workspaces/${encodeURIComponent(connected.id)}/students/${encodeURIComponent(l.student_id)}/lessons/${encodeURIComponent(l.id)}/board`,
    voidPayment: (p) =>
      setConfirmation({
        title: t("confirm.voidTitle"),
        description: t("confirm.voidBody"),
        command: { action: "payment.void", id: p.id, version: p.version },
        message: t("confirm.voidDone"),
      }),
    editStudent: (s) => setModal({ type: "student", student: s }),
    archiveStudent: (s) =>
      setConfirmation({
        title: t("confirm.archiveTitle"),
        description: t("confirm.archiveBody"),
        command: { action: "student.archive", id: s.id, version: s.version },
        message: t("confirm.archiveDone"),
      }),
    restoreStudent: (s) =>
      setConfirmation({
        title: t("confirm.restoreTitle"),
        description: t("confirm.restoreBody"),
        command: { action: "student.restore", id: s.id, version: s.version },
        message: t("confirm.restoreDone"),
      }),
  };
  const active = data.students.filter((s) => s.active).length;
  const currentStudent = data.students.find((s) => s.id === studentId) || null;
  // Başlıktaki "+" düğmesi; öğretim sayfaları, vitrin ve mesajlarda yok.
  const addButton =
    !isTeachingView(view) && view !== "showcase" && view !== "messages";
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarHeader className="p-7">
          <a href="/" className="brand" aria-label={t("ws.homeLink")}>
            <BookOpen />
            <span>
              derslik<span className="brand-dot">.</span>
            </span>
          </a>
          <p className="sidebar-kicker">{upper(t("ws.teacherWorkspace"))}</p>
        </SidebarHeader>
        <SidebarContent className="px-4 pt-6">
          <p className="nav-label">{upper(t("ws.myWorkspace"))}</p>
          <Navigation
            view={view}
            onNavigate={navigate}
            count={active}
            requests={requests}
            unread={chatStore.unread}
          />
          <div className="sidebar-note">
            <span className="note-flower">✳</span>
            <p>
              {t("ws.noteSmall")}
              <br />
              <strong>{t("ws.noteBig")}</strong>
            </p>
            <span>{t("ws.noteFocus")}</span>
          </div>
        </SidebarContent>
        <SidebarAccount
          displayName={displayName}
          role={t("ws.teacherAccount")}
          switcher={switcher}
          onSignout={() => setSignoutOpen(true)}
        />
      </Sidebar>
      <main className="workspace">
        <Topbar
          root={t("ws.myWorkspace")}
          current={t(navigation.find((n) => n.id === view)!.label)}
        >
          {connected && (
            <AccountExtras workspaceId={connected.id} onOpen={onNotice} />
          )}
          <span className="workspace-tag">
            <span /> {t("ws.privateToYou")}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("ws.refresh")}
            onClick={() => void reload()}
            disabled={busy || loading}
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
          </Button>
        </Topbar>
        <div className="page-body" id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{eyebrowFor(view)}</p>
              <h1>{t(titles[view].title)}</h1>
              <p>{t(titles[view].subtitle)}</p>
            </div>
            {addButton && (
              <Button
                size="lg"
                disabled={loading || busy}
                onClick={() => addRecord(view, actions, setModal)}
              >
                <Plus />
                {addLabel(view)}
              </Button>
            )}
          </div>
          {loadError && (
            <div className="error-banner" role="alert">
              <span>{loadError}</span>
              <Button size="sm" variant="outline" onClick={() => void reload()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {data.students.some((s) => s.is_sample === 1) && (
            <div className="sample-banner">
              <FlaskConical size={15} />
              <span>{t("ws.sampleBanner")}</span>
            </div>
          )}
          {loading ? (
            <PageLoader />
          ) : (
            <>
              {view === "overview" && (
                <Overview
                  data={data}
                  actions={actions}
                  onNavigate={navigate}
                  onAddStudent={() => setModal({ type: "student" })}
                  onSeed={
                    connected
                      ? undefined
                      : () =>
                          setConfirmation({
                            title: t("confirm.seedTitle"),
                            description: t("confirm.seedBody"),
                            command: { action: "seed" },
                            message: t("confirm.seedDone"),
                          })
                  }
                  busy={busy}
                />
              )}
              {view === "calendar" && (
                <CalendarView
                  data={data}
                  actions={actions}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  busy={busy}
                  workspaceId={connected.id}
                />
              )}
              {view === "students" && (
                <>
                  <div className="search-row">
                    <InputGroup className="bg-card">
                      <InputGroupAddon>
                        <Search size={17} />
                      </InputGroupAddon>
                      <InputGroupInput
                        aria-label={t("ws.searchStudents")}
                        placeholder={t("ws.searchPlaceholder")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </InputGroup>
                    <span className="shrink-0 whitespace-nowrap">
                      {t("ws.studentRecords", { count: data.students.length })}
                    </span>
                  </div>
                  <StudentsView
                    data={data}
                    actions={actions}
                    search={search}
                    onAdd={() => setModal({ type: "student" })}
                  />
                </>
              )}
              {isTeachingView(view) && (
                <TeachingHub
                  workspaceId={connected.id}
                  data={data}
                  view={view}
                  focus={hubFocus}
                />
              )}
              {view === "payments" && (
                <PaymentsView data={data} actions={actions} busy={busy} />
              )}
              {view === "messages" && (
                <MessagesView
                  teacher
                  store={chatStore}
                  base={`/workspaces/${connected.id}/messages`}
                  thread={chat.thread}
                  student={chat.student}
                  studentName={
                    data.students.find((s) => s.id === chat.student)?.name
                  }
                  onOpen={(id) => openChat(id, chat.student)}
                  onClearStudent={() => openChat(chat.thread)}
                  refreshAt={chatFocus}
                />
              )}
              {view === "showcase" && (
                <ShowcaseView
                  workspaceId={connected.id}
                  fallbackName={connected.name}
                  focus={showcaseFocus}
                  onPending={setRequests}
                  onAccepted={() => void reload()}
                  onOpenStudent={setStudentId}
                />
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              derslik<span className="brand-dot">.</span>{" "}
              <span>{t("ws.footerTagline")}</span>
            </span>
            <span>{t("ws.footerTimezone")}</span>
          </footer>
        </div>
      </main>
      <StudentDetail
        student={currentStudent}
        data={data}
        actions={actions}
        onClose={() => setStudentId(null)}
        mutate={mutate}
        busy={busy}
        workspaceId={connected.id}
        focus={notesFocus}
        onMessages={openStudentChat}
        messagesUnread={
          chatStore.threads
            ?.filter((x) => x.studentId === studentId)
            .reduce((sum, x) => sum + x.unread, 0) ?? 0
        }
      />
      {modal && (
        <RecordDialog
          key={JSON.stringify(modal)}
          modal={modal}
          data={data}
          onClose={() => setModal(null)}
          onSwitch={setModal}
          onCloseAutoFocus={restoreFocus}
          mutate={mutate}
          busy={busy}
        />
      )}
      {meetingLesson && <MeetingLinkDialog lesson={meetingLesson} mutate={mutate} busy={busy} onClose={() => setMeetingLesson(null)} />}
      <AlertDialog open={signoutOpen} onOpenChange={setSignoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ws.signOutTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("ws.signOutBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSignoutOpen(false);
                onSignout();
              }}
            >
              {t("common.signOut")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (
                  confirmation &&
                  (await mutate(confirmation.command, confirmation.message))
                )
                  setConfirmation(null);
              }}
            >
              {busy ? (
                <>
                  <Spinner /> {t("common.saving")}
                </>
              ) : (
                t("common.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="bottom-right" richColors closeButton />
    </SidebarProvider>
  );
}

/** Adres çubuğuna yazılacak görünüm: açık bildirim vurgusunun sayfası. */
function focusedViewOf(
  showcaseFocus: { id: string | null; at: number } | null,
  calendarFocus: boolean,
  chatFocus: number,
  hubSection: NoticeFocus["section"] | undefined,
) {
  if (showcaseFocus) return "showcase";
  if (calendarFocus) return "calendar";
  if (chatFocus) return "messages";
  return hubSection;
}

/** Adres çubuğuna yazılacak sorgu dizesi; açık bildirim vurgusu yoksa boş. */
function focusedUrlOf(
  focusedView: ReturnType<typeof focusedViewOf>,
  chat: ReturnType<typeof chatFromSearch>,
) {
  return focusedView === "messages"
    ? chatSearch(chat.thread, chat.student)
    : focusedView && "?view=" + focusedView;
}

/** Sayfa başlığının üstündeki küçük etiket. */
const eyebrowFor = (view: View) =>
  view === "overview"
    ? upper(t("ws.focusOnTeaching"))
    : upper("Derslik") +
      " / " +
      upper(t(navigation.find((n) => n.id === view)!.label));

/** Üstteki ekle düğmesi: görünüme göre öğrenci, ödeme ya da ders formu. */
function addRecord(
  view: View,
  actions: Actions,
  setModal: (modal: ModalState) => void,
) {
  if (view === "students") setModal({ type: "student" });
  else if (view === "payments") actions.newPayment();
  else actions.newLesson();
}

function addLabel(view: View) {
  if (view === "students") return t("ws.addStudent");
  if (view === "payments") return t("ws.addPayment");
  return t("ws.planLesson");
}
