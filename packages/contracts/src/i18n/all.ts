import { registerCatalog, type Messages } from "./index.ts";
import type { Locale } from "./core.ts";
import { tr } from "./tr.ts";
import { en } from "./en.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";
import { es } from "./es.ts";
import { zh } from "./zh.ts";
import { ja } from "./ja.ts";

/** Bütün diller. Sunucu, API ve mobil uygulama bunu bir kez içe aktarır;
 *  web tarayıcısı paketine girmez. */
export const allCatalogs: Record<Locale, Messages> = {
  tr,
  en,
  de,
  fr,
  es,
  zh,
  ja,
};
for (const [locale, messages] of Object.entries(allCatalogs))
  registerCatalog(locale as Locale, messages);
