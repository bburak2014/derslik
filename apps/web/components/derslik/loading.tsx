"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

// Yüklenme göstergeleri tek yerden gelsin diye burada toplandı: sayfa ve
// bölümler PageLoader, butonlar ve satır içi durumlar Spinner kullanır.
// Böylece her ekranda aynı simge ve aynı ritim görünür.
export { Skeleton, Spinner };

/**
 * Sayfa ya da bölüm yüklenirken alanın ortasında dönen simge.
 * Görünen metin yok; ekran okuyucu için etiket var.
 */
export function PageLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={"loading-state" + (compact ? " is-compact" : "")}
      role="status"
      aria-label="Yükleniyor"
    >
      <Spinner className="loading-spinner" />
    </div>
  );
}
