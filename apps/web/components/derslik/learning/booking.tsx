"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, TriangleAlert, Wallet } from "lucide-react";
import { ApiError } from "@derslik/api-client";
import {
  canCancelBooking,
  cancelableUntil,
  dayLabel,
  dayTimeLabel,
  groupSlotsByDay,
  scheduledByDay,
  t,
  timeLabel,
  type BookingSlot,
  type BookingSlots,
} from "@derslik/contracts";
import { backend } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/derslik/loading";
import { FormError, ToneBadge } from "../feedback";
import { EmptyNote, type PortalLesson } from "./shared";
import type { LearningCtx } from "./use-learning-panel";

// Öğrencinin boş saatten ders ayarlaması: "Ders ayarla" düğmesi, ayarlama
// penceresi, derslerdeki etiket ve iptal (mobil: apps/mobile/src/booking.tsx).

/** Yalnızca öğrencide ve öğretmen ayarlamayı açtıysa görünür. */
export function BookButton({
  ctx,
  onOpenMessages,
}: {
  ctx: LearningCtx;
  onOpenMessages?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { reload } = ctx;
  // Pencerenin saat yükleyicisi bunlara bağlı; her çizimde yeniden
  // oluşturulsalar yükleme döngüye girerdi.
  const close = useCallback(() => setOpen(false), []),
    changed = useCallback(() => void reload(), [reload]);
  const booking = "booking" in ctx.data ? ctx.data.booking : null;
  if (!ctx.student || !booking?.enabled) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus /> {t("booking.book")}
      </Button>
      {open && (
        <BookingDialog
          workspaceId={ctx.workspaceId}
          studentId={ctx.studentId}
          lessons={"lessons" in ctx.data ? ctx.data.lessons : []}
          onClose={close}
          onChanged={changed}
          onOpenMessages={onOpenMessages}
        />
      )}
    </>
  );
}

