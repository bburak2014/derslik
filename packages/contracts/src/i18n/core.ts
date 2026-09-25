/** Desteklenen diller. Kaynak dil Türkçe; diğer kataloglar onun biçimini
 *  birebir izler, eksik anahtar derleme hatası verir. */
export const locales = ["tr", "en", "de", "fr", "es", "zh", "ja"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "tr";
/** Tarayıcı veya cihaz desteklenmeyen bir dil söylediğinde. */
export const fallbackLocale: Locale = "en";

/** Her dil kendi adıyla gösterilir; seçicide kullanıcı kendi dilini tanır. */
export const localeNames: Record<Locale, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  zh: "简体中文",
  ja: "日本語",
};

/** Intl biçimlendiricilerine verilen bölge etiketleri. */
export const intlTags: Record<Locale, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  zh: "zh-CN",
  ja: "ja-JP",
};

export const LOCALE_COOKIE = "derslik-locale";

/** "zh-Hans-CN", "en_US", "DE" gibi etiketleri desteklenen dile indirger. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().replace("_", "-").split("-")[0];
  return (locales as readonly string[]).includes(base)
    ? (base as Locale)
    : null;
}

/** Accept-Language başlığından en uygun dili seçer. */
export function negotiateLocale(
  header: string | null | undefined,
  fallback: Locale = fallbackLocale,
): Locale {
  if (!header) return fallback;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag, q: q ? Number(q.trim().slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const hit = matchLocale(tag);
    if (hit) return hit;
  }
  return fallback;
}

export type Plural = { one?: string; other: string };
export type Params = Record<string, string | number>;

/** Çoğul biçim kuralı. Intl.PluralRules her motorda yok (Hermes), bu yedi
 *  dil için kural kısa: Fransızcada 0 ve 1 tekil, Çince ve Japoncada tek biçim. */
export function pluralForm(locale: Locale, n: number): "one" | "other" {
  if (locale === "zh" || locale === "ja") return "other";
  if (locale === "fr") return Math.abs(n) < 2 ? "one" : "other";
  return n === 1 ? "one" : "other";
}

export function format(template: string, params?: Params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in params ? String(params[name]) : all,
  );
}
