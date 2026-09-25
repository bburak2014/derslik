"use client";
import { useCallback, useEffect, useState } from "react";
import type { Access } from "@derslik/api-client";
import { ApiError } from "@derslik/api-client";
import Workspace from "@/components/derslik/workspace";
import { AuthForm } from "./auth-form";
import { backend, webRequest } from "@/lib/client";
import { Portal } from "@/components/derslik/learning-panel";
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
export function ConnectedWorkspace({ inviteToken }: { inviteToken?: string }) {
  const [session, setSession] = useState<{
      user: { email: string };
      list: Access[];
      active: Access | null;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [unauthorized, setUnauthorized] = useState(false),
    [busy, setBusy] = useState(false);
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
            <CardTitle className="text-xl">Bağlantı kurulamadı</CardTitle>
            <CardDescription>
              Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormError>{error}</FormError>
            <Button type="button" onClick={() => void reload()}>
              Yeniden dene
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
            <CardTitle className="text-xl">Derslik davetiniz</CardTitle>
            <CardDescription>
              {session.user.email} hesabınızla daveti kabul edebilirsiniz.
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
                  await backend("/invitations/accept", { token: inviteToken });
                  location.assign("/");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />}
              Daveti kabul et
            </Button>
          </CardContent>
          <CardFooter className="justify-center border-t">
            <Button type="button" variant="link" onClick={() => void signout()}>
              Başka hesapla giriş yap
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
            <p className="eyebrow">DERSLİĞİNİZİ HAZIRLAYIN.</p>
            <CardTitle className="text-2xl">İlk adımı atalım.</CardTitle>
            <CardDescription>
              Öğretmenseniz çalışma alanı oluşturun. Öğrenci veya veliyseniz
              öğretmeninizden gelen davet bağlantısını açın.
            </CardDescription>
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
                <Label htmlFor="workspace-name">Çalışma alanı adı</Label>
                <Input
                  id="workspace-name"
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Örn. Matematik Atölyem"
                />
              </div>
              {error && <FormError>{error}</FormError>}
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                Öğretmen çalışma alanı oluştur
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center border-t">
            <Button type="button" variant="link" onClick={() => void signout()}>
              Çıkış yap
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  const active = session.active,
    key = (a: Access) => `${a.id}:${a.role}:${a.studentId || ""}`;
  const switcher =
    session.list.length > 1 || error ? (
      <div className="workspace-switcher">
        {session.list.length > 1 && (
          <>
            <Label
              htmlFor="workspace-switcher"
              className="text-[10.5px] font-semibold tracking-[0.07em] uppercase opacity-80"
            >
              Çalışma alanı
            </Label>
            <Select
              value={key(active)}
              disabled={busy}
              onValueChange={async (value) => {
                setBusy(true);
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
                aria-label="Çalışma alanını değiştir"
                className="w-full min-w-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {session.list.map((a) => (
                  <SelectItem key={key(a)} value={key(a)}>
                    {a.name}
                    {a.studentName ? ` · ${a.studentName}` : ""} ·{" "}
                    {a.role === "OWNER"
                      ? "Öğretmen"
                      : a.role === "STUDENT"
                        ? "Öğrenci"
                        : "Veli"}
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
    />
  ) : (
    <Portal
      key={key(active)}
      access={active}
      switcher={switcher}
      onSignout={() => void signout()}
    />
  );
}
