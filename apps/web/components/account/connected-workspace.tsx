"use client";
import { useCallback, useEffect, useState } from "react";
import type { Access } from "@derslik/api-client";
import { ApiError } from "@derslik/api-client";
import Workspace from "@/components/derslik/workspace";
import { AuthForm } from "./auth-form";
import { backend, webRequest } from "@/lib/client";
import { Portal } from "@/components/derslik/learning-panel";
import { PageLoader } from "@/components/derslik/loading";
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
        <h1>Bağlantı kurulamadı.</h1>
        <p role="alert">{error}</p>
        <button className="primary-button" onClick={() => void reload()}>
          Yeniden dene
        </button>
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
        <h1>Derslik davetiniz</h1>
        <p>{session.user.email} hesabınızla daveti kabul edebilirsiniz.</p>
        {error && <p role="alert">{error}</p>}
        <button
          className="primary-button"
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
          Daveti kabul et
        </button>
        <button onClick={() => void signout()}>Başka hesapla giriş yap</button>
      </main>
    );
  if (!session.active)
    return (
      <main className="connection-state">
        <p className="eyebrow">DERSLİĞİNİZİ HAZIRLAYIN.</p>
        <h1>İlk adımı atalım.</h1>
        <p>
          Öğretmenseniz çalışma alanı oluşturun. Öğrenci veya veliyseniz
          öğretmeninizden gelen davet bağlantısını açın.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const name = String(new FormData(e.currentTarget).get("name"));
              await backend("/workspaces", { name });
              await reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Çalışma alanı adı
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              placeholder="Örn. Matematik Atölyem"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>
            Öğretmen çalışma alanı oluştur
          </button>
        </form>
        <button onClick={() => void signout()}>Çıkış yap</button>
      </main>
    );
  const active = session.active,
    key = (a: Access) => `${a.id}:${a.role}:${a.studentId || ""}`;
  const switcher =
    session.list.length > 1 || error ? (
      <div className="workspace-switcher">
        {session.list.length > 1 && (
          <label>
            Çalışma alanı
            <select
              aria-label="Çalışma alanını değiştir"
              value={key(active)}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await webRequest("/api/session", { key: e.target.value });
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {session.list.map((a) => (
                <option key={key(a)} value={key(a)}>
                  {a.name}
                  {a.studentName ? ` · ${a.studentName}` : ""} ·{" "}
                  {a.role === "OWNER"
                    ? "Öğretmen"
                    : a.role === "STUDENT"
                      ? "Öğrenci"
                      : "Veli"}
                </option>
              ))}
            </select>
          </label>
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
