"use client";
import { useEffect, useRef } from "react";
import { getLocale } from "@derslik/contracts";

// Cloudflare Turnstile: e-postayla giriş, kayıt ve şifre sıfırlamada
// Supabase'in istediği CAPTCHA belirteci. Site anahtarı ayarlı değilse bu
// bileşen hiç çizilmez. Betik nonce'lu uygulama betiğinden eklendiği için
// CSP'deki 'strict-dynamic' ona izin verir; widget iframe'i için
// challenges.cloudflare.com frame-src'de.
const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Widget = {
  render: (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => string | undefined;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}

let loading: Promise<Widget> | null = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Widget>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error());
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error());
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Belirteç tek kullanımlıktır: her gönderimden sonra `round` artırılır ve
 * widget yeni belirteç üretir.
 */
export function Turnstile({
  siteKey,
  round,
  onToken,
  onError,
}: Readonly<{
  siteKey: string;
  round: number;
  onToken: (token: string) => void;
  onError: () => void;
}>) {
  const holder = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const handlers = useRef({ onToken, onError });
  useEffect(() => {
    handlers.current = { onToken, onError };
  });
  useEffect(() => {
    let alive = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!alive || !holder.current) return;
        widget.current = turnstile.render(holder.current, {
          sitekey: siteKey,
          language: getLocale(),
          theme: "auto",
          size: "flexible",
          callback: (token: string) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(""),
          "error-callback": () => {
            handlers.current.onToken("");
            handlers.current.onError();
          },
        });
      })
      .catch(() => {
        if (alive) handlers.current.onError();
      });
    return () => {
      alive = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey]);
  useEffect(() => {
    if (round && widget.current) {
      handlers.current.onToken("");
      window.turnstile?.reset(widget.current);
    }
  }, [round]);
  return <div ref={holder} className="min-h-[65px]" />;
}
