"use client";
import { useEffect, useState } from "react";
import { BookOpen, LogIn } from "lucide-react";
import { t, upper } from "@derslik/contracts";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { LanguageSelect } from "@/components/i18n/language-select";
import { Button } from "@/components/ui/button";
import { TeacherDirectory, TeacherProfileView } from "./directory";

/** Giriş yapmadan gezilen vitrin: /teachers ve /teachers/[id]. Oturum varsa
 *  profil sayfası istek düğmesini doğrudan gösterir. */
export function PublicDirectory({ teacherId }: { teacherId?: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/session", { cache: "no-store" })
      .then((r) => alive && setSignedIn(r.ok))
      .catch(() => alive && setSignedIn(false));
    return () => {
      alive = false;
    };
  }, []);
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
              onOpenLessons={() => location.assign("/?view=requests")}
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
