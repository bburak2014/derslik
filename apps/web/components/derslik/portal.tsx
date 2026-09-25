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
} from "./learning-panel";

type PortalRole = "STUDENT" | "GUARDIAN";

/** Menü etiketi ve sayfa başlığı. Hangi sayfaların görüneceğini öğretmenin
 *  verdiği izinler belirler; panel onları `onTabs` ile bildirir. */
const pages: Partial<
  Record<
    LearningTab,
    {
      label: string;
      icon: LucideIcon;
      subtitle: Record<PortalRole, string>;
    }
  >
> = {
  lessons: {
    label: "Dersler",
    icon: CalendarDays,
    subtitle: {
      STUDENT: "Planlanan ve tamamlanan derslerinizi buradan takip edin.",
      GUARDIAN: "Planlanan ve tamamlanan dersleri buradan takip edin.",
    },
  },
  assignments: {
    label: "Ödevler",
    icon: ClipboardList,
    subtitle: {
      STUDENT:
        "Ödevlerinizi teslim edin, öğretmeninizin geri bildirimlerini okuyun.",
      GUARDIAN: "Verilen ödevleri, teslimleri ve geri bildirimleri görün.",
    },
  },
  files: {
    label: "PDF ve dosyalar",
    icon: FileText,
    subtitle: {
      STUDENT: "Öğretmeninizin paylaştığı çalışma kağıtları ve materyaller.",
      GUARDIAN: "Öğretmenin paylaştığı çalışma kağıtları ve materyaller.",
    },
  },
  videos: {
    label: "Ders videoları",
    icon: Video,
    subtitle: {
      STUDENT: "Ders kayıtlarını dilediğiniz zaman yeniden izleyin.",
      GUARDIAN: "Ders kayıtlarını dilediğiniz zaman izleyin.",
    },
  },
  notes: {
    label: "Paylaşımlar",
    icon: NotebookPen,
    subtitle: {
      STUDENT: "Öğretmeninizin notları ve haftalık gelişim özetleri.",
      GUARDIAN: "Öğretmenin notları ve haftalık gelişim özetleri.",
    },
  },
  payments: {
    label: "Paket ve bakiye",
    icon: Wallet,
    subtitle: {
      STUDENT: "Ders haklarınız, açık bakiye ve kayıtlı ödemeler.",
      GUARDIAN: "Ders hakları, açık bakiye ve kayıtlı ödemeler.",
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
              <span>{page.label}</span>
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
      aria-label="Derslik ana sayfa"
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
}: {
  access: Access;
  displayName: string;
  switcher?: React.ReactNode;
  onSignout?: () => void;
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
    tabs.length && !tabs.some((t) => t.id === tab) ? tabs[0].id : tab;
  const page = pages[current] ?? pages.lessons!;
  function navigate(next: LearningTab) {
    setTab(next);
    window.history.pushState({}, "", "/?view=" + next);
  }
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarHeader className="p-7">
          <PortalBrand onHome={() => navigate(tabs[0]?.id ?? "lessons")} />
          <p className="sidebar-kicker">
            {role === "STUDENT" ? "ÖĞRENCİ ALANI" : "VELİ TAKİP ALANI"}
          </p>
        </SidebarHeader>
        <SidebarContent className="portal-nav px-4 pt-6">
          <p className="nav-label" title={access.name}>
            {access.name.toLocaleUpperCase("tr")}
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
                  Her ders,
                  <br />
                  <strong>yeni bir adım.</strong>
                </p>
                <span>
                  Ödevleriniz, notlarınız ve
                  <br />
                  ders kayıtlarınız burada.
                </span>
              </>
            ) : (
              <>
                <p>
                  Gelişimi
                  <br />
                  <strong>birlikte izleyin.</strong>
                </p>
                <span>
                  Dersler, ödevler ve öğretmen
                  <br />
                  notları tek yerde.
                </span>
              </>
            )}
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
              <small>
                {role === "STUDENT" ? "Öğrenci hesabı" : "Veli hesabı"}
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
              <LogOut /> Çıkış yap
            </Button>
          )}
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <a href="#main-content" className="skip-link">
          İçeriğe geç
        </a>
        <header className="topbar">
          <div className="topbar-crumbs">
            <SidebarTrigger aria-label="Menüyü aç veya kapat" />
            <span className="crumb-root">{access.studentName}</span>
            <ChevronRight size={13} className="crumb-sep" />
            <span className="crumb-current">{page.label}</span>
          </div>
          <div className="topbar-actions">
            <AccountExtras />
          </div>
        </header>
        <div className="page-body" id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {"DERSLİK / " + page.label.toLocaleUpperCase("tr")}
              </p>
              <h1>{page.label}</h1>
              <p>{page.subtitle[role]}</p>
            </div>
          </div>
          <LearningPanel
            workspaceId={access.id}
            studentId={access.studentId!}
            role={role}
            view={current}
            onTabs={setTabs}
          />
        </div>
      </main>
      <AlertDialog open={signoutOpen} onOpenChange={setSignoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hesabınızdan çıkılsın mı?</AlertDialogTitle>
            <AlertDialogDescription>
              Oturumunuz kapanacak ve tekrar giriş yapmanız gerekecek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSignoutOpen(false);
                onSignout?.();
              }}
            >
              Çıkış yap
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
