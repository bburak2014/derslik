"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Eye,
  EyeOff,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppleIcon, GoogleIcon, MicrosoftIcon } from "./provider-icons";
import { Spinner } from "@/components/derslik/loading";
import { webRequest } from "@/lib/client";
const social = [
  { id: "google", name: "Google", icon: <GoogleIcon /> },
  { id: "apple", name: "Apple", icon: <AppleIcon /> },
  { id: "azure", name: "Microsoft", icon: <MicrosoftIcon /> },
];
export function AuthForm({
  onSuccess,
  reset = false,
}: {
  onSuccess: () => void;
  reset?: boolean;
}) {
  const [mode, setMode] = useState(reset ? "password" : "signin");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [providerError, setProviderError] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    webRequest<{ providers: string[] }>("/api/auth/providers")
      .then((r) => {
        if (alive) {
          setEnabled(r.providers);
          setProvidersLoaded(true);
        }
      })
      .catch(() => {
        if (alive) {
          setProviderError(true);
          setProvidersLoaded(true);
        }
      });
    if (new URLSearchParams(location.search).has("auth_error"))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable in the browser, after hydration.
      setError(
        "Giriş tamamlanamadı. Bağlantı iptal edilmiş veya süresi dolmuş olabilir. Lütfen yeniden deneyin.",
      );
    return () => {
      alive = false;
    };
  }, []);
  const changeMode = (next: string) => {
    setMode(next);
    setError("");
    setMessage("");
    setVisible(false);
  };
  return (
    <main className="auth-page">
      <aside className="auth-story">
        <a href="/" className="brand">
          <BookOpen />
          <span>
            derslik<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="auth-story-content">
          <span className="auth-story-label">ÖZEL DERS ÇALIŞMA ALANINIZ</span>
          <h1>
            Her öğrenciye
            <br />
            daha çok zaman.
          </h1>
          <p>
            Planlamadan gelişim takibine, dersinizle ilgili her şey bir arada.
          </p>
          <div className="auth-highlights">
            <div>
              <CalendarDays />
              <span>
                <strong>Düzenli bir ders planı</strong>
                <small>Takvim, paketler ve ders hakları</small>
              </span>
            </div>
            <div>
              <BookOpen />
              <span>
                <strong>Öğrenme devam etsin</strong>
                <small>Ödevler, PDF kaynakları ve ders videoları</small>
              </span>
            </div>
            <div>
              <Users />
              <span>
                <strong>Birlikte takip edin</strong>
                <small>Öğretmen, öğrenci ve veli erişimi</small>
              </span>
            </div>
          </div>
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={18} />
          Size ve öğrencilerinize özel bir alan.
        </div>
      </aside>
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="eyebrow">DERSLİK HESABI</span>
        <h2 id="auth-title">
          {mode === "signin"
            ? "Tekrar hoş geldiniz"
            : mode === "signup"
              ? "Hesabınızı oluşturun"
              : mode === "recover"
                ? "Şifrenizi mi unuttunuz?"
                : "Yeni şifrenizi belirleyin"}
        </h2>
        <p>
          {mode === "signin"
            ? "Kaldığınız yerden devam etmek için giriş yapın."
            : mode === "signup"
              ? "Öğretmen, öğrenci veya veli olarak başlayın."
              : "Hesabınıza güvenle geri dönmenize yardımcı olalım."}
        </p>
        {(mode === "signin" || mode === "signup") && (
          <>
            <div
              className="social-buttons"
              aria-label="Diğer giriş seçenekleri"
            >
              {social.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="social-button"
                  disabled={!!busy || !enabled.includes(p.id)}
                  title={
                    providersLoaded && !enabled.includes(p.id)
                      ? "Bu giriş seçeneği henüz kullanıma açılmadı."
                      : `${p.name} ile devam et`
                  }
                  onClick={async () => {
                    setError("");
                    setBusy(p.id);
                    try {
                      const r = await webRequest<{ url: string }>(
                        "/api/auth/oauth",
                        {
                          provider: p.id,
                          next: location.pathname,
                        },
                      );
                      location.assign(r.url);
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(null);
                    }
                  }}
                >
                  {p.icon}
                  <span>{busy === p.id ? "Açılıyor…" : p.name}</span>
                  {busy === p.id && <Spinner />}
                </button>
              ))}
            </div>
            {providersLoaded && !enabled.length && (
              <p className="auth-provider-note">
                {providerError
                  ? "Diğer giriş seçeneklerine ulaşılamadı. E-posta ile devam edebilirsiniz."
                  : "Diğer giriş seçenekleri henüz kullanıma açılmadı. E-posta ile devam edin."}
              </p>
            )}
            <div className="auth-divider">
              <span>veya e-posta ile</span>
            </div>
          </>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy("email");
            setError("");
            setMessage("");
            const f = new FormData(e.currentTarget);
            try {
              const r = await webRequest<{ confirmationRequired?: boolean }>(
                `/api/auth/${mode}`,
                {
                  ...(mode !== "password"
                    ? { email: String(f.get("email")).trim() }
                    : {}),
                  ...(mode !== "recover"
                    ? { password: f.get("password") }
                    : {}),
                },
              );
              if (mode === "recover" || r.confirmationRequired)
                setMessage(
                  "E-posta kutunuzu kontrol edin. Gelen bağlantıyla devam edebilirsiniz.",
                );
              else onSuccess();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          {mode !== "password" && (
            <label>
              E-posta adresi
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="ornek@eposta.com"
                required
                maxLength={200}
                disabled={!!busy}
              />
            </label>
          )}
          {mode !== "recover" && (
            <label>
              Şifre
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "signin" ? "Şifrenizi girin" : "En az 10 karakter"
                  }
                  required
                  minLength={mode === "signin" ? 1 : 10}
                  maxLength={128}
                  disabled={!!busy}
                />
                <button
                  type="button"
                  aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </label>
          )}
          {mode === "signin" && (
            <button
              type="button"
              className="forgot-link"
              disabled={!!busy}
              onClick={() => changeMode("recover")}
            >
              Şifremi unuttum
            </button>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="form-success">
              {message}
            </p>
          )}
          <button className="primary-button auth-submit" disabled={!!busy}>
            {busy === "email" && <Spinner />}
            {busy === "email"
              ? "İşleniyor…"
              : mode === "signin"
                ? "Giriş yap"
                : mode === "signup"
                  ? "Hesap oluştur"
                  : mode === "recover"
                    ? "Sıfırlama bağlantısı gönder"
                    : "Yeni şifreyi kaydet"}
            <ArrowRight size={18} />
          </button>
        </form>
        {!reset && (
          <div className="auth-switch">
            <span>
              {mode === "signin"
                ? "Henüz hesabınız yok mu?"
                : "Zaten hesabınız var mı?"}
            </span>
            <button
              disabled={!!busy}
              onClick={() =>
                changeMode(mode === "signin" ? "signup" : "signin")
              }
            >
              {mode === "signin" ? "Hesap oluştur" : "Giriş yap"}
            </button>
          </div>
        )}
        <p className="auth-footnote">
          <ShieldCheck size={16} />
          Hesabınız web ve mobilde birlikte çalışır.
        </p>
      </section>
    </main>
  );
}
