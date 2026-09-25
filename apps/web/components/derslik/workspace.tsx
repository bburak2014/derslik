"use client";
import { TeachingHub, isTeachingView, type TeachingView } from "./teaching-hub";
import { AccountExtras } from "./learning-panel";
import { ThemeToggle } from "@/components/account/theme-toggle";
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
const navigation = [
  { id: "overview" as View, label: "Genel bakış", icon: LayoutDashboard },
  { id: "calendar" as View, label: "Ders takvimi", icon: CalendarDays },
  { id: "students" as View, label: "Öğrenciler", icon: Users },
  { id: "payments" as View, label: "Tahsilatlar", icon: Wallet },
  { id: "assignments" as View, label: "Ödevler", icon: ClipboardList },
  { id: "files" as View, label: "PDF ve dosyalar", icon: FileText },
  { id: "videos" as View, label: "Ders videoları", icon: Video },
];
const titles: Record<View, { title: string; subtitle: string }> = {
  assignments: {
    title: "Ödevler",
    subtitle:
      "Öğrenciye ödev verin, PDF ekleyin ve tamamlanma durumunu takip edin.",
  },
  files: {
    title: "PDF ve dosyalar",
    subtitle:
      "Çalışma kağıtlarını ve ders materyallerini öğrenciye bağlı olarak saklayın.",
  },
  videos: {
    title: "Ders videoları",
    subtitle: "Ders kayıtlarını yükleyin ve buradan izleyin.",
  },
  overview: {
    title: "Her ders, yeni bir adım.",
    subtitle: "Günün planı ve öğrencilerinizin yolculuğu bir arada.",
  },
  calendar: {
    title: "Ders takvimi",
    subtitle: "Haftanızı planlayın, derslerinizi kolayca takip edin.",
  },
  students: {
    title: "Öğrencileriniz",
    subtitle: "Her öğrencinin gelişimine, kaldığınız yerden devam edin.",
  },
  payments: {
    title: "Tahsilatlar",
    subtitle: "Paket ücretlerini ve aldığınız ödemeleri takip edin.",
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
            <span>{label}</span>
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
}: {
  displayName: string;
  connected: import("@derslik/api-client").Access;
  onSignout: () => void;
  /** Workspace picker. It lives inside the sidebar because the sidebar is
   *  position:fixed from the top of the viewport — anything rendered above it
   *  as a sibling is covered, taking keyboard focus out of sight with it. */
  switcher?: React.ReactNode;
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
      if (!r.ok) throw new Error(json.error || "Kayıtlar yüklenemedi.");
      setData(json);
      setLoadError("");
      return true;
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : "Bağlantınızı kontrol ederek yeniden deneyin.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
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
    window.history.pushState({}, "", "/?view=" + v);
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
      if (!r.ok) throw new Error(result.error || "Kayıt tamamlanamadı.");
      retryKeys.current.delete(signature);
      const refreshed = await reload();
      toast.success(message, {
        description: refreshed
          ? undefined
          : "Kayıt kaydedildi. Güncel liste için Yenile düğmesini kullanın.",
      });
      return true;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Kaydedilemedi. Yeniden deneyin.",
      );
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
        title: "Ders tamamlansın mı?",
        description:
          "Ders tamamlandı olarak işaretlenecek ve bağlı paketten 1 ders hakkı düşülecek. Gerektiğinde bu işlemi geri alabilirsiniz.",
        command: { action: "lesson.complete", id: l.id, version: l.version },
        message: "Ders tamamlandı. Paketten 1 hak düşüldü.",
      }),
    reverse: (l) =>
      setConfirmation({
        title: "Tamamlamayı geri al",
        description:
          "1 ders hakkı pakete iade edilecek. Ders yeniden planlananlar arasına taşınacak; önceki hareket kaydı korunacak.",
        command: { action: "lesson.reverse", id: l.id, version: l.version },
        message: "1 ders hakkı iade edildi.",
      }),
    cancel: (l) =>
      setConfirmation({
        title: "Dersi iptal et",
        description:
          "Bu ders takvimde iptal olarak saklanacak. Paket hakkı düşülmeyecek. Haftalık serinin diğer dersleri etkilenmez.",
        command: { action: "lesson.cancel", id: l.id, version: l.version },
        message: "Ders iptal edildi.",
      }),
    reschedule: (l) => setModal({ type: "reschedule", lesson: l }),
    voidPayment: (p) =>
      setConfirmation({
        title: "Tahsilat kaydını iptal et",
        description:
          "Bu kayıt hesaplamadan çıkarılacak ve öğrencinin açık bakiyesi yeniden artacak. Kayıt geçmişte görünmeye devam edecek. Bu işlem bankadan para iadesi yapmaz.",
        command: { action: "payment.void", id: p.id, version: p.version },
        message: "Tahsilat kaydı iptal edildi.",
      }),
    editStudent: (s) => setModal({ type: "student", student: s }),
    archiveStudent: (s) =>
      setConfirmation({
        title: "Öğrenciyi arşivle",
        description:
          "Öğrenci aktif listeden çıkarılacak. Paketleri, tahsilatları ve geçmiş dersleri saklanacak. Planlanan dersi olan öğrenciler arşivlenemez.",
        command: { action: "student.archive", id: s.id, version: s.version },
        message: "Öğrenci arşivlendi.",
      }),
    restoreStudent: (s) =>
      setConfirmation({
        title: "Öğrenciyi aktife al",
        description:
          "Öğrenci yeniden aktif listeye dönecek; ders planlayabilir, içerik paylaşabilir ve davet gönderebilirsiniz. Aktif öğrenci sınırınız doluysa bu işlem yapılamaz.",
        command: { action: "student.restore", id: s.id, version: s.version },
        message: "Öğrenci yeniden aktif.",
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
          <a href="/" className="brand" aria-label="Derslik ana sayfa">
            <BookOpen />
            <span>
              derslik<span className="brand-dot">.</span>
            </span>
          </a>
          <p className="sidebar-kicker">ÖĞRETMEN ÇALIŞMA ALANI</p>
        </SidebarHeader>
        <SidebarContent className="px-4 pt-6">
          <p className="nav-label">ÇALIŞMA ALANIM</p>
          <Navigation view={view} onNavigate={navigate} count={active} />
          <div className="sidebar-note">
            <span className="note-flower">✳</span>
            <p>
              Küçük adımlar.
              <br />
              <strong>Büyük gelişimler.</strong>
            </p>
            <span>
              Her öğrencinin yolculuğunda
              <br />
              bir sonraki adıma odaklanın.
            </span>
          </div>
        </SidebarContent>
        <SidebarFooter className="p-6 gap-4">
          <ThemeToggle />
          {switcher}
          <div className="profile">
            <span className="avatar">
              {displayName.charAt(0).toLocaleUpperCase("tr")}
            </span>
            <div>
              <strong title={displayName}>{displayName}</strong>
              <small>Öğretmen hesabı</small>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="signout justify-start"
            onClick={() => setSignoutOpen(true)}
          >
            <LogOut /> Çıkış yap
          </Button>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <a href="#main-content" className="skip-link">
          İçeriğe geç
        </a>
        <header className="topbar">
          <div className="topbar-crumbs">
            <SidebarTrigger aria-label="Menüyü aç veya kapat" />
            <span className="crumb-root">Çalışma alanım</span>
            <ChevronRight size={13} className="crumb-sep" />
            <span className="crumb-current">
              {navigation.find((n) => n.id === view)?.label}
            </span>
          </div>
          <div className="topbar-actions">
            {connected && <AccountExtras workspaceId={connected.id} />}
            <span className="workspace-tag">
              <span /> Yalnızca size özel
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Kayıtları yenile"
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
                  ? "ÖĞRETMEYE ODAKLANIN."
                  : "DERSLİK / " +
                    navigation
                      .find((n) => n.id === view)
                      ?.label.toLocaleUpperCase("tr")}
              </p>
              <h1>{titles[view].title}</h1>
              <p>{titles[view].subtitle}</p>
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
                  ? "Öğrenci ekle"
                  : view === "payments"
                    ? "Tahsilat ekle"
                    : "Ders planla"}
              </Button>
            )}
          </div>
          {loadError && (
            <div className="error-banner" role="alert">
              <span>{loadError}</span>
              <Button size="sm" variant="outline" onClick={() => void reload()}>
                Yeniden dene
              </Button>
            </div>
          )}
          {data.students.some((s) => s.is_sample === 1) && (
            <div className="sample-banner">
              <FlaskConical size={15} />
              <span>
                Örnek kayıtlar içerir. “Örnek” etiketli öğrenciler ve işlemleri
                kurgusaldır.
              </span>
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
                            title: "Örnek kayıtları ekle",
                            description:
                              "4 kurgusal öğrenci, dersler, paketler ve örnek tahsilatlar çalışma alanınıza eklenecek. Böylece tüm akışları deneyebilirsiniz.",
                            command: { action: "seed" },
                            message: "Örnek çalışma alanı hazır.",
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
                        aria-label="Öğrenci ara"
                        placeholder="İsim, sınıf veya ders ara…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </InputGroup>
                    <span className="shrink-0 whitespace-nowrap">
                      {data.students.length} öğrenci kaydı
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
              <span>Öğretmeye daha çok zaman.</span>
            </span>
            <span>Türkiye saati · İstanbul</span>
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
            <AlertDialogTitle>Hesabınızdan çıkılsın mı?</AlertDialogTitle>
            <AlertDialogDescription>
              Oturumunuz kapanacak ve tekrar giriş yapmanız gerekecek.
              Kaydedilmemiş bir değişikliğiniz varsa önce kaydedin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSignoutOpen(false);
                onSignout();
              }}
            >
              Çıkış yap
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
            <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
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
                  <Spinner /> Kaydediliyor
                </>
              ) : (
                "Onayla"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="bottom-right" richColors closeButton />
    </SidebarProvider>
  );
}
