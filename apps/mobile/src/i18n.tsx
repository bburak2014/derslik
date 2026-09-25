import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { I18nManager, View } from "react-native";
import { getItemAsync, setItemAsync } from "expo-secure-store";
import {
  fallbackLocale,
  localeNames,
  locales,
  matchLocale,
  setLocale,
  t,
  type Locale,
} from "@derslik/contracts";
import { Picker, useTheme } from "./ui";

const LOCALE_KEY = "derslik.locale";

/** Cihazın dili; desteklenmiyorsa İngilizce. */
function deviceLocale(): Locale {
  try {
    const native = I18nManager.getConstants?.().localeIdentifier;
    const hit = matchLocale(native);
    if (hit) return hit;
  } catch {
    /* Bazı ortamlarda sabitler okunamıyor; Intl'e düşülür. */
  }
  try {
    return (
      matchLocale(Intl.DateTimeFormat().resolvedOptions().locale) ??
      fallbackLocale
    );
  } catch {
    return fallbackLocale;
  }
}

const LocaleContext = createContext<{
  locale: Locale;
  change: (next: Locale) => void;
}>({ locale: fallbackLocale, change: () => {} });

/**
 * Etkin dil. İlk açılışta cihazın dili seçilir; kullanıcı değiştirirse seçim
 * cihazda saklanır. Dil değişince ekran ağacı yeniden kurulur, böylece bütün
 * metinler ve tarih biçimleri yeni dille çizilir.
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [locale, setState] = useState<Locale | null>(null);
  useEffect(() => {
    let alive = true;
    void getItemAsync(LOCALE_KEY)
      .catch(() => null)
      .then((stored) => {
        if (!alive) return;
        const next = matchLocale(stored) ?? deviceLocale();
        setLocale(next);
        setState(next);
      });
    return () => {
      alive = false;
    };
  }, []);
  const change = useCallback((next: Locale) => {
    setLocale(next);
    setState(next);
    void setItemAsync(LOCALE_KEY, next).catch(() => {});
  }, []);
  if (!locale)
    return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  return (
    <LocaleContext.Provider value={{ locale, change }}>
      <React.Fragment key={locale}>{children}</React.Fragment>
    </LocaleContext.Provider>
  );
}

/** Dil seçimi; her dil kendi adıyla listelenir. */
export function LanguagePicker() {
  const { locale, change } = useContext(LocaleContext);
  return (
    <Picker
      label={t("common.language")}
      value={locale}
      options={locales.map((l) => ({ value: l, label: localeNames[l] }))}
      onChange={(value) => {
        const next = matchLocale(value);
        if (next && next !== locale) change(next);
      }}
    />
  );
}
