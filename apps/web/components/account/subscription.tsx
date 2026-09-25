"use client";
import { useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton, Spinner } from "@/components/derslik/loading";
import { FormError, ToneBadge, type Tone } from "@/components/derslik/feedback";

const statuses: Record<string, [Tone, string]> = {
  active: ["ok", "Etkin"],
  on_trial: ["info", "Deneme"],
  cancelled: ["muted", "İptal edildi"],
  expired: ["muted", "Sona erdi"],
  past_due: ["warn", "Ödeme bekliyor"],
  unpaid: ["danger", "Ödenmedi"],
  paused: ["muted", "Duraklatıldı"],
};

export function Subscription({
  workspaceId,
  onUpdate,
}: {
  workspaceId: string;
  onUpdate: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void backend(`/workspaces/${workspaceId}/subscription`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, [workspaceId]);
  async function open(kind: "checkout" | "portal") {
    setBusy(true);
    setError("");
    try {
      const r = await backend(
        `/workspaces/${workspaceId}/subscription/${kind}`,
        {},
      );
      location.assign(r.data.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    setError("");
    try {
      const r = await backend(
        `/workspaces/${workspaceId}/subscription/sync`,
        {},
      );
      setData(r.data);
      onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Yüklenirken hiçbir şey çizmemek paneli istek dönünce zıplatıyordu; iskelet
  // kartın yerini baştan ayırıyor.
  if (!data)
    return error ? (
      <FormError>{error}</FormError>
    ) : (
      <Card className="gap-4 py-5" aria-hidden="true">
        <CardContent className="grid gap-3 px-5">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  const status = data.providerId
    ? statuses[data.status] || (["muted", data.status] as [Tone, string])
    : null;
  return (
    <Card className="gap-5 py-5">
      <CardHeader className="px-5">
        <CardTitle>Derslik Pro</CardTitle>
        <CardDescription>
          {data.providerId
            ? "Aboneliğiniz ödeme sağlayıcısı üzerinden yönetilir."
            : "Şu anda Pilot planını kullanıyorsunuz."}
        </CardDescription>
        {status && (
          <CardAction>
            <ToneBadge tone={status[0]}>{status[1]}</ToneBadge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 px-5 text-sm">
        {data.available ? (
          <>
            <ul className="grid gap-2">
              {[
                `${data.pro.students} aktif öğrenci`,
                `${data.pro.videoHours} saat ders videosu`,
                `${data.pro.materialGb} GB dosya alanı`,
              ].map((line) => (
                <li className="flex items-center gap-2" key={line}>
                  <Check className="size-4 shrink-0 text-(--ok)" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {data.testMode
                ? "Test ödeme ortamı açık. Gerçek ücret alınmaz."
                : "Ücret ve yenileme koşulları ödeme sayfasında gösterilir."}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">
            Ücretli abonelikler henüz açılmamış.
          </p>
        )}
        {data.endsAt && (
          <p className="text-muted-foreground text-xs">
            Bitiş: {new Date(data.endsAt).toLocaleDateString("tr-TR")}
          </p>
        )}
        {error && <FormError>{error}</FormError>}
      </CardContent>
      {data.available && (
        <CardFooter className="flex-wrap gap-2 px-5">
          <Button
            type="button"
            disabled={busy}
            onClick={() => void open(data.providerId ? "portal" : "checkout")}
          >
            {busy ? <Spinner /> : <ExternalLink />}
            {data.providerId ? "Aboneliği yönet" : "Pro'ya geç"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void sync()}
          >
            <RefreshCw /> Durumu yenile
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
