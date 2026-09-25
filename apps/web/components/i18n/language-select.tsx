"use client";
import {
  LOCALE_COOKIE,
  getLocale,
  localeNames,
  locales,
  matchLocale,
  t,
} from "@derslik/contracts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Flag } from "./flag";

// Seçim bir yıl çerezde durur; sunucu bir sonraki sayfada bu dille çizer.
// Bütün metinler yeniden üretilsin diye sayfa yenilenir.
function choose(value: string) {
  const next = matchLocale(value);
  if (!next || next === getLocale()) return;
  document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  location.reload();
}

export function LanguageSelect({ className = "" }: { className?: string }) {
  return (
    <Select value={getLocale()} onValueChange={choose}>
      <SelectTrigger
        size="sm"
        className={cn("w-full", className)}
        aria-label={t("common.language")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((locale) => (
          <SelectItem key={locale} value={locale} lang={locale}>
            <Flag locale={locale} />
            {localeNames[locale]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
