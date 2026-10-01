"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Access, PortalData } from "@derslik/api-client";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  MessageCircle,
  NotebookPen,
  Send,
  UserRoundSearch,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AccountExtras,
  LearningPanel,
  learningTabs,
  type LearningTab,
  type LearningTabInfo,
  type NoticeFocus,
} from "./learning-panel";
import {
  t,
  upper,
  type MessageKey,
  type NoticeTarget,
} from "@derslik/contracts";
import { SidebarAccount, Topbar } from "./shell";
import { backend } from "@/lib/client";
import { MyRequests, TeacherDirectory, TeacherProfileView } from "./directory";
import {
  CHAT_FROM_LIST,
  chatFromSearch,
  chatSearch,
  useMessageThreads,
} from "./messages";

type PortalRole = "STUDENT" | "GUARDIAN";
/** Öğretmen bul ve İsteklerim: öğretmene bağlı olmayan öğrenci de görür. */
type DiscoverPage = "teachers" | "requests";
type PortalPage = LearningTab | DiscoverPage;
const discover: Record<
  DiscoverPage,
  { label: MessageKey; icon: LucideIcon; subtitle: MessageKey }
> = {
  teachers: {
    label: "nav.findTeacher",
    icon: UserRoundSearch,
    subtitle: "dir.findSubtitle",
  },
  requests: {
    label: "nav.myRequests",
    icon: Send,
    subtitle: "dir.myRequestsSubtitle",
  },
};
const isDiscover = (value: string | null): value is DiscoverPage =>
  value === "teachers" || value === "requests";

/** Menü etiketi ve sayfa başlığı. Hangi sayfaların görüneceğini öğretmenin
 *  verdiği izinler belirler; panel onları `onTabs` ile bildirir. */
const pages: Partial<
  Record<
    LearningTab,
    {
      label: MessageKey;
      icon: LucideIcon;
      subtitle: Record<PortalRole, MessageKey>;
    }
  >
> = {
  lessons: {
    label: "nav.lessons",
    icon: CalendarDays,
    subtitle: {
      STUDENT: "portal.lessonsStudent",
      GUARDIAN: "portal.lessonsGuardian",
    },
  },
  messages: {
    label: "nav.messages",
    icon: MessageCircle,
    subtitle: {
      STUDENT: "chat.subtitleStudent",
      GUARDIAN: "chat.subtitleGuardian",
    },
  },
  assignments: {
    label: "nav.assignments",
    icon: ClipboardList,
    subtitle: {
      STUDENT: "portal.assignmentsStudent",
      GUARDIAN: "portal.assignmentsGuardian",
    },
  },
  files: {
    label: "nav.files",
    icon: FileText,
    subtitle: {
      STUDENT: "portal.filesStudent",
      GUARDIAN: "portal.filesGuardian",
    },
  },
  videos: {
    label: "nav.videos",
    icon: Video,
    subtitle: {
      STUDENT: "portal.videosStudent",
      GUARDIAN: "portal.videosGuardian",
    },
  },
  notes: {
    label: "nav.notes",
    icon: NotebookPen,
    subtitle: {
      STUDENT: "portal.notesStudent",
      GUARDIAN: "portal.notesGuardian",
    },
  },
  payments: {
    label: "nav.balance",
    icon: Wallet,
    subtitle: {
      STUDENT: "portal.balanceStudent",
      GUARDIAN: "portal.balanceGuardian",
    },
  },
};

const isPage = (value: string | null): value is LearningTab =>
  !!value && value in pages;

/** Sayfa yenilense de açık sekme korunsun diye adres çubuğundaki `?view=`. */
function pageFromUrl(fallback: PortalPage, search?: string): PortalPage {
  if (search === undefined && typeof location === "undefined") return fallback;
  const params = new URLSearchParams(search ?? location.search);
  if (params.get("teacher")) return "teachers";
  const value = params.get("view");
  return isPage(value) || isDiscover(value) ? value : fallback;
}
const teacherFromUrl = (search?: string) =>
  search === undefined && typeof location === "undefined"
    ? null
    : new URLSearchParams(search ?? location.search).get("teacher");
/** Mesajlar sayfasında açık yazışma (`?view=messages&thread=`). */
const threadFromUrl = (search?: string) =>
  search === undefined && typeof location === "undefined"
    ? null
    : chatFromSearch(search ?? location.search).thread;

