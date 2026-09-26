"use client";
import { ChevronRight, LogOut } from "lucide-react";
import { t, upper } from "@derslik/contracts";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { LanguageSelect } from "@/components/i18n/language-select";
import { Button } from "@/components/ui/button";
import { SidebarFooter, SidebarTrigger } from "@/components/ui/sidebar";

// Öğretmen (workspace.tsx) ve öğrenci/veli (portal.tsx) kabuklarının ortak
// parçaları: kenar çubuğunun alt kısmı ve üst çubuk.

/** Tema, dil, görünüm değiştirici, hesap kartı ve çıkış. `children` çıkıştan
 *  önce gelen ek düğmeler içindir. */
export function SidebarAccount({
  displayName,
  role,
  switcher,
  onSignout,
  children,
}: {
  displayName: string;
  role: string;
  switcher?: React.ReactNode;
  onSignout?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <SidebarFooter className="p-6 gap-4">
      <ThemeToggle />
      <LanguageSelect />
      {switcher}
      <div className="profile">
        <span className="avatar">{upper(displayName.charAt(0))}</span>
        <div>
          <strong title={displayName}>{displayName}</strong>
          <small>{role}</small>
        </div>
      </div>
      {children}
      {onSignout && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="signout justify-start"
          onClick={onSignout}
        >
          <LogOut /> {t("common.signOut")}
        </Button>
      )}
    </SidebarFooter>
  );
}

/** İçeriğe atlama bağlantısı ve kırıntılı üst çubuk; `children` sağdaki
 *  düğmelerdir. */
export function Topbar({
  root,
  current,
  children,
}: {
  root: string;
  current: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <a href="#main-content" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <header className="topbar">
        <div className="topbar-crumbs">
          <SidebarTrigger aria-label={t("common.toggleMenu")} />
          <span className="crumb-root">{root}</span>
          <ChevronRight size={13} className="crumb-sep" />
          <span className="crumb-current">{current}</span>
        </div>
        <div className="topbar-actions">{children}</div>
      </header>
    </>
  );
}
