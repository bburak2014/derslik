"use client";
import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import { toast } from "sonner";
import { CalendarClock, Plus, X } from "lucide-react";
import { ApiError } from "@derslik/api-client";
import {
  CANCEL_PRESETS,
  DURATION_PRESETS,
  NOTICE_PRESETS,
  bookingSettingsSchema,
  dateKey,
  halfHourOptions,
  isMessageKey,
  nextWindow,
  presetOptions,
  settingsIssues,
  t,
  weekdayName,
  type BookingSettings,
} from "@derslik/contracts";
import { backend, webRequest } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageLoader } from "./loading";
import { FormError } from "./feedback";

// Öğretmenin müsaitliği: öğrencilerin ders ayarlayabileceği haftalık boş
// saatler, kapalı günler ve kurallar (mobil: apps/mobile/src/teacher/availability.tsx).

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const TIMES = halfHourOptions();
/** Şema iletisi bir çeviri anahtarıysa etkin dilde; değilse genel uyarı. */
const issueText = (message: string) =>
  isMessageKey(message) ? t(message) : t("api.invalidFields");

/** Takvim araç çubuğundaki "Müsaitlik" düğmesi; yanında açık/kapalı durumu. */
export function AvailabilityButton({ workspaceId }: { workspaceId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    backend<{ data: BookingSettings }>(`/workspaces/${workspaceId}/booking`)
      .then((r) => {
        if (alive) setEnabled(r.data.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId]);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock /> {t("booking.availability")}
        {enabled !== null && (
          <span className={enabled ? "text-(--ok)" : "text-muted-foreground"}>
            · {enabled ? t("booking.on") : t("booking.off")}
          </span>
        )}
      </Button>
      {open && (
        <AvailabilityDialog
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
          onSaved={(saved) => setEnabled(saved.enabled)}
        />
      )}
    </>
  );
}

function AvailabilityDialog({
  workspaceId,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  onClose: () => void;
  onSaved: (settings: BookingSettings) => void;
}) {
  const [form, setForm] = useState<BookingSettings | null>(null),
    [issues, setIssues] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await backend<{ data: BookingSettings }>(
        `/workspaces/${workspaceId}/booking`,
      );
      setForm(r.data);
      setIssues({});
      setStale(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  /** Formu değiştirir; eski satır hataları artık yanlış satırı gösterebilir. */
  const edit = (change: (f: BookingSettings) => BookingSettings) => {
    setIssues({});
    setForm((f) => (f ? change(f) : f));
  };
  async function save(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form || busy) return;
    const parsed = bookingSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setIssues(settingsIssues(parsed.error.issues));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await webRequest<{ data: BookingSettings }>(
        `/api/backend/workspaces/${workspaceId}/booking`,
        parsed.data,
        "PUT",
      );
      onSaved(r.data);
      toast.success(t("booking.saved"));
      onClose();
    } catch (err) {
      // 409: ayar başka yerde (ör. mobilde) kaydedilmiş; yeniden yükleme sunulur.
      setStale(err instanceof ApiError && err.status === 409);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const issue = (key: string) =>
    issues[key] ? (
      <p className="text-destructive text-sm">{issueText(issues[key])}</p>
    ) : null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("booking.title")}</DialogTitle>
          <DialogDescription>{t("booking.description")}</DialogDescription>
        </DialogHeader>
        {!form ? (
          error ? (
            <div className="grid gap-3">
              <FormError>{error}</FormError>
              <Button
                type="button"
                variant="outline"
                onClick={() => void load()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <PageLoader compact />
          )
        ) : (
          <form onSubmit={save} className="grid gap-6">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="grid gap-1">
                <Label htmlFor="booking-enabled">{t("booking.enabled")}</Label>
                <p className="text-muted-foreground text-sm">
                  {t("booking.enabledHint")}
                </p>
              </div>
              <Switch
                id="booking-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => edit((f) => ({ ...f, enabled }))}
              />
            </div>
            <section className="grid gap-3">
              <div className="grid gap-1">
                <h3 className="font-semibold">{t("booking.weeklyHours")}</h3>
                <p className="text-muted-foreground text-sm">
                  {t("booking.weeklyHoursHint")}
                </p>
              </div>
              {issue("windows")}
              {WEEKDAYS.map((weekday) => {
                const day = weekdayName(weekday);
                const rows = form.windows
                  .map((window, index) => ({ window, index }))
                  .filter((x) => x.window.weekday === weekday);
                const next = nextWindow(form.windows, weekday);
                return (
                  <div
                    key={weekday}
                    className="grid gap-2 rounded-lg border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{day}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!next}
                        onClick={() =>
                          next &&
                          edit((f) => ({ ...f, windows: [...f.windows, next] }))
                        }
                      >
                        <Plus /> {t("booking.addRange")}
                      </Button>
                    </div>
                    {!rows.length && (
                      <p className="text-muted-foreground text-sm">
                        {t("booking.dayClosed")}
                      </p>
                    )}
                    {rows.map(({ window, index }) => (
                      <div key={index} className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <TimeSelect
                            label={t("booking.rangeStart", { day })}
                            value={window.start}
                            options={TIMES.slice(0, -1)}
                            onChange={(start) =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.map((w, i) =>
                                  i === index ? { ...w, start } : w,
                                ),
                              }))
                            }
                          />
                          <span aria-hidden="true">–</span>
                          <TimeSelect
                            label={t("booking.rangeEnd", { day })}
                            value={window.end}
                            options={TIMES.slice(1)}
                            onChange={(end) =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.map((w, i) =>
                                  i === index ? { ...w, end } : w,
                                ),
                              }))
                            }
                          />
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("booking.removeRange")}
                            onClick={() =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            <X />
                          </Button>
                        </div>
                        {issue(`windows.${index}`)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
            <section className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <h3 className="font-semibold">{t("booking.closedDays")}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t("booking.closedDaysHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    edit((f) => ({
                      ...f,
                      blocks: [...f.blocks, { from: dateKey(), to: dateKey() }],
                    }))
                  }
                >
                  <Plus /> {t("booking.addClosedDays")}
                </Button>
              </div>
              {issue("blocks")}
              {!form.blocks.length && (
                <p className="text-muted-foreground text-sm">
                  {t("booking.noClosedDays")}
                </p>
              )}
              {form.blocks.map((block, index) => (
                <div key={index} className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      className="w-auto"
                      aria-label={t("booking.from")}
                      value={block.from}
                      onChange={(e) => {
                        const from = e.target.value;
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.map((b, i) =>
                            i === index ? { ...b, from } : b,
                          ),
                        }));
                      }}
                    />
                    <span aria-hidden="true">–</span>
                    <Input
                      type="date"
                      className="w-auto"
                      aria-label={t("booking.to")}
                      value={block.to}
                      min={block.from}
                      onChange={(e) => {
                        const to = e.target.value;
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.map((b, i) =>
                            i === index ? { ...b, to } : b,
                          ),
                        }));
                      }}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("booking.removeClosedDays")}
                      onClick={() =>
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      <X />
                    </Button>
                  </div>
                  {issue(`blocks.${index}`)}
                </div>
              ))}
            </section>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberSelect
                id="booking-duration"
                label={t("booking.duration")}
                value={form.durationMinutes}
                options={presetOptions(DURATION_PRESETS, form.durationMinutes)}
                format={(n) => t("booking.minutes", { count: n })}
                onChange={(durationMinutes) =>
                  edit((f) => ({ ...f, durationMinutes }))
                }
              />
              <NumberSelect
                id="booking-notice"
                label={t("booking.notice")}
                value={form.noticeHours}
                options={presetOptions(NOTICE_PRESETS, form.noticeHours)}
                format={(n) =>
                  n ? t("booking.hours", { count: n }) : t("booking.noticeNone")
                }
                onChange={(noticeHours) => edit((f) => ({ ...f, noticeHours }))}
              />
              <NumberSelect
                id="booking-cancel"
                label={t("booking.cancelWindow")}
                value={form.cancelHours}
                options={presetOptions(CANCEL_PRESETS, form.cancelHours)}
                format={(n) =>
                  n
                    ? t("booking.hoursBefore", { count: n })
                    : t("booking.cancelUntilStart")
                }
                onChange={(cancelHours) => edit((f) => ({ ...f, cancelHours }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="booking-location">{t("booking.location")}</Label>
              <Input
                id="booking-location"
                value={form.location}
                maxLength={100}
                placeholder={t("booking.locationPlaceholder")}
                onChange={(e) => {
                  const location = e.target.value;
                  edit((f) => ({ ...f, location }));
                }}
              />
              {issue("location")}
            </div>
            <p className="text-muted-foreground text-sm">{t("booking.note")}</p>
            {error && (
              <FormError>
                {error}
                {stale && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 ps-2"
                    onClick={() => void load()}
                  >
                    {t("booking.reload")}
                  </Button>
                )}
              </FormError>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TimeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberSelect({
  id,
  label,
  value,
  options,
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  options: number[];
  format: (n: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {format(n)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
