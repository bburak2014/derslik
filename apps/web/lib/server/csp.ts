// İçerik Güvenlik Politikası her istekte burada kurulur:
//  * script-src nonce + 'strict-dynamic': yalnızca Next'in bu istekte
//    nonce verdiği betikler çalışır. Enjekte edilen <img onerror> gibi satır
//    içi işleyiciler ve yabancı betikler engellenir ('unsafe-inline' yok).
//  * Supabase adresi derleme anında değil çalışma anında okunur; kendi alan
//    adındaki ya da kendi sunucusundaki Supabase de böylece çalışır ve
//    *.supabase.co joker karakteri gerekmez (başka Supabase projesine veri
//    kaçırılamaz).
function origin(value: string | undefined) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null; // Bozuk bir değer kaynak eklemez.
  }
}

export function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV !== "production";
  const supabase = origin(process.env.SUPABASE_URL);
  const connect = new Set(["'self'"]);
  for (const value of [supabase, origin(process.env.API_BASE_URL)])
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
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Radix ve sonner stil özniteliği yazar; stil enjeksiyonu betik çalıştırmaz.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https://videodelivery.net https://*.cloudflarestream.com",
    "font-src 'self' data:",
    `connect-src ${[...connect].join(" ")}`,
    `frame-src ${frame.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
