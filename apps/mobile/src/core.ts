import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { createClient } from "@supabase/supabase-js";
import { DerslikClient, ApiError } from "@derslik/api-client";

const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
// Large auth sessions are split into bounded Keychain/Keystore values. The
// manifest is replaced last, so readers never observe half-written sessions.
const rawSecureStorage = {
  async getItem(key: string) {
    const raw = await SecureStore.getItemAsync(key, options);
    if (!raw) return null;
    const m = JSON.parse(raw) as { generation: string; count: number };
    if (!Number.isInteger(m.count) || m.count < 1 || m.count > 128) return null;
    const chunks = await Promise.all(
      Array.from({ length: m.count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${m.generation}.${i}`, options),
      ),
    );
    return chunks.some((x) => x === null) ? null : chunks.join("");
  },
  async setItem(key: string, value: string) {
    const old = await SecureStore.getItemAsync(key, options),
      generation = Crypto.randomUUID(),
      parts = value.match(/[\s\S]{1,500}/g) || [""];
    if (parts.length > 128) throw new Error("Oturum boyutu sınırı aşıldı.");
    let written = 0;
    try {
      for (; written < parts.length; written++)
        await SecureStore.setItemAsync(
          `${key}.${generation}.${written}`,
          parts[written],
          options,
        );
      await SecureStore.setItemAsync(
        key,
        JSON.stringify({ generation, count: parts.length }),
        options,
      );
    } catch (error) {
      // Yarım kalan yeni parçalar silinir; eski oturum yerinde kalır ve
      // çıkıştan sonra Keychain'de sahipsiz belirteç parçası bırakılmaz.
      for (let i = 0; i < written; i++)
        await SecureStore.deleteItemAsync(
          `${key}.${generation}.${i}`,
          options,
        ).catch(() => undefined);
      throw error;
    }
    if (old) {
      const m = JSON.parse(old);
      for (let i = 0; i < m.count; i++)
        await SecureStore.deleteItemAsync(
          `${key}.${m.generation}.${i}`,
          options,
        );
    }
  },
  async removeItem(key: string) {
    const old = await SecureStore.getItemAsync(key, options);
    await SecureStore.deleteItemAsync(key, options);
    if (old) {
      const m = JSON.parse(old);
      for (let i = 0; i < m.count; i++)
        await SecureStore.deleteItemAsync(
          `${key}.${m.generation}.${i}`,
          options,
        );
    }
  },
};
// Serialize reads and writes: a refresh must never delete chunks while a
// concurrent session read is still consuming the previous manifest.
let storageQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => undefined);
  return next;
}
export const secureStorage = {
  getItem: (key: string) => serialize(() => rawSecureStorage.getItem(key)),
  setItem: (key: string, value: string) =>
    serialize(() => rawSecureStorage.setItem(key, value)),
  removeItem: (key: string) =>
    serialize(() => rawSecureStorage.removeItem(key)),
};
export const configuration = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
  api: process.env.EXPO_PUBLIC_API_URL || "",
  // Turnstile CAPTCHA; boşsa giriş ekranı CAPTCHA göstermez.
  captchaSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || "",
  // Widget'ın açıldığı adres; Turnstile'da izinli alan adı olmalı.
  captchaOrigin: process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN || "",
};
export const configured = !!(
  configuration.url &&
  configuration.key &&
  configuration.api
);
export const supabase = configured
  ? createClient(configuration.url, configuration.key, {
      auth: {
        storage: secureStorage,
        // supabase-js 2.115 coordinates refreshes itself; passing a lock logs a
        // deprecation warning on every refresh tick.
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;
export const client = new DerslikClient({
  baseUrl: configuration.api,
  getToken: async () => {
    const result = await supabase?.auth.getSession();
    return result?.data.session?.access_token || null;
  },
});
const retryKeys = new Map<string, string>();
/** `idempotencyKey` verilirse anahtarı çağıran yönetir (ör. mesaj gönderimi:
 *  aynı metin ayrı ayrı gönderilebilmeli). Verilmezse aynı yol ve gövdenin
 *  ağ ya da sunucu hatasından sonraki denemesi aynı anahtarla gider. */
export async function request<T = unknown>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const own = !!idempotencyKey,
    signature = path + JSON.stringify(body),
    key = idempotencyKey || retryKeys.get(signature) || Crypto.randomUUID();
  if (body !== undefined && !own) retryKeys.set(signature, key);
  try {
    const result = await client.request<T>("/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      body,
      key: body === undefined ? undefined : key,
    });
    if (!own) retryKeys.delete(signature);
    return result;
  } catch (e) {
    if (!own && e instanceof ApiError && e.status < 500)
      retryKeys.delete(signature);
    throw e;
  }
}
export function watchRefresh() {
  const update = (state: string) => {
    if (state === "active") supabase?.auth.startAutoRefresh();
    else supabase?.auth.stopAutoRefresh();
  };
  update(AppState.currentState);
  const listener = AppState.addEventListener("change", update);
  return () => {
    listener.remove();
    supabase?.auth.stopAutoRefresh();
  };
}
