import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE,
  matchLocale,
  negotiateLocale,
  translate,
  type Locale,
  type MessageKey,
  type Params,
} from "@derslik/contracts";

/** Kullanıcının seçtiği dil (çerez), yoksa tarayıcının dili. */
export async function serverLocale(): Promise<Locale> {
  const chosen = matchLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return chosen ?? negotiateLocale((await headers()).get("accept-language"));
}

/** Sunucuda metin. Etkin dil modül değişkenine yazılmaz; istekler arasında
 *  paylaşılmasın diye dil her çağrıda açıkça verilir. */
export async function serverText(key: MessageKey, params?: Params) {
  return translate(await serverLocale(), key, params);
}
