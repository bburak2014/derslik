"use client";
import { useCallback, useEffect, useState } from "react";
import type { Access } from "@derslik/api-client";
import { t, upper, type NoticeTarget } from "@derslik/contracts";
import type { NoticeFocus } from "@/components/derslik/learning-panel";
import { ApiError } from "@derslik/api-client";
import Workspace from "@/components/derslik/workspace";
import { AuthForm } from "./auth-form";
import { backend, webRequest } from "@/lib/client";
import { Portal } from "@/components/derslik/portal";
import { PageLoader, Spinner } from "@/components/derslik/loading";
import { FormError } from "@/components/derslik/feedback";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const MODE_KEY = "derslik-mode";
/** Öğretmene bağlı olmayan hesap "öğretmen arıyorum" dediyse bu tarayıcıda
 *  hatırlanır; vitrin bağlantısıyla (?teacher=) gelen de öğrenci olarak açılır. */
function initialStudentMode() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(location.search);
  if (params.get("teacher")) return true;
  if (["teachers", "requests"].includes(params.get("view") || "")) return true;
  try {
    return localStorage.getItem(MODE_KEY) === "student";
  } catch {
    return false;
  }
}
function rememberMode(student: boolean) {
  try {
    if (student) localStorage.setItem(MODE_KEY, "student");
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* Depolama kapalıysa seçim yalnızca bu sayfada geçerli. */
  }
}

