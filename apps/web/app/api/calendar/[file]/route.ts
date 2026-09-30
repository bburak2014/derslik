import { clientIp } from "@/lib/server/client-ip";
export const dynamic = "force-dynamic";

// Takvim uygulamaları (Google, Apple) bu adresi oturumsuz ve düzenli okur.
// Bağlantıdaki belirteç tek anahtardır; yanıt kişiye özeldir, ara
// önbelleklerde saklanmaz, başka siteye yönlendiren bağlantıda sızmaz.
const headers = {
  "Cache-Control": "private, no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

function text(status: number) {
  return new Response(status === 404 ? "Not found\n" : "Unavailable\n", {
    status,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const token = /^([a-f0-9]{64})\.ics$/.exec(file)?.[1];
  if (!token) return text(404);
  if (!process.env.API_BASE_URL) return text(503);
  const ip = clientIp(request.headers);
  try {
    const response = await fetch(
      process.env.API_BASE_URL.replace(/\/$/, "") + "/v1/calendar/" + token,
      {
        cache: "no-store",
        // API akışı IP başına sınırlar; yoksa tüm takvimler web sunucusunun
        // tek IP'sinden geliyor görünürdü.
        headers: ip ? { "X-Forwarded-For": ip } : {},
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const status =
        response.status === 404 || response.status === 429
          ? response.status
          : 503;
      const res = text(status);
      if (status === 429 && retry) res.headers.set("Retry-After", retry);
      return res;
    }
    return new Response(await response.text(), {
      headers: {
        ...headers,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="derslik.ics"',
      },
    });
  } catch {
    return text(503);
  }
}