function DiscoverNavigation({
  current,
  onNavigate,
}: {
  current: PortalPage;
  onNavigate: (page: PortalPage) => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {(Object.keys(discover) as DiscoverPage[]).map((id) => {
        const Icon = discover[id].icon;
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={id === current}
              className="h-12 gap-3 px-4 text-sm"
              onClick={() => {
                onNavigate(id);
                setOpenMobile(false);
              }}
            >
              <Icon />
              <span>{t(discover[id].label)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function PortalNavigation({
  tabs,
  current,
  onNavigate,
  unread,
}: {
  tabs: LearningTabInfo[];
  current: PortalPage;
  onNavigate: (tab: PortalPage) => void;
  /** Öğretmenden gelen okunmamış mesajlar. */
  unread: number;
}) {
  const { setOpenMobile } = useSidebar();
  if (!tabs.length)
    return (
      <SidebarMenu aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuSkeleton showIcon className="h-12 px-4" />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  return (
    <SidebarMenu>
      {tabs.map(({ id }) => {
        const page = pages[id];
        if (!page) return null;
        const Icon = page.icon;
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={id === current}
              className="h-12 gap-3 px-4 text-sm"
              onClick={() => {
                onNavigate(id);
                setOpenMobile(false);
              }}
            >
              <Icon />
              <span>{t(page.label)}</span>
              {id === "messages" && unread > 0 && (
                <span className="nav-count nav-count-marker">{unread}</span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** Logo: sayfa yeniden yüklenmeden ilk sekmeye döner; telefonda menüyü de
 *  kapatır. */
function PortalBrand({ onHome }: { onHome: () => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      href="/"
      className="brand"
      aria-label={t("ws.homeLink")}
      onClick={(e) => {
        e.preventDefault();
        onHome();
        setOpenMobile(false);
      }}
    >
      <BookOpen />
      <span>
        derslik<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}

/** Öğrenci ve veli görünümü. Öğretmen çalışma alanıyla aynı kabuk: solda
 *  menü, üstte yol ve bildirimler, altta sayfa başlığı ve içerik. Henüz bir
 *  öğretmene bağlı olmayan öğrenci (access yok) yalnızca "Öğretmen bul" ve
 *  "İsteklerim" sayfalarını görür. */
export function Portal({
  access,
  displayName,
  switcher,
  onSignout,
  focus,
  onNotice,
  onOpenWorkspace,
  onStartTeaching,
  teacherAccount = false,
  initialSearch,
}: {
  access: Access | null;
  displayName: string;
  switcher?: React.ReactNode;
  onSignout?: () => void;
  /** Bildirimden açılacak yer ve bildirime tıklanınca çağrılan işlev. */
  focus?: NoticeFocus | null;
  onNotice?: (target: NoticeTarget) => void;
  /** Kabul edilen isteğin öğretmenine (o öğretmenin derslerine) geçer. */
  onOpenWorkspace?: (workspaceId: string) => void;
  /** Öğretmene bağlı olmayan hesap kendi çalışma alanını açabilir. */
  onStartTeaching?: () => void;
  /** Hesabın kendi öğretmen çalışma alanı var: öğretmen istek gönderemez,
   *  "Öğretmen bul" ve "İsteklerim" gösterilmez. */
  teacherAccount?: boolean;
  /** Sayfanın sorgu dizesi: sunucu ve istemci ilk çizimde aynı sekmeyi seçer. */
  initialSearch?: string;
}) {
  const role: PortalRole = access?.role === "GUARDIAN" ? "GUARDIAN" : "STUDENT";
  // Veli hesabı adına ders isteği gönderilmez; vitrin yalnızca öğrencide.
  // Öğretmen hesabı da istek gönderemez (bir e-posta ya öğretmen ya öğrenci).
  const canDiscover = role === "STUDENT" && !teacherAccount;
  const fallback: PortalPage = access ? "lessons" : "teachers";
  const [tab, setTab] = useState<PortalPage>(() =>
      pageFromUrl(fallback, initialSearch),
    ),
    [teacher, setTeacher] = useState<string | null>(() =>
      teacherFromUrl(initialSearch),
    ),
    [chatThread, setChatThread] = useState<string | null>(() =>
      threadFromUrl(initialSearch),
    ),
    // Mesaj bildirimine dokunulan an: açık yazışma ve liste yenilenir.
    [chatFocus, setChatFocus] = useState(0),
    [tabs, setTabs] = useState<LearningTabInfo[]>([]),
    [signoutOpen, setSignoutOpen] = useState(false),
    [requestFocus, setRequestFocus] = useState<string | null>(null),
    // Karttaki "İstek gönder": profil istek penceresi açık açılır.
    [openRequest, setOpenRequest] = useState(false);
  useEffect(() => {
    const sync = () => {
      setTab(pageFromUrl(fallback));
      setTeacher(teacherFromUrl());
      setChatThread(threadFromUrl());
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [fallback]);
  // Adresteki sayfaya izin yoksa (ör. ödeme bilgisi gizli) ilk izinli sayfa açılır.
  const current: PortalPage = isDiscover(tab)
    ? canDiscover
      ? tab
      : fallback
    : !access
      ? "teachers"
      : tabs.length && !tabs.some((x) => x.id === tab)
        ? tabs[0].id
        : tab;
  const heading = isDiscover(current)
    ? { label: discover[current].label, subtitle: discover[current].subtitle }
    : {
        label: (pages[current] ?? pages.lessons!).label,
        subtitle: (pages[current] ?? pages.lessons!).subtitle[role],
      };
  function navigate(
    next: PortalPage,
    teacherId: string | null = null,
    request = false,
  ) {
    setTab(next);
    setTeacher(teacherId);
    setOpenRequest(request);
    setPanelFocus(undefined);
    setRequestFocus(null);
    setChatThread(null);
    setChatFocus(0);
    window.history.pushState(
      {},
      "",
      "/?view=" + next + (teacherId ? "&teacher=" + teacherId : ""),
    );
  }
  /** Mesajlar sayfasında yazışma açar (null: listeye döner). */
  function openThread(id: string | null) {
    const fromList = !!id && current === "messages" && !chatThread;
    setTab("messages");
    setTeacher(null);
    setChatThread(id);
    setChatFocus(0);
    setPanelFocus(undefined);
    setRequestFocus(null);
    window.history.pushState(
      fromList ? CHAT_FROM_LIST : {},
      "",
      "/" + chatSearch(id),
    );
  }
  // Bildirim bu öğrenciye aitse ilgili sekme açılır ve kayıt vurgulanır.
  const [appliedFocus, setAppliedFocus] = useState(0),
    [panelFocus, setPanelFocus] = useState<{ id: string | null; at: number }>();
  if (focus && focus.at !== appliedFocus) {
    if (focus.section === "myRequests") {
      setAppliedFocus(focus.at);
      setTab("requests");
      setTeacher(null);
      setRequestFocus(focus.itemId);
    } else if (
      focus.section === "messages" &&
      access &&
      focus.workspaceId === access.id &&
      focus.studentId === access.studentId
    ) {
      // Mesaj bildirimi: Mesajlar sayfasında o yazışma açılır.
      setAppliedFocus(focus.at);
      setTab("messages");
      setTeacher(null);
      setChatThread(focus.itemId);
      setChatFocus(focus.at);
      setPanelFocus(undefined);
      setRequestFocus(null);
    } else if (
      focus.section !== "requests" &&
      focus.section !== "messages" &&
      access &&
      focus.workspaceId === access.id &&
      focus.studentId === access.studentId
    ) {
      setAppliedFocus(focus.at);
      setTab(focus.section);
      setPanelFocus({ id: focus.itemId, at: focus.at });
    }
  }
  // Adres çubuğu render sırasında değişemez (Next yönlendiricisini günceller).
  const focusedTab = panelFocus
    ? focus?.section
    : requestFocus
      ? "requests"
      : chatFocus
        ? "messages"
        : undefined;
  const focusedUrl =
    focusedTab === "messages"
      ? chatSearch(chatThread)
      : focusedTab && "?view=" + focusedTab;
  useEffect(() => {
    if (focusedUrl) window.history.pushState({}, "", "/" + focusedUrl);
  }, [focusedUrl, appliedFocus]);
  // Kenar çubuğundaki okunmamış sayacı ve Mesajlar sayfası aynı listeyi
  // kullanır. Mesaj rotaları "lessons" iznini ister; izin yoksa istek gitmez.
  const chat = useMessageThreads(
    access?.studentId && tabs.some((x) => x.id === "messages")
      ? `/portal/${access.id}/${access.studentId}/messages`
      : null,
  );
  // Sol menüdeki sekmeleri LearningPanel bildirir; ama öğrenci doğrudan
  // "Öğretmen bul" / "İsteklerim" sayfasında açarsa panel hiç yüklenmez ve
  // menü iskelet olarak kalırdı. O durumda izinler burada ayrıca alınır.
  const needsTabs = !!access && isDiscover(current) && !tabs.length;
  useEffect(() => {
    if (!needsTabs || !access?.studentId) return;
    let live = true;
    backend<PortalData>(`/portal/${access.id}/${access.studentId}`)
      .then((data) => {
        if (live) setTabs(learningTabs(data.permissions || []));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [needsTabs, access?.id, access?.studentId]);
  let content: React.ReactNode;
  if (current === "teachers")
    content = teacher ? (
      <TeacherProfileView
        key={teacher}
        id={teacher}
        signedIn
        onBack={() => navigate("teachers")}
        onOpenLessons={onOpenWorkspace}
        openRequest={openRequest}
      />
    ) : (
      <TeacherDirectory
        signedIn
        onOpen={(id, request) => navigate("teachers", id, request)}
      />
    );
  else if (current === "requests")
    content = (
      <MyRequests
        focusId={requestFocus}
        focusAt={requestFocus ? appliedFocus : undefined}
        onBrowse={() => navigate("teachers")}
        onOpenTeacher={(id) => navigate("teachers", id)}
        onOpenLessons={onOpenWorkspace}
      />
    );
  else if (access)
    content = (
      <LearningPanel
        workspaceId={access.id}
        studentId={access.studentId!}
        role={role}
        view={current}
        onTabs={setTabs}
        focus={panelFocus}
        chat={{
          store: chat,
          thread: chatThread,
          onOpen: openThread,
          refreshAt: chatFocus,
        }}
      />
    );
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarHeader className="p-7">
          <PortalBrand
            onHome={() =>
              navigate(access ? (tabs[0]?.id ?? "lessons") : "teachers")
            }
          />
          <p className="sidebar-kicker">
            {upper(
              role === "STUDENT"
                ? t("portal.studentArea")
                : t("portal.guardianArea"),
            )}
          </p>
        </SidebarHeader>
        <SidebarContent className="portal-nav px-4 pt-6">
          {access && (
            <>
              <p className="nav-label" title={access.name}>
                {upper(access.name)}
              </p>
              <PortalNavigation
                tabs={tabs}
                current={current}
                onNavigate={navigate}
                unread={chat.unread}
              />
            </>
          )}
          {canDiscover && (
            <>
              <p className={"nav-label" + (access ? " mt-6" : "")}>
                {upper(t("dir.discover"))}
              </p>
              <DiscoverNavigation current={current} onNavigate={navigate} />
            </>
          )}
          {access && (
            <div className="sidebar-note">
              <span className="note-flower">✳</span>
              {role === "STUDENT" ? (
                <>
                  <p>
                    {t("portal.studentNote1")}
                    <br />
                    <strong>{t("portal.studentNote2")}</strong>
                  </p>
                  <span>{t("portal.studentNote3")}</span>
                </>
              ) : (
                <>
                  <p>
                    {t("portal.guardianNote1")}
                    <br />
                    <strong>{t("portal.guardianNote2")}</strong>
                  </p>
                  <span>{t("portal.guardianNote3")}</span>
                </>
              )}
            </div>
          )}
        </SidebarContent>
        <SidebarAccount
          displayName={displayName}
          role={
            role === "STUDENT"
              ? t("portal.studentAccount")
              : t("portal.guardianAccount")
          }
          switcher={switcher}
          onSignout={onSignout && (() => setSignoutOpen(true))}
        >
          {onStartTeaching && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="signout justify-start"
              onClick={onStartTeaching}
            >
              <BookOpen /> {t("dir.startTeaching")}
            </Button>
          )}
        </SidebarAccount>
      </Sidebar>
      <main className="workspace">
        <Topbar
          root={access?.studentName ?? t("dir.studentArea")}
          current={t(heading.label)}
        >
          <AccountExtras onOpen={onNotice} />
        </Topbar>
        <div className="page-body" id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {upper("Derslik") + " / " + upper(t(heading.label))}
              </p>
              <h1>{t(heading.label)}</h1>
              <p>{t(heading.subtitle)}</p>
            </div>
          </div>
          {content}
        </div>
      </main>
      <AlertDialog open={signoutOpen} onOpenChange={setSignoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ws.signOutTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("portal.signOutBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSignoutOpen(false);
                onSignout?.();
              }}
            >
              {t("common.signOut")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