export function ConnectedWorkspace({ inviteToken }: { inviteToken?: string }) {
  const [session, setSession] = useState<{
      user: { email: string };
      list: Access[];
      active: Access | null;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [unauthorized, setUnauthorized] = useState(false),
    [busy, setBusy] = useState(false),
    // Bildirimden açılacak yer; görünüm değişse de yeni görünüm bunu alır.
    [focus, setFocus] = useState<NoticeFocus | null>(null),
    [studentMode, setStudentMode] = useState(initialStudentMode),
    [creating, setCreating] = useState(false);
  const reload = useCallback(async () => {
    try {
      setSession(await webRequest("/api/session"));
      setUnauthorized(false);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUnauthorized(true);
        setSession(null);
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void reload();
  }, [reload]);
  if (loading)
    return (
      <main className="connection-state">
        <PageLoader />
      </main>
    );
  if (unauthorized) return <AuthForm onSuccess={() => void reload()} />;
  if (error && !session)
    return (
      <main className="connection-state">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">{t("conn.failedTitle")}</CardTitle>
            <CardDescription>{t("conn.failedText")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormError>{error}</FormError>
            <Button type="button" onClick={() => void reload()}>
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  if (!session) return null;
  async function signout() {
    try {
      await webRequest("/api/auth/signout", {});
      setSession(null);
      setUnauthorized(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (inviteToken)
    return (
      <main className="connection-state">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">{t("conn.inviteTitle")}</CardTitle>
            <CardDescription>
              {t("conn.inviteText", { email: session.user.email })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {error && <FormError>{error}</FormError>}
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await backend<{
                    data: {
                      workspaceId: string;
                      role: string;
                      studentId: string;
                    };
                  }>("/invitations/accept", { token: inviteToken });
                  // Open the view that was just joined. Accounts that also
                  // teach list their own workspace first, so without this they
                  // landed back in the teacher view. Same key as the switcher.
                  await webRequest("/api/session", {
                    key: `${r.data.workspaceId}:${r.data.role}:${r.data.studentId}`,
                  }).catch(() => undefined);
                  location.assign("/");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />}
              {t("conn.acceptInvite")}
            </Button>
          </CardContent>
          <CardFooter className="justify-center border-t">
            <Button type="button" variant="link" onClick={() => void signout()}>
              {t("conn.otherAccount")}
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  const key = (a: Access) => `${a.id}:${a.role}:${a.studentId || ""}`;
  // Kabul edilen isteğin öğretmenine geçer: erişim listesi yenilenir, o
  // öğretmendeki öğrenci görünümü seçilir.
  async function openWorkspace(workspaceId: string) {
    setBusy(true);
    try {
      const fresh = await webRequest<{ list: Access[] }>("/api/session");
      const next = fresh.list.find(
        (a) => a.id === workspaceId && a.role === "STUDENT",
      );
      if (!next) throw new Error(t("conn.noticeNoAccess"));
      await webRequest("/api/session", { key: key(next) });
      rememberMode(false);
      location.assign("/?view=lessons");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Bildirim başka bir çalışma alanına (ör. velinin ikinci çocuğu) aitse önce
  // o görünüme geçilir, sonra ilgili sayfa açılır. Ders isteği bildirimleri:
  // öğretmene gelen istek öğretmen görünümünde, öğrencinin isteğine gelen
  // yanıt öğrenci görünümünde (kabul edildiyse o öğretmende) açılır.
  async function openNotice(target: NoticeTarget) {
    const current = session!.active;
    let list = session!.list;
    const same = (a: Access | null, b: Access | null) =>
      !!a && !!b && key(a) === key(b);
    let next: Access | null | undefined;
    if (target.section === "myRequests") {
      const accepted = (a: Access) =>
        a.id === target.workspaceId &&
        a.role === "STUDENT" &&
        a.studentId === target.studentId;
      if (target.studentId && !list.some(accepted))
        list = (await webRequest<{ list: Access[] }>("/api/session")).list;
      next =
        list.find(accepted) ||
        (current && current.role !== "OWNER" ? current : null) ||
        list.find((a) => a.role === "STUDENT");
      if (!next) {
        if (current) {
          setError(t("conn.noticeNoAccess"));
          return;
        }
        setStudentMode(true);
        setFocus({ ...target, at: Date.now() });
        return;
      }
    } else {
      const fits = (a: Access) =>
        a.id === target.workspaceId &&
        (a.role === "OWNER" ||
          (target.section !== "requests" && a.studentId === target.studentId));
      next =
        current && fits(current)
          ? current
          : list.find((a) => fits(a) && a.role === "OWNER") || list.find(fits);
    }
    if (!next) {
      setError(t("conn.noticeNoAccess"));
      return;
    }
    if (!same(next, current)) {
      setBusy(true);
      try {
        await webRequest("/api/session", { key: key(next) });
        await reload();
      } catch (e) {
        setError((e as Error).message);
        return;
      } finally {
        setBusy(false);
      }
    }
    setFocus({ ...target, at: Date.now() });
  }
  if (!session.active && studentMode)
    return (
      <Portal
        access={null}
        displayName={session.user.email.split("@")[0]}
        onSignout={() => void signout()}
        focus={focus}
        onNotice={(target) => void openNotice(target)}
        onOpenWorkspace={(id) => void openWorkspace(id)}
        onStartTeaching={() => {
          rememberMode(false);
          setStudentMode(false);
          setCreating(true);
          window.history.pushState({}, "", "/");
        }}
      />
    );
  if (!session.active && !creating)
    return (
      <main className="connection-state">
        <Card className="w-full max-w-md">
          <CardHeader>
            <p className="eyebrow">{upper(t("conn.setupEyebrow"))}</p>
            <CardTitle className="text-2xl">{t("dir.welcomeTitle")}</CardTitle>
            <CardDescription>{t("dir.welcomeText")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <button
              type="button"
              className="choice-card"
              onClick={() => setCreating(true)}
            >
              <strong>{t("dir.imTeacher")}</strong>
              <span>{t("dir.imTeacherText")}</span>
            </button>
            <button
              type="button"
              className="choice-card"
              onClick={() => {
                rememberMode(true);
                setStudentMode(true);
              }}
            >
              <strong>{t("dir.imStudent")}</strong>
              <span>{t("dir.imStudentText")}</span>
            </button>
            <p className="text-muted-foreground pt-1 text-sm">
              {t("dir.haveInvite")}
            </p>
          </CardContent>
          <CardFooter className="justify-center border-t">
            <Button type="button" variant="link" onClick={() => void signout()}>
              {t("common.signOut")}
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  if (!session.active)
    return (
      <main className="connection-state">
        <Card className="w-full max-w-md">
          <CardHeader>
            <p className="eyebrow">{upper(t("conn.setupEyebrow"))}</p>
            <CardTitle className="text-2xl">{t("conn.setupTitle")}</CardTitle>
            <CardDescription>{t("conn.setupText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const name = String(
                    new FormData(e.currentTarget).get("name"),
                  );
                  await backend("/workspaces", { name });
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="workspace-name">
                  {t("conn.workspaceName")}
                </Label>
                <Input
                  id="workspace-name"
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder={t("conn.workspacePlaceholder")}
                />
              </div>
              {error && <FormError>{error}</FormError>}
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {t("conn.createWorkspace")}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center border-t">
            <Button type="button" variant="link" onClick={() => void signout()}>
              {t("common.signOut")}
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  const active = session.active;
  const switcher =
    session.list.length > 1 || error ? (
      <div className="workspace-switcher">
        {session.list.length > 1 && (
          <>
            <Label
              htmlFor="workspace-switcher"
              className="text-[10.5px] font-semibold tracking-[0.07em] uppercase opacity-80"
            >
              {t("conn.workspace")}
            </Label>
            <Select
              value={key(active)}
              disabled={busy}
              onValueChange={async (value) => {
                setBusy(true);
                setFocus(null);
                try {
                  await webRequest("/api/session", { key: value });
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <SelectTrigger
                id="workspace-switcher"
                aria-label={t("conn.switchWorkspace")}
                className="w-full min-w-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {session.list.map((a) => (
                  <SelectItem key={key(a)} value={key(a)}>
                    {a.name}
                    {a.studentName ? ` · ${a.studentName}` : ""} ·{" "}
                    {t(`roles.${a.role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {error && (
          <span role="alert" className="switcher-error">
            {error}
          </span>
        )}
      </div>
    ) : null;
  return active.role === "OWNER" ? (
    <Workspace
      key={key(active)}
      displayName={session.user.email.split("@")[0]}
      connected={active}
      onSignout={() => void signout()}
      switcher={switcher}
      focus={focus}
      onNotice={(target) => void openNotice(target)}
    />
  ) : (
    <Portal
      key={key(active)}
      access={active}
      displayName={session.user.email.split("@")[0]}
      switcher={switcher}
      onSignout={() => void signout()}
      focus={focus}
      onNotice={(target) => void openNotice(target)}
    />
  );
}
