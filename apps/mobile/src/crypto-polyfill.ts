import * as ExpoCrypto from "expo-crypto";

// React Native's JavaScript engine ships no SubtleCrypto. supabase-js checks for
// it before hashing the PKCE verifier and, when it is missing, quietly falls back
// to the "plain" challenge method: the verifier itself travels as the challenge,
// so anything able to observe the authorization request can replay the exchange.
// Backing `crypto.subtle.digest` with expo-crypto restores S256.

type Mutable = {
  crypto?: {
    subtle?: { digest?: unknown };
    getRandomValues?: unknown;
  };
  btoa?: unknown;
  atob?: unknown;
};
const globals = globalThis as unknown as Mutable;

function define(target: object, key: string, value: unknown) {
  try {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    /* A frozen global is left as-is; the caller keeps its existing behaviour. */
  }
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(input: string) {
  let output = "";
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i),
      b = input.charCodeAt(i + 1),
      c = input.charCodeAt(i + 2);
    if (a > 255 || b > 255 || c > 255)
      throw new Error("btoa: yalnızca latin1 karakterler kodlanabilir.");
    const chunk = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output +=
      ALPHABET[(chunk >> 18) & 63] +
      ALPHABET[(chunk >> 12) & 63] +
      (Number.isNaN(b) ? "=" : ALPHABET[(chunk >> 6) & 63]) +
      (Number.isNaN(c) ? "=" : ALPHABET[chunk & 63]);
  }
  return output;
}

function decodeBase64(input: string) {
  const clean = input.replace(/[\t\n\f\r ]+/g, "").replace(/=+$/, "");
  let output = "";
  let bits = 0;
  let value = 0;
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("atob: geçersiz base64 verisi.");
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return output;
}

if (typeof globals.btoa !== "function") define(globals, "btoa", encodeBase64);
if (typeof globals.atob !== "function") define(globals, "atob", decodeBase64);

if (!globals.crypto) define(globals, "crypto", {});
const crypto = globals.crypto;

if (crypto && typeof crypto.getRandomValues !== "function")
  define(crypto, "getRandomValues", <T extends ArrayBufferView>(array: T) =>
    ExpoCrypto.getRandomValues(array as never),
  );

if (crypto && !crypto.subtle) define(crypto, "subtle", {});
if (crypto?.subtle && typeof crypto.subtle.digest !== "function") {
  const algorithms: Record<string, ExpoCrypto.CryptoDigestAlgorithm> = {
    "SHA-1": ExpoCrypto.CryptoDigestAlgorithm.SHA1,
    "SHA-256": ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    "SHA-384": ExpoCrypto.CryptoDigestAlgorithm.SHA384,
    "SHA-512": ExpoCrypto.CryptoDigestAlgorithm.SHA512,
  };
  define(
    crypto.subtle,
    "digest",
    async (
      algorithm: string | { name: string },
      data: ArrayBuffer | ArrayBufferView,
    ) => {
      const name = (
        typeof algorithm === "string" ? algorithm : algorithm?.name || ""
      ).toUpperCase();
      const mapped = algorithms[name];
      if (!mapped) throw new Error(`Desteklenmeyen özet algoritması: ${name}`);
      return ExpoCrypto.digest(mapped, data as never);
    },
  );
}
