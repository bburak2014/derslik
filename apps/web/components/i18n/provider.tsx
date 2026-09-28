"use client";
import {
  registerCatalog,
  setLocale,
  type Locale,
  type Messages,
} from "@derslik/contracts";

/**
 * Sunucunun seçtiği dili (çerez ya da tarayıcı dili) istemcide etkin dil
 * yapar. Çocuklar render olmadan önce yazılır; böylece `t()` ve tarih/para
 * biçimlendiricileri ilk karede doğru dili kullanır. Dil değişince sayfa
 * yeniden yüklenir, bu yüzden bağlam ya da abonelik gerekmez.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  /** Türkçe dışındaki dilde sayfanın kataloğu (sunucudan gelir). */
  messages?: Messages;
  children: React.ReactNode;
}) {
  if (messages) registerCatalog(locale, messages);
  setLocale(locale);
  return children;
}
