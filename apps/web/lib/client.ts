"use client";
import { ApiError } from "@derslik/api-client";
import { t } from "@derslik/contracts";
const retries = new Map<string, string>();
const reading = new Map<string, Promise<unknown>>();
/** `idempotencyKey` verilirse anahtarı çağıran yönetir (ör. mesaj gönderimi:
 *  aynı metin ayrı ayrı gönderilebilmeli); yoksa aynı yol ve gövdenin yeniden
 *  denemesi, ağ ya da sunucu hatasından sonra aynı anahtarla gider.
 *
 *  Aynı adresi aynı anda okuyan bileşenler (ör. kenar çubuğu sayacı ile açık
 *  sayfa) tek isteği paylaşır; her biri yanıtın kendi kopyasını alır. Bir
 *  yazma işlemi gönderilince paylaşım biter: sonraki okumalar sunucuya gider
 *  ve yazmadan önceki yanıtı almaz. */
export function webRequest<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  idempotencyKey?: string,
): Promise<T> {
  if (method !== "GET") {
    reading.clear();
    return send<T>(path, body, method, idempotencyKey);
  }
  let request = reading.get(path) as Promise<T> | undefined;
  if (!request) {
    const sent = send<T>(path, body, method, idempotencyKey).finally(() => {
      if (reading.get(path) === sent) reading.delete(path);
    });
    reading.set(path, sent);
    request = sent;
  }
  return request.then((data) => structuredClone(data));
}
async function send<T>(
  path: string,
  body: unknown,
  method: string,
  idempotencyKey?: string,
): Promise<T> {
  const own = !!idempotencyKey,
    signature = method + ":" + path + JSON.stringify(body),
    key = idempotencyKey || retries.get(signature) || crypto.randomUUID();
  if (body !== undefined && !own) retries.set(signature, key);
  const r = await fetch(path, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Derslik-Client": "web",
      "Idempotency-Key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json().catch(() => null)) as
    (T & { error?: string; message?: string }) | null;
  if (!r.ok) {
    if (r.status < 500 && !own) retries.delete(signature);
    throw new ApiError(
      r.status,
      (typeof data?.error === "string" && data.error) ||
        (typeof data?.message === "string" && data.message) ||
        t("common.failed"),
    );
  }
  // A successful HTTP status with an unreadable payload is not a confirmed
  // mutation result; keep its retry key until a valid response arrives.
  if (data === null) throw new ApiError(502, t("common.failed"));
  if (!own) retries.delete(signature);
  return data;
}
export const backend = <T = unknown>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
) => webRequest<T>("/api/backend" + path, body, undefined, idempotencyKey);

/** Formdaki metin alanının değeri; alan yoksa ya da dosyaysa boş metin. */
export function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
