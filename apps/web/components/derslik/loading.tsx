"use client";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@derslik/contracts";

// Yüklenme göstergeleri tek yerden gelsin diye burada toplandı: sayfa ve
// bölümler PageLoader, butonlar ve satır içi durumlar Spinner kullanır.
// Böylece her ekranda aynı simge ve aynı ritim görünür.
export { Skeleton } from "@/components/ui/skeleton";
export { Spinner };

/**
 * Sayfa ya da bölüm yüklenirken alanın ortasında dönen simge.
 * Görünen metin yok; ekran okuyucu için etiket var.
 */
export function PageLoader({
  compact = false,
}: Readonly<{ compact?: boolean }>) {
  return (
    <output
      className={"loading-state" + (compact ? " is-compact" : "")}
      aria-label={t("common.loading")}
    >
      <Spinner className="loading-spinner" />
    </output>
  );
}