function BookingDialog({
  workspaceId,
  studentId,
  lessons,
  onClose,
  onChanged,
  onOpenMessages,
}: {
  workspaceId: string;
  studentId: string;
  /** Öğrencinin dersleri; planlı dersi olan günler uyarı tonuyla görünür. */
  lessons: readonly PortalLesson[];
  onClose: () => void;
  /** Ders listesi ve ayarlama özeti yenilensin (portal verisi). */
  onChanged: () => void;
  onOpenMessages?: () => void;
}) {
  const base = `/portal/${workspaceId}/${studentId}/booking`;
  const [slots, setSlots] = useState<BookingSlots | null>(null),
    [error, setError] = useState(""),
    [day, setDay] = useState(""),
    [chosen, setChosen] = useState<BookingSlot | null>(null),
    // Saatin seçildiği an; onay adımındaki iptal notu buna göre yazılır.
    [chosenAt, setChosenAt] = useState(0),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setSlots((await backend<{ data: BookingSlots }>(base + "/slots")).data);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Ayarlama kapanmış: pencere kapanır, portal yenilenince düğme gider.
        toast.error(e.message, { id: "booking-error" });
        onChanged();
        onClose();
        return;
      }
      setError((e as Error).message);
    }
  }, [base, onChanged, onClose]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  const days = slots ? groupSlotsByDay(slots.slots) : [];
  const current = days.find((d) => d.day === day) ?? days[0];
  const booked = scheduledByDay(lessons);
  const dayLessons = current ? booked.get(current.day) : undefined;
  async function book() {
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      // Saat, sunucunun döndürdüğü değerle olduğu gibi gönderilir.
      await backend(base, { startsAt: chosen.startsAt });
      toast.success(t("booking.booked"));
      onChanged();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Saat dolmuş, hak bitmiş ya da ayarlama kapanmış olabilir: liste ve
        // portal yenilenir, pencere seçime döner.
        toast.error(e.message, { id: "booking-error" });
        setChosen(null);
        onChanged();
        await load();
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Seçilen saat iptal süresinin içindeyse ayarlandıktan sonra iptal edilemez.
  const until =
    chosen && slots
      ? cancelableUntil(chosen.startsAt, slots.cancelHours, chosenAt)
      : null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("booking.book")}</DialogTitle>
          <DialogDescription>{t("booking.bookDescription")}</DialogDescription>
        </DialogHeader>
        {/* Gövde her durumda aynı yükseklikte: saatler gelirken, gün
            değişirken ve onay adımında pencere büyüyüp kaymaz. Saatler
            kendi alanında kayar. */}
        <div className="flex h-80 flex-col gap-3">
          {!slots ? (
            error ? (
              <FormError>{error}</FormError>
            ) : (
              <BookingSkeleton />
            )
          ) : (
            <>
              <p className="text-muted-foreground line-clamp-2 flex-none text-sm">
                {[
                  t("booking.minutes", { count: slots.durationMinutes }),
                  slots.location || t("lesson.noLocation"),
                  t("booking.freeCredits", { count: slots.freeCredits }),
                ].join(" · ")}
              </p>
              {slots.freeCredits < 1 ? (
                <EmptyNote icon={Wallet} title={t("booking.noCredits")}>
                  {t("booking.noCreditsHint")}
                  {onOpenMessages && (
                    <Button
                      variant="link"
                      className="h-auto p-0 ps-1"
                      onClick={() => {
                        onClose();
                        onOpenMessages();
                      }}
                    >
                      {t("booking.writeTeacher")}
                    </Button>
                  )}
                </EmptyNote>
              ) : !current ? (
                <EmptyNote icon={CalendarDays} title={t("booking.noSlots")}>
                  {t("booking.noSlotsHint")}
                </EmptyNote>
              ) : chosen ? (
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <Item variant="outline">
                    <ItemMedia variant="icon">
                      <CalendarDays />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {dayLabel(chosen.startsAt, { weekday: "long" })}
                        {" · "}
                        {timeLabel(chosen.startsAt)}–{timeLabel(chosen.endsAt)}
                      </ItemTitle>
                      <ItemDescription>
                        {slots.location || t("lesson.noLocation")}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <p className="text-muted-foreground text-sm">
                    {until
                      ? t("booking.cancelUntil", {
                          time: dayTimeLabel(until.toISOString()),
                        })
                      : t("booking.cancelNotAllowed")}
                  </p>
                  {error && <FormError>{error}</FormError>}
                  <DialogFooter className="mt-auto">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setChosen(null)}
                    >
                      {t("booking.back")}
                    </Button>
                    <Button disabled={busy} onClick={() => void book()}>
                      {t("booking.confirm")}
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <>
                  <div
                    role="group"
                    aria-label={t("booking.pickDay")}
                    className="flex flex-none gap-2 overflow-x-auto pb-1"
                  >
                    {days.map((d) => {
                      const on = d.day === current.day,
                        hasLesson = booked.has(d.day);
                      return (
                        <Button
                          key={d.day}
                          type="button"
                          size="sm"
                          className={cn(
                            "flex-none",
                            hasLesson &&
                              !on &&
                              "border-(--warn-line) bg-(--warn-soft) text-(--warn) hover:bg-(--warn-soft) hover:text-(--warn)",
                          )}
                          variant={on ? "default" : "outline"}
                          aria-pressed={on}
                          onClick={() => setDay(d.day)}
                        >
                          {dayLabel(d.day + "T12:00:00+03:00", {
                            weekday: "short",
                            month: "short",
                          })}
                          {hasLesson && (
                            <span className="sr-only">
                              {" · "}
                              {t("booking.hasLesson")}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                  {dayLessons && (
                    <p className="flex flex-none items-start gap-2 rounded-md border border-(--warn-line) bg-(--warn-soft) px-3 py-2 text-sm text-(--warn)">
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      {t("booking.dayHasLessons", {
                        times: dayLessons.join(", "),
                      })}
                    </p>
                  )}
                  {/* Gün değişince alan baştan açılır (kaydırma sıfırlanır). */}
                  <div
                    key={current.day}
                    role="group"
                    aria-label={t("booking.pickTime")}
                    className="min-h-0 flex-1 overflow-y-auto"
                  >
                    <div className="grid grid-cols-3 gap-2 p-0.5 sm:grid-cols-4">
                      {current.slots.map((s) => (
                        <Button
                          key={s.startsAt}
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setChosen(s);
                            setChosenAt(Date.now());
                          }}
                        >
                          {timeLabel(s.startsAt)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {error && <FormError>{error}</FormError>}
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Saatler gelene kadar gövdenin son düzeni: özet, gün düğmeleri, saatler. */
function BookingSkeleton() {
  return (
    <div
      className="grid content-start gap-3"
      role="status"
      aria-label={t("common.loading")}
    >
      <Skeleton className="h-5 w-56 max-w-full" />
      <div className="flex gap-2 overflow-hidden pb-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20 flex-none" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 p-0.5 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    </div>
  );
}

/** Öğrencinin ayarladığı derste etiket. Öğrenciye, iptal süresi dolmadıysa
 *  "Dersi iptal et" düğmesi, dolduysa öğretmene yazma notu gösterilir. */
export function BookedLessonExtra({
  ctx,
  lesson,
  now,
}: {
  ctx: LearningCtx;
  lesson: PortalLesson;
  now: number;
}) {
  const booking = "booking" in ctx.data ? ctx.data.booking : null;
  const upcoming =
    lesson.status === "SCHEDULED" && Date.parse(lesson.ends_at) > now;
  return (
    <>
      <ToneBadge tone="info">
        {ctx.student ? t("booking.bookedByYou") : t("booking.bookedByStudent")}
      </ToneBadge>
      {ctx.student &&
        upcoming &&
        (canCancelBooking(lesson, booking?.cancelHours ?? 0, now) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ctx.busy}
            onClick={() =>
              ctx.setConfirmation({
                title: t("booking.cancelTitle"),
                description: t("booking.cancelBody", {
                  when: dayTimeLabel(lesson.starts_at),
                }),
                action: t("booking.cancel"),
                perform: () => cancelBooking(ctx, lesson),
              })
            }
          >
            {t("booking.cancel")}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">
            {t("booking.cancelClosed")}
          </span>
        ))}
    </>
  );
}

async function cancelBooking(ctx: LearningCtx, lesson: PortalLesson) {
  ctx.setBusy(true);
  try {
    await backend(`${ctx.base}/booking/${lesson.id}/cancel`, {
      version: lesson.version,
    });
    toast.success(t("booking.cancelled"));
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    ctx.setBusy(false);
    await ctx.reload();
  }
}
