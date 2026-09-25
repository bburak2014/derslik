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
import { FormError, FormSuccess } from "@/components/derslik/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
    webRequest("/api/auth/providers")
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
            <span className="ink-mark">daha çok zaman.</span>
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
        <div className="grid gap-6">
          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="grid gap-3">
                <div
                  className="grid grid-cols-3 gap-2"
                  aria-label="Diğer giriş seçenekleri"
                >
                  {social.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="outline"
                      className="w-full"
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
                          const r = await webRequest("/api/auth/oauth", {
                            provider: p.id,
                            next: location.pathname,
                          });
                          location.assign(r.url);
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === p.id ? <Spinner /> : p.icon}
                      <span>{busy === p.id ? "Açılıyor…" : p.name}</span>
                    </Button>
                  ))}
                </div>
                {providersLoaded && !enabled.length && (
                  <p className="text-muted-foreground text-xs">
                    {providerError
                      ? "Diğer giriş seçeneklerine ulaşılamadı. E-posta ile devam edebilirsiniz."
                      : "Diğer giriş seçenekleri henüz kullanıma açılmadı. E-posta ile devam edin."}
                  </p>
                )}
              </div>
              <div className="text-muted-foreground flex items-center gap-3 text-xs">
                <Separator className="flex-1" />
                <span>veya e-posta ile</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy("email");
              setError("");
              setMessage("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await webRequest(`/api/auth/${mode}`, {
                  ...(mode !== "password"
                    ? { email: String(f.get("email")).trim() }
                    : {}),
                  ...(mode !== "recover"
                    ? { password: f.get("password") }
                    : {}),
                });
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
              <div className="grid gap-2">
                <Label htmlFor="auth-email">E-posta adresi</Label>
                <Input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="ornek@eposta.com"
                  required
                  maxLength={200}
                  disabled={!!busy}
                />
              </div>
            )}
            {mode !== "recover" && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="auth-password">Şifre</Label>
                  {mode === "signin" && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={!!busy}
                      onClick={() => changeMode("recover")}
                    >
                      Şifremi unuttum
                    </Button>
                  )}
                </div>
                <InputGroup data-disabled={!!busy || undefined}>
                  <InputGroupInput
                    id="auth-password"
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    placeholder={
                      mode === "signin"
                        ? "Şifrenizi girin"
                        : "En az 10 karakter"
                    }
                    required
                    minLength={mode === "signin" ? 1 : 10}
                    maxLength={128}
                    disabled={!!busy}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            )}
            {error && <FormError>{error}</FormError>}
            {message && <FormSuccess>{message}</FormSuccess>}
            <Button type="submit" className="w-full" disabled={!!busy}>
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
              {busy !== "email" && <ArrowRight />}
            </Button>
          </form>
          {!reset && (
            <p className="text-muted-foreground text-center text-sm">
              {mode === "signin"
                ? "Henüz hesabınız yok mu?"
                : "Zaten hesabınız var mı?"}{" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                disabled={!!busy}
                onClick={() =>
                  changeMode(mode === "signin" ? "signup" : "signin")
                }
              >
                {mode === "signin" ? "Hesap oluştur" : "Giriş yap"}
              </Button>
            </p>
          )}
        </div>
        <p className="auth-footnote">
          <ShieldCheck size={16} />
          Hesabınız web ve mobilde birlikte çalışır.
        </p>
      </section>
    </main>
  );
}
