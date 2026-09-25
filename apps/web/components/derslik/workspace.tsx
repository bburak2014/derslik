"use client";
import { TeachingHub, isTeachingView, type TeachingView } from "./teaching-hub";
import { AccountExtras, type NoticeFocus } from "./learning-panel";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { LanguageSelect } from "@/components/i18n/language-select";
import { t, upper, type MessageKey } from "@derslik/contracts";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Users,
  Wallet,
  Plus,
  Search,
  LogOut,
  RefreshCw,
  FlaskConical,
  ChevronRight,
  FileText,
  Video,
  ClipboardList,
} from "lucide-react";
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
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
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

type View = CoreView | TeachingView;
const navigation: { id: View; label: MessageKey; icon: typeof Users }[] = [
  { id: "overview", label: "nav.overview", icon: LayoutDashboard },
  { id: "calendar", label: "nav.calendar", icon: CalendarDays },
  { id: "students", label: "nav.students", icon: Users },
  { id: "payments", label: "nav.payments", icon: Wallet },
  { id: "assignments", label: "nav.assignments", icon: ClipboardList },
  { id: "files", label: "nav.files", icon: FileText },
  { id: "videos", label: "nav.videos", icon: Video },
];
const titles: Record<View, { title: MessageKey; subtitle: MessageKey }> = {
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

function Navigation({
  view,
  onNavigate,
  count,
}: {
  view: View;
  onNavigate: (view: View) => void;
  count: number;
}) {
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
}: {
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
}) {
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("overview"),
    [search, setSearch] = useState(""),
    [selectedDay, setSelectedDay] = useState(dateKey()),
    [studentId, setStudentId] = useState<string | null>(null),
    [modal, setModal] = useState<ModalState | null>(null);
  const [signoutOpen, setSignoutOpen] = useState(false);
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
      const r = await fetch("/api/workspace", { cache: "no-store" });
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
  useEffect(() => {
    const sync = () => {
      const v = new URLSearchParams(location.search).get("view");
      if (navigation.some((n) => n.id === v)) setView(v as View);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(v: View) {
    setView(v);
    setSearch("");
    setHubFocus(null);
    window.history.pushState({}, "", "/?view=" + v);
  }
  // Bildirim: ödev ve videolar kendi sayfalarında o öğrenciyle açılır;
  // paylaşımlar öğrenci dosyasının "Öğrenme" sekmesinde. Prop değişince
  // render sırasında uygulanır (React'in önerdiği "önceki değeri sakla" yolu).
  const [appliedFocus, setAppliedFocus] = useState(0),
    [hubFocus, setHubFocus] = useState<NoticeFocus | null>(null),
    [notesFocus, setNotesFocus] = useState<NoticeFocus | null>(null);
  if (
    focus &&
    focus.at !== appliedFocus &&
    focus.workspaceId === connected.id
  ) {
    setAppliedFocus(focus.at);
    if (focus.section === "notes") {
      setNotesFocus(focus);
      setStudentId(focus.studentId);
    } else {
      setView(focus.section);
      setHubFocus(focus);
      setSearch("");
      setStudentId(null);
    }
  }
  // Adres çubuğu render sırasında değişemez (Next yönlendiricisini günceller).
  const focusedView = hubFocus?.section;
  useEffect(() => {
    if (focusedView) window.history.pushState({}, "", "/?view=" + focusedView);
  }, [focusedView, appliedFocus]);
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
  const actions: Actions = {
    makeup: connected
      ? (l) =>
          setModal({
            type: "lesson",
            studentId: l.student_id,
            date: dateKey(),
            makeupForId: l.id,
          })
      : undefined,
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
          <Navigation view={view} onNavigate={navigate} count={active} />
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
        <SidebarFooter className="p-6 gap-4">
          <ThemeToggle />
          <LanguageSelect />
          {switcher}
          <div className="profile">
            <span className="avatar">{upper(displayName.charAt(0))}</span>
            <div>
              <strong title={displayName}>{displayName}</strong>
              <small>{t("ws.teacherAccount")}</small>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="signout justify-start"
            onClick={() => setSignoutOpen(true)}
          >
            <LogOut /> {t("common.signOut")}
          </Button>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <a href="#main-content" className="skip-link">
          {t("common.skipToContent")}
        </a>
        <header className="topbar">
          <div className="topbar-crumbs">
            <SidebarTrigger aria-label={t("common.toggleMenu")} />
            <span className="crumb-root">{t("ws.myWorkspace")}</span>
            <ChevronRight size={13} className="crumb-sep" />
            <span className="crumb-current">
              {t(navigation.find((n) => n.id === view)!.label)}
            </span>
          </div>
          <div className="topbar-actions">
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
          </div>
        </header>
        <div className="page-body" id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === "overview"
                  ? upper(t("ws.focusOnTeaching"))
                  : upper("Derslik") +
                    " / " +
                    upper(t(navigation.find((n) => n.id === view)!.label))}
              </p>
              <h1>{t(titles[view].title)}</h1>
              <p>{t(titles[view].subtitle)}</p>
            </div>
            {!isTeachingView(view) && (
              <Button
                size="lg"
                disabled={loading || busy}
                onClick={() =>
                  view === "students"
                    ? setModal({ type: "student" })
                    : view === "payments"
                      ? actions.newPayment()
                      : actions.newLesson()
                }
              >
                <Plus />
                {view === "students"
                  ? t("ws.addStudent")
                  : view === "payments"
                    ? t("ws.addPayment")
                    : t("ws.planLesson")}
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
      />
      {modal && (
        <RecordDialog
          key={JSON.stringify(modal)}
          modal={modal}
          data={data}
          onClose={() => setModal(null)}
          onSwitch={setModal}
          mutate={mutate}
          busy={busy}
        />
      )}
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
