"use client";
import { BrandLockup } from "@/components/brand-mark";
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
import { formText, webRequest } from "@/lib/client";
import { t, upper } from "@derslik/contracts";
import { LanguageSelect } from "@/components/i18n/language-select";
import { Turnstile } from "./turnstile";
const social = [
  { id: "google", name: "Google", icon: <GoogleIcon /> },
  { id: "apple", name: "Apple", icon: <AppleIcon /> },
  { id: "azure", name: "Microsoft", icon: <MicrosoftIcon /> },
];
export function AuthForm({
  onSuccess,
  reset = false,
}: Readonly<{
  onSuccess: () => void;
  reset?: boolean;
}>) {
  const [mode, setMode] = useState(reset ? "password" : "signin");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [providerError, setProviderError] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [captchaKey, setCaptchaKey] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRound, setCaptchaRound] = useState(0);
  useEffect(() => {
    let alive = true;
    webRequest<{ providers: string[]; captchaSiteKey?: string }>(
      "/api/auth/providers",
    )
      .then((r) => {
        if (alive) {
          setEnabled(r.providers);
          setCaptchaKey(r.captchaSiteKey ?? "");
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
      setError(t("auth.callbackFailed"));
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
  // Şifre ekranı zaten açık bir oturumda çalışır; CAPTCHA istemez.
  const captcha = !!captchaKey && mode !== "password";
  return (
    <main className="auth-page">
      <aside className="auth-story">
        <a href="/" className="brand">
          <BrandLockup />
        </a>
        <div className="auth-story-content">
          <span className="auth-story-label">
            {upper(t("auth.storyLabel"))}
          </span>
          <h1>
            {t("auth.storyTitle1")}
            <br />
            <span className="ink-mark">{t("auth.storyTitle2")}</span>
          </h1>
          <p>{t("auth.storyBody")}</p>
          <div className="auth-highlights">
            <div>
              <CalendarDays />
              <span>
                <strong>{t("auth.highlight1Title")}</strong>
                <small>{t("auth.highlight1Text")}</small>
              </span>
            </div>
            <div>
              <BookOpen />
              <span>
                <strong>{t("auth.highlight2Title")}</strong>
                <small>{t("auth.highlight2Text")}</small>
              </span>
            </div>
            <div>
              <Users />
              <span>
                <strong>{t("auth.highlight3Title")}</strong>
                <small>{t("auth.highlight3Text")}</small>
              </span>
            </div>
          </div>
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={18} />
          {t("auth.storyFooter")}
        </div>
      </aside>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="flex items-start justify-between gap-3">
          <span className="eyebrow">{upper(t("auth.account"))}</span>
          <LanguageSelect className="w-auto" />
        </div>
        <h2 id="auth-title">{authTitle(mode)}</h2>
        <p>{authText(mode)}</p>
        <div className="grid gap-6">
          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="grid gap-3">
                <div
                  className="grid grid-cols-3 gap-2"
                  aria-label={t("auth.otherOptions")}
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
                          ? t("auth.providerSoon")
                          : t("auth.continueWith", { name: p.name })
                      }
                      onClick={async () => {
                        setError("");
                        setBusy(p.id);
                        try {
                          const r = await webRequest<{ url: string }>(
                            "/api/auth/oauth",
                            {
                              provider: p.id,
                              // Vitrinden gelen (?teacher=...) girişten sonra
                              // seçtiği öğretmene döner.
                              next: location.pathname + location.search,
                            },
                          );
                          location.assign(r.url);
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === p.id ? <Spinner /> : p.icon}
                      <span>{busy === p.id ? t("auth.opening") : p.name}</span>
                    </Button>
                  ))}
                </div>
                {providersLoaded && !enabled.length && (
                  <p className="text-muted-foreground text-xs">
                    {providerError
                      ? t("auth.providersUnreachable")
                      : t("auth.providersSoon")}
                  </p>
                )}
              </div>
              <div className="text-muted-foreground flex items-center gap-3 text-xs">
                <Separator className="flex-1" />
                <span>{t("auth.orEmail")}</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}
          {/* method="post": sayfa JavaScript'i yüklenmeden gönderilirse
              şifre adres çubuğuna (geçmişe, sunucu kayıtlarına) düşmesin. */}
          <form
            method="post"
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              if (captcha && !captchaToken) {
                setError(t("auth.captchaRequired"));
                return;
              }
              setBusy("email");
              setError("");
              setMessage("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await webRequest<{ confirmationRequired?: boolean }>(
                  `/api/auth/${mode}`,
                  {
                    ...(mode !== "password"
                      ? { email: formText(f, "email").trim() }
                      : {}),
                    ...(mode !== "recover"
                      ? { password: f.get("password") }
                      : {}),
                    // Onay e-postasından sonra davete ya da öğretmene dönülür.
                    ...(mode === "signup"
                      ? { next: location.pathname + location.search }
                      : {}),
                    ...(captcha ? { captchaToken } : {}),
                  },
                );
                if (mode === "recover" || r.confirmationRequired)
                  setMessage(t("auth.checkInbox"));
                else onSuccess();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
                // Belirteç tek kullanımlık; sonraki deneme yenisini alır.
                if (captcha) setCaptchaRound((n) => n + 1);
              }
            }}
          >
            {mode !== "password" && (
              <div className="grid gap-2">
                <Label htmlFor="auth-email">{t("auth.email")}</Label>
                <Input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("auth.emailPlaceholder")}
                  required
                  maxLength={200}
                  disabled={!!busy}
                />
              </div>
            )}
            {mode !== "recover" && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="auth-password">{t("auth.password")}</Label>
                  {mode === "signin" && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={!!busy}
                      onClick={() => changeMode("recover")}
                    >
                      {t("auth.forgot")}
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
                        ? t("auth.passwordPlaceholder")
                        : t("auth.passwordMin")
                    }
                    required
                    minLength={mode === "signin" ? 1 : 10}
                    maxLength={128}
                    disabled={!!busy}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={
                        visible
                          ? t("auth.hidePassword")
                          : t("auth.showPassword")
                      }
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            )}
            {captcha && (
              <Turnstile
                siteKey={captchaKey}
                round={captchaRound}
                onToken={setCaptchaToken}
                onError={() => setError(t("auth.captchaFailed"))}
              />
            )}
            {error && <FormError>{error}</FormError>}
            {message && <FormSuccess>{message}</FormSuccess>}
            <Button type="submit" className="w-full" disabled={!!busy}>
              {busy === "email" && <Spinner />}
              {busy === "email" ? t("auth.processing") : submitLabel(mode)}
              {busy !== "email" && <ArrowRight />}
            </Button>
          </form>
          {!reset && (
            <p className="text-muted-foreground text-center text-sm">
              {mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                disabled={!!busy}
                onClick={() =>
                  changeMode(mode === "signin" ? "signup" : "signin")
                }
              >
                {mode === "signin" ? t("auth.signUp") : t("auth.signIn")}
              </Button>
            </p>
          )}
        </div>
        <p className="auth-footnote">
          <ShieldCheck size={16} />
          {t("auth.footnote")}
        </p>
        <p className="text-muted-foreground text-center text-sm">
          <a
            href="/teachers"
            className="text-primary font-medium hover:underline"
          >
            {t("dir.browse")} →
          </a>
        </p>
      </section>
    </main>
  );
}

function authTitle(mode: string) {
  if (mode === "signin") return t("auth.signinTitle");
  if (mode === "signup") return t("auth.signupTitle");
  if (mode === "recover") return t("auth.recoverTitle");
  return t("auth.passwordTitle");
}

function authText(mode: string) {
  if (mode === "signin") return t("auth.signinText");
  if (mode === "signup") return t("auth.signupText");
  return t("auth.recoverText");
}

function submitLabel(mode: string) {
  if (mode === "signin") return t("auth.signIn");
  if (mode === "signup") return t("auth.signUp");
  if (mode === "recover") return t("auth.sendReset");
  return t("auth.savePassword");
}
