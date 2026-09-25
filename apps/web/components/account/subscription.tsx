"use client";
import { useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { backend } from "@/lib/client";
type SubscriptionState = {
  providerId?: string | null;
  status: string;
  endsAt?: string | null;
  renewsAt?: string | null;
  available: boolean;
  pro: { students: number; videoHours: number; materialGb: number };
  testMode: boolean;
};
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
import { intlLocale, t, type MessageKey } from "@derslik/contracts";

const statuses: Record<string, [Tone, MessageKey]> = {
  active: ["ok", "sub.status.active"],
  on_trial: ["info", "sub.status.on_trial"],
  cancelled: ["muted", "sub.status.cancelled"],
  expired: ["muted", "sub.status.expired"],
  past_due: ["warn", "sub.status.past_due"],
  unpaid: ["danger", "sub.status.unpaid"],
  paused: ["muted", "sub.status.paused"],
};

export function Subscription({
  workspaceId,
  onUpdate,
}: {
  workspaceId: string;
  onUpdate: () => void;
}) {
  const [data, setData] = useState<SubscriptionState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void backend<{ data: SubscriptionState }>(
      `/workspaces/${workspaceId}/subscription`,
    )
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, [workspaceId]);
  async function open(kind: "checkout" | "portal") {
    setBusy(true);
    setError("");
    try {
      const r = await backend<{ data: { url: string } }>(
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
      const r = await backend<{ data: SubscriptionState }>(
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
  const known = statuses[data.status];
  const status: [Tone, string] | null = data.providerId
    ? known
      ? [known[0], t(known[1])]
      : ["muted", data.status]
    : null;
  return (
    <Card className="gap-5 py-5">
      <CardHeader className="px-5">
        <CardTitle>Derslik Pro</CardTitle>
        <CardDescription>
          {data.providerId ? t("sub.managedByProvider") : t("sub.onPilot")}
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
                t("sub.proStudents", { count: data.pro.students }),
                t("sub.proVideo", { count: data.pro.videoHours }),
                t("sub.proStorage", { count: data.pro.materialGb }),
              ].map((line) => (
                <li className="flex items-center gap-2" key={line}>
                  <Check className="size-4 shrink-0 text-(--ok)" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {data.testMode ? t("sub.testMode") : t("sub.termsOnCheckout")}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{t("sub.notAvailable")}</p>
        )}
        {data.endsAt && (
          <p className="text-muted-foreground text-xs">
            {t("sub.endsAt", {
              date: new Date(data.endsAt).toLocaleDateString(intlLocale()),
            })}
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
            {data.providerId ? t("sub.manage") : t("sub.upgrade")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void sync()}
          >
            <RefreshCw /> {t("sub.refresh")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
