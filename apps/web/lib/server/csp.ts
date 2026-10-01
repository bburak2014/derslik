// İçerik Güvenlik Politikası her istekte burada kurulur:
//  * script-src nonce + 'strict-dynamic': yalnızca Next'in bu istekte
//    nonce verdiği betikler çalışır. Enjekte edilen <img onerror> gibi satır
//    içi işleyiciler ve yabancı betikler engellenir ('unsafe-inline' yok).
//  * Supabase adresi derleme anında değil çalışma anında okunur; kendi alan
//    adındaki ya da kendi sunucusundaki Supabase de böylece çalışır ve
//    *.supabase.co joker karakteri gerekmez (başka Supabase projesine veri
//    kaçırılamaz).
import { socketUrl } from "./realtime";

function origin(value: string | undefined) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null; // Bozuk bir değer kaynak eklemez.
  }
}

const TURNSTILE = "https://challenges.cloudflare.com";

export function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV !== "production";
  const supabase = origin(process.env.SUPABASE_URL);
  const connect = new Set(["'self'"]);
  for (const value of [
    supabase,
    origin(process.env.API_BASE_URL),
    // Anlık mesajlaşma soketi (ws/wss); connect-src http kaynağı ws'yi kapsamaz.
    origin(socketUrl() ?? undefined),
  ])
    if (value) connect.add(value);
  // Video: yükleme (tus) upload.videodelivery.net'e, oynatma listeleri
  // videodelivery.net ve müşteri alt alanlarına gider.
  connect.add("https://videodelivery.net");
  connect.add("https://upload.videodelivery.net");
  connect.add("https://*.cloudflarestream.com");
  // Next.js dev HMR WebSocket'i; connect-src 'self' ws: şemasını kapsamaz.
  if (development) {
    connect.add("ws://localhost:*");
    connect.add("ws://127.0.0.1:*");
  }
  // PDF önizlemesi imzalı Supabase Storage bağlantısını iframe'de açar.
  const frame = ["'self'", ...(supabase ? [supabase] : [])];
  // Girişteki Turnstile CAPTCHA'sı: betik 'strict-dynamic' ile nonce'lu
  // uygulama betiğinden yüklenir, doğrulama bu kökenden bir iframe'de çalışır.
  if (process.env.TURNSTILE_SITE_KEY?.trim()) {
    frame.push(TURNSTILE);
    connect.add(TURNSTILE);
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Radix ve sonner stil özniteliği yazar; stil enjeksiyonu betik çalıştırmaz.
    "style-src 'self' 'unsafe-inline'",
    // Görseller: kendi BFF'miz (öğretmen fotoğrafı) ve imzalı Supabase
    // Storage bağlantıları (dosya önizleme). Herhangi bir https: adresi değil.
    `img-src 'self' data: blob:${supabase ? " " + supabase : ""}`,
    "media-src 'self' blob: https://videodelivery.net https://*.cloudflarestream.com",
    "font-src 'self' data:",
    `connect-src ${[...connect].join(" ")}`,
    `frame-src ${frame.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
