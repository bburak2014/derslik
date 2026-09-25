"use client";
import { setLocale, type Locale } from "@derslik/contracts";

/**
 * Sunucunun seçtiği dili (çerez ya da tarayıcı dili) istemcide etkin dil
 * yapar. Çocuklar render olmadan önce yazılır; böylece `t()` ve tarih/para
 * biçimlendiricileri ilk karede doğru dili kullanır. Dil değişince sayfa
 * yeniden yüklenir, bu yüzden bağlam ya da abonelik gerekmez.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  setLocale(locale);
  return children;
}
