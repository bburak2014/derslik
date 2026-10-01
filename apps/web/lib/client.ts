"use client";
import { ApiError } from "@derslik/api-client";
import { t } from "@derslik/contracts";
const retries = new Map<string, string>();
/** `idempotencyKey` verilirse anahtarı çağıran yönetir (ör. mesaj gönderimi:
 *  aynı metin ayrı ayrı gönderilebilmeli); yoksa aynı yol ve gövdenin yeniden
 *  denemesi, ağ ya da sunucu hatasından sonra aynı anahtarla gider. */
export async function webRequest<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  idempotencyKey?: string,
): Promise<T> {
  const own = !!idempotencyKey,
    signature = path + JSON.stringify(body),
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
  const data = (await r.json()) as T & { error?: string; message?: string };
  if (!r.ok) {
    if (r.status < 500 && !own) retries.delete(signature);
    throw new ApiError(
      r.status,
      data.error || data.message || t("common.failed"),
    );
  }
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
