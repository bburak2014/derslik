import {
  defaultLocale,
  format,
  intlTags,
  pluralForm,
  type Locale,
  type Params,
  type Plural,
} from "./core.ts";
import { tr } from "./tr.ts";
import { en } from "./en.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";
import { es } from "./es.ts";
import { zh } from "./zh.ts";
import { ja } from "./ja.ts";

export * from "./core.ts";
export * from "./flags.ts";

type Shape<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends { other: string }
      ? Plural
      : Shape<T[K]>;
};
/** Her dilin kataloğu Türkçe kataloğun biçimini birebir izler. */
export type Messages = Shape<typeof tr>;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | { other: string }
    ? `${P}${K}`
    : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<typeof tr>;

const catalogs: Record<Locale, Messages> = { tr, en, de, fr, es, zh, ja };

// Tek kullanıcılı istemcilerde (tarayıcı sekmesi, telefon) etkin dil bir
// modül değişkeninde durur: yardımcı işlevler ve biçimlendiriciler bileşen
// dışında da doğru dili görür. Dil değişince ekran yeniden kurulur.
let current: Locale = defaultLocale;
export function setLocale(locale: Locale) {
  current = locale;
}
export const getLocale = () => current;
/** Intl biçimlendiricileri için bölge etiketi (ör. "de-DE"). */
export const intlLocale = (locale: Locale = current) => intlTags[locale];

function lookup(catalog: unknown, key: string): string | Plural | undefined {
  let node = catalog as Record<string, unknown> | undefined;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = node[part] as Record<string, unknown> | undefined;
  }
  return node as string | Plural | undefined;
}

export function isMessageKey(value: string): value is MessageKey {
  const hit = lookup(tr, value);
  return typeof hit === "string" || (!!hit && "other" in hit);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Params,
): string {
  let value = lookup(catalogs[locale], key) ?? lookup(tr, key);
  if (value === undefined) return key;
  if (typeof value !== "string") {
    const n = Number(params?.count ?? 0);
    value = value[pluralForm(locale, n)] ?? value.other;
  }
  return format(value, params);
}

/** Etkin dilde metin. `{ad}` yer tutucuları `params` ile doldurulur;
 *  `count` verilirse çoğul biçim seçilir. */
export const t = (key: MessageKey, params?: Params) =>
  translate(current, key, params);

/** Dile uygun büyük harf: Türkçede i → İ, diğer dillerde i → I. */
export const upper = (text: string, locale: Locale = current) =>
  text.toLocaleUpperCase(intlTags[locale]);

/** Adları etkin dilin alfabe sırasına göre karşılaştırır. */
export const compareText = (a: string, b: string) =>
  a.localeCompare(b, intlTags[current]);
export const lower = (text: string, locale: Locale = current) =>
  text.toLocaleLowerCase(intlTags[locale]);
