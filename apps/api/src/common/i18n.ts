import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import {
  defaultLocale,
  isMessageKey,
  negotiateLocale,
  translate,
  type Locale,
  type MessageKey,
  type Params,
} from "../../../../packages/contracts/src/i18n/index.js";

// İsteğin dili Accept-Language başlığından gelir: web sunucusu kullanıcının
// seçtiği dili, mobil uygulama cihazdaki seçimi yazar. Hata iletileri,
// e-postalar ve durum metinleri bu dilde üretilir.
const store = new AsyncLocalStorage<Locale>();

export function localeMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  store.run(requestLocale(req), next);
}

/** Başlık yoksa ya da desteklenen bir dil içermiyorsa (eski mobil sürümler,
 *  testler, "*") Türkçe kalır. */
export const requestLocale = (req: Pick<Request, "headers">): Locale =>
  negotiateLocale(req.headers["accept-language"], defaultLocale);

export const currentLocale = () => store.getStore() ?? defaultLocale;

/** İsteğin dilinde metin. */
export const apiText = (key: MessageKey, params?: Params) =>
  translate(currentLocale(), key, params);

/** Hata iletisi bir çeviri anahtarıysa isteğin diline çevrilir; değilse
 *  (ör. çerçevenin kendi iletisi) olduğu gibi kalır. */
export const localizeMessage = (locale: Locale, message: string) =>
  isMessageKey(message) ? translate(locale, message) : message;
