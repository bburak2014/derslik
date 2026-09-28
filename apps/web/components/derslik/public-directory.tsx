"use client";
import { useEffect, useState } from "react";
import { BookOpen, LogIn } from "lucide-react";
import { t, upper } from "@derslik/contracts";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { LanguageSelect } from "@/components/i18n/language-select";
import { Button } from "@/components/ui/button";
import { openStudentWorkspace } from "@/lib/student-mode";
import { TeacherDirectory, TeacherProfileView } from "./directory";

/** Giriş yapmadan gezilen vitrin: /teachers ve /teachers/[id]. Oturum varsa
 *  profil sayfası istek düğmesini doğrudan gösterir. */
export function PublicDirectory({
  teacherId,
  hasSession = true,
}: {
  teacherId?: string;
  /** Sunucu oturum çerezi görmediyse ziyaretçi anonimdir; /api/session
   *  sorulmaz (konsolda boşuna 401 kalmaz, profil hemen çizilir). */
  hasSession?: boolean;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(
    hasSession ? null : false,
  );
  useEffect(() => {
    if (!hasSession) return;
    let alive = true;
    fetch("/api/session", { cache: "no-store" })
      .then((r) => alive && setSignedIn(r.ok))
      .catch(() => alive && setSignedIn(false));
    return () => {
      alive = false;
    };
  }, [hasSession]);
  return (
    <div className="public-shell">
      <header className="public-header">
        <a href="/teachers" className="brand" aria-label={t("dir.back")}>
          <BookOpen />
          <span>
            derslik<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="flex items-center gap-3">
          <LanguageSelect className="hidden w-40 sm:flex" />
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Button asChild size="sm" variant="secondary">
            <a href="/">
              <LogIn /> {signedIn ? t("ws.homeLink") : t("dir.signIn")}
            </a>
          </Button>
        </div>
      </header>
      <main className="public-body">
        {!teacherId && (
          <div className="page-heading">
            <div>
              <p className="eyebrow">{upper(t("dir.publicTagline"))}</p>
              <h1>{t("dir.findTitle")}</h1>
              <p>{t("dir.findSubtitle")}</p>
            </div>
          </div>
        )}
        {teacherId ? (
          signedIn === null ? null : (
            <TeacherProfileView
              id={teacherId}
              signedIn={signedIn}
              backHref="/teachers"
              // Davetle bağlanan öğrencinin "İsteklerim" sayfası boş kalır;
              // düğme o öğretmendeki dersleri açar.
              onOpenLessons={(id) =>
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- tam sayfa yüklemesi bilerek: oturum bağlamı ve uygulama kabuğu baştan kurulur.
                void openStudentWorkspace(id).catch(() => location.assign("/"))
              }
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- tam sayfa yüklemesi bilerek: oturum bağlamı ve uygulama kabuğu baştan kurulur.
              onEditProfile={() => location.assign("/?view=showcase")}
              openRequest={
                new URLSearchParams(location.search).get("request") === "1"
              }
            />
          )
        ) : (
          <TeacherDirectory
            signedIn={!!signedIn}
            hrefFor={(id, request) =>
              `/teachers/${id}` + (request ? "?request=1" : "")
            }
          />
        )}
      </main>
    </div>
  );
}
