"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Access } from "@derslik/api-client";
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  LogOut,
  NotebookPen,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
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
import { LanguageSelect } from "@/components/i18n/language-select";

type PortalRole = "STUDENT" | "GUARDIAN";

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
function pageFromUrl(): LearningTab {
  if (typeof location === "undefined") return "lessons";
  const value = new URLSearchParams(location.search).get("view");
  return isPage(value) ? value : "lessons";
}

function PortalNavigation({
  tabs,
  current,
  onNavigate,
}: {
  tabs: LearningTabInfo[];
  current: LearningTab;
  onNavigate: (tab: LearningTab) => void;
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
 *  menü, üstte yol ve bildirimler, altta sayfa başlığı ve içerik. */
export function Portal({
  access,
  displayName,
  switcher,
  onSignout,
  focus,
  onNotice,
}: {
  access: Access;
  displayName: string;
  switcher?: React.ReactNode;
  onSignout?: () => void;
  /** Bildirimden açılacak yer ve bildirime tıklanınca çağrılan işlev. */
  focus?: NoticeFocus | null;
  onNotice?: (target: NoticeTarget) => void;
}) {
  const role: PortalRole = access.role === "GUARDIAN" ? "GUARDIAN" : "STUDENT";
  const [tab, setTab] = useState<LearningTab>(pageFromUrl),
    [tabs, setTabs] = useState<LearningTabInfo[]>([]),
    [signoutOpen, setSignoutOpen] = useState(false);
  useEffect(() => {
    const sync = () => setTab(pageFromUrl());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  // Adresteki sayfaya izin yoksa (ör. ödeme bilgisi gizli) ilk izinli sayfa açılır.
  const current =
    tabs.length && !tabs.some((x) => x.id === tab) ? tabs[0].id : tab;
  const page = pages[current] ?? pages.lessons!;
  function navigate(next: LearningTab) {
    setTab(next);
    setPanelFocus(undefined);
    window.history.pushState({}, "", "/?view=" + next);
  }
  // Bildirim bu öğrenciye aitse ilgili sekme açılır ve kayıt vurgulanır.
  const [appliedFocus, setAppliedFocus] = useState(0),
    [panelFocus, setPanelFocus] = useState<{ id: string | null; at: number }>();
  if (
    focus &&
    focus.at !== appliedFocus &&
    focus.workspaceId === access.id &&
    focus.studentId === access.studentId
  ) {
    setAppliedFocus(focus.at);
    setTab(focus.section);
    setPanelFocus({ id: focus.itemId, at: focus.at });
  }
  // Adres çubuğu render sırasında değişemez (Next yönlendiricisini günceller).
  const focusedTab = panelFocus ? focus?.section : undefined;
  useEffect(() => {
    if (focusedTab) window.history.pushState({}, "", "/?view=" + focusedTab);
  }, [focusedTab, appliedFocus]);
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarHeader className="p-7">
          <PortalBrand onHome={() => navigate(tabs[0]?.id ?? "lessons")} />
          <p className="sidebar-kicker">
            {upper(
              role === "STUDENT"
                ? t("portal.studentArea")
                : t("portal.guardianArea"),
            )}
          </p>
        </SidebarHeader>
        <SidebarContent className="portal-nav px-4 pt-6">
          <p className="nav-label" title={access.name}>
            {upper(access.name)}
          </p>
          <PortalNavigation
            tabs={tabs}
            current={current}
            onNavigate={navigate}
          />
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
        </SidebarContent>
        <SidebarFooter className="p-6 gap-4">
          <ThemeToggle />
          <LanguageSelect />
          {switcher}
          <div className="profile">
            <span className="avatar">{upper(displayName.charAt(0))}</span>
            <div>
              <strong title={displayName}>{displayName}</strong>
              <small>
                {role === "STUDENT"
                  ? t("portal.studentAccount")
                  : t("portal.guardianAccount")}
              </small>
            </div>
          </div>
          {onSignout && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="signout justify-start"
              onClick={() => setSignoutOpen(true)}
            >
              <LogOut /> {t("common.signOut")}
            </Button>
          )}
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <a href="#main-content" className="skip-link">
          {t("common.skipToContent")}
        </a>
        <header className="topbar">
          <div className="topbar-crumbs">
            <SidebarTrigger aria-label={t("common.toggleMenu")} />
            <span className="crumb-root">{access.studentName}</span>
            <ChevronRight size={13} className="crumb-sep" />
            <span className="crumb-current">{t(page.label)}</span>
          </div>
          <div className="topbar-actions">
            <AccountExtras onOpen={onNotice} />
          </div>
        </header>
        <div className="page-body" id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {upper("Derslik") + " / " + upper(t(page.label))}
              </p>
              <h1>{t(page.label)}</h1>
              <p>{t(page.subtitle[role])}</p>
            </div>
          </div>
          <LearningPanel
            workspaceId={access.id}
            studentId={access.studentId!}
            role={role}
            view={current}
            onTabs={setTabs}
            focus={panelFocus}
          />
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
