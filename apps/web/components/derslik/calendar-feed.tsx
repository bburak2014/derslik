"use client";
import { useRef, useState } from "react";
import {
  CalendarPlus,
  CalendarSync,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Laptop,
  Lock,
  RefreshCw,
} from "lucide-react";
import { calendarLinks, t } from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton, Spinner } from "./loading";
import { FormError, FormSuccess } from "./feedback";
import { ConfirmDialog, type Confirmation } from "./learning/shared";

type Feed = { data: { url: string } };

/** "Takvime bağla": kişiye özel takvim aboneliği. Öğretmen çalışma alanının,
 *  öğrenci ve veli bağlı oldukları öğrencilerin derslerini takviminde görür. */
export function CalendarFeedButton({
  size = "default",
}: {
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const links = url ? calendarLinks(url) : null;
  async function load() {
    try {
      // İlk çağrı bağlantıyı oluşturur, sonrakiler aynısını döndürür.
      const r = await backend<Feed>("/calendar", {});
      setUrl(r.data.url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError("");
    } catch {
      // Pano izni yoksa (ör. http üzerinden yerel ağ) seçip elle kopyalatır.
      input.current?.focus();
      input.current?.select();
      setError(t("calendar.feedCopyManually"));
    }
  }
  async function rotate() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await backend<Feed>("/calendar/rotate", {});
      setUrl(r.data.url);
      setCopied(false);
      setNotice(t("calendar.feedRotated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setError("");
        setNotice("");
        setCopied(false);
        if (!url) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={size}>
          <CalendarSync /> {t("calendar.feedButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("calendar.feedTitle")}</DialogTitle>
          <DialogDescription>{t("calendar.feedBody")}</DialogDescription>
        </DialogHeader>
        {links ? (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="calendar-feed-url">
                {t("calendar.feedLink")}
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  ref={input}
                  id="calendar-feed-url"
                  readOnly
                  value={links.url}
                  className="text-ellipsis"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copy()}
                >
                  {copied ? <Check /> : <Copy />} {t("calendar.feedCopy")}
                </Button>
              </div>
              {copied && (
                <p
                  role="status"
                  className="flex items-center gap-1.5 text-xs text-(--ok)"
                >
                  <Check className="size-3.5 shrink-0" />
                  {t("calendar.feedCopied")}
                </p>
              )}
            </div>
            {notice && <FormSuccess>{notice}</FormSuccess>}
            {error && <FormError>{error}</FormError>}
            {links.local && (
              <Alert>
                <Info />
                <AlertDescription>{t("calendar.feedLocal")}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              {/* Google yerel adrese ulaşamaz; o zaman düğme gösterilmez. */}
              {!links.local && (
                <Button variant="outline" asChild>
                  <a
                    href={links.google}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink /> {t("calendar.feedGoogle")}
                  </a>
                </Button>
              )}
              <Button variant="outline" asChild>
                <a href={links.webcal}>
                  <CalendarPlus /> {t("calendar.feedApple")}
                </a>
              </Button>
            </div>
            <ul className="text-muted-foreground grid gap-2 text-xs leading-relaxed">
              <li className="flex gap-2">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                {t("calendar.feedPrivate")}
              </li>
              {!links.local && (
                <>
                  {/* Telefonda Google Takvim bağlantıyla takvim eklemez. */}
                  <li className="hidden gap-2 pointer-coarse:flex">
                    <Laptop className="mt-0.5 size-3.5 shrink-0" />
                    {t("calendar.feedGoogleComputer")}
                  </li>
                  <li className="flex gap-2">
                    <Clock className="mt-0.5 size-3.5 shrink-0" />
                    {t("calendar.feedDelay")}
                  </li>
                </>
              )}
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {t("calendar.feedOther")}
              </li>
            </ul>
          </div>
        ) : error ? (
          <FormError>{error}</FormError>
        ) : (
          <div className="grid gap-3" aria-hidden="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-48" />
          </div>
        )}
        {links && (
          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground self-start"
              disabled={busy}
              onClick={() =>
                setConfirmation({
                  title: t("calendar.feedRotateTitle"),
                  description: t("calendar.feedRotateBody"),
                  action: t("calendar.feedRotate"),
                  perform: rotate,
                })
              }
            >
              {busy ? <Spinner /> : <RefreshCw />} {t("calendar.feedRotate")}
            </Button>
          </DialogFooter>
        )}
        <ConfirmDialog
          state={confirmation}
          onClose={() => setConfirmation(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
