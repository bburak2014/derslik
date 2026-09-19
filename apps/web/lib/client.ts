"use client";
import { ApiError } from "@derslik/api-client";
const retries = new Map<string, string>();
export async function webRequest<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const signature = path + JSON.stringify(body),
    key = retries.get(signature) || crypto.randomUUID();
  if (body !== undefined) retries.set(signature, key);
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
  const data = (await r.json()) as any;
  if (!r.ok) {
    if (r.status < 500) retries.delete(signature);
    throw new ApiError(
      r.status,
      data.error || data.message || "İşlem tamamlanamadı.",
    );
  }
  retries.delete(signature);
  return data;
}
export const backend = <T = any>(path: string, body?: unknown) =>
  webRequest<T>("/api/backend" + path, body);
