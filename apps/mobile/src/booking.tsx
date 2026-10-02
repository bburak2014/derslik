import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@derslik/api-client";
import {
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
import { request } from "./core";
import {
  Button,
  Card,
  CloseButton,
  EmptyState,
  ErrorText,
  Loading,
  type Palette,
  useTheme,
} from "./ui";

// Öğrencinin boş saatten ders ayarlaması (web: components/derslik/learning/booking.tsx).

type Props = {
  workspaceId: string;
  studentId: string;
  /** Öğrencinin dersleri; planlı dersi olan günler uyarı tonuyla görünür. */
  lessons: readonly { status: string; starts_at: string; ends_at: string }[];
  onClose: () => void;
  /** Ders listesi ve ayarlama özeti yenilensin. */
  onChanged: () => void;
  /** Mesajlar sekmesini açar; boşta hak yokken gösterilir. */
  onMessage?: () => void;
};

export function BookingSheet({
  visible,
  ...props
}: Props & { visible: boolean }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      {visible && <BookingBody {...props} />}
    </Modal>
  );
}

function BookingBody({
  workspaceId,
  studentId,
  lessons,
  onClose,
  onChanged,
  onMessage,
}: Readonly<Props>) {
  const { colors, styles, section } = useTheme();
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
      setSlots((await request<{ data: BookingSlots }>(base + "/slots")).data);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Ayarlama kapanmış: ekran kapanır, dersler yenilenince düğme gider.
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
      await request(base, { startsAt: chosen.startsAt });
      onChanged();
      onClose();
    } catch (e) {
      const message = (e as Error).message;
      if (e instanceof ApiError && e.status === 409) {
        // Saat dolmuş, hak bitmiş ya da ayarlama kapanmış olabilir: liste ve
        // dersler yenilenir, seçime dönülür.
        setChosen(null);
        onChanged();
        await load();
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  // Seçilen saat iptal süresinin içindeyse ayarlandıktan sonra iptal edilemez.
  const until =
    chosen && slots
      ? cancelableUntil(chosen.startsAt, slots.cancelHours, chosenAt)
      : null;
  const summary = slots
    ? [
        t("booking.minutes", { count: slots.durationMinutes }),
        slots.location || t("lesson.noLocation"),
        t("booking.freeCredits", { count: slots.freeCredits }),
      ].join(" · ")
    : t("booking.bookDescription");
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      edges={["top", "bottom"]}
    >
      <View style={section.sheetHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle} numberOfLines={1}>
            {t("booking.book")}
          </Text>
          <Text style={styles.muted} numberOfLines={2}>
            {summary}
          </Text>
        </View>
        <CloseButton onPress={onClose} disabled={busy} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { gap: 16 }]}>
        <BookingContent
          slots={slots}
          error={error}
          current={current}
          chosen={chosen}
          until={until}
          days={days}
          booked={booked}
          dayLessons={dayLessons}
          onMessage={onMessage}
          onClose={onClose}
          onDay={setDay}
          onPick={(s) => {
            setChosen(s);
            setChosenAt(Date.now());
          }}
        />
        {!!slots && <ErrorText message={error} />}
      </ScrollView>
      {chosen && (
        <View style={section.footer}>
          <Button
            secondary
            disabled={busy}
            onPress={() => setChosen(null)}
            style={{ flex: 1 }}
          >
            {t("booking.back")}
          </Button>
          <Button
            loading={busy}
            onPress={() => void book()}
            style={{ flex: 2 }}
          >
            {t("booking.confirm")}
          </Button>
        </View>
      )}
    </SafeAreaView>
  );
}

type DayGroup = ReturnType<typeof groupSlotsByDay>[number];

function BookingContent({
  slots,
  error,
  current,
  chosen,
  until,
  days,
  booked,
  dayLessons,
  onMessage,
  onClose,
  onDay,
  onPick,
}: Readonly<{
  slots: BookingSlots | null;
  error: string;
  current: DayGroup | undefined;
  chosen: BookingSlot | null;
  until: Date | null;
  days: DayGroup[];
  booked: ReturnType<typeof scheduledByDay>;
  dayLessons: string[] | undefined;
  onMessage?: () => void;
  onClose: () => void;
  onDay: (day: string) => void;
  onPick: (slot: BookingSlot) => void;
}>) {
  if (!slots) return error ? <ErrorText message={error} /> : <Loading />;
  if (slots.freeCredits < 1)
    return (
      <EmptyState
        icon="wallet-outline"
        title={t("booking.noCredits")}
        description={t("booking.noCreditsHint")}
        action={
          onMessage ? (
            <Button
              secondary
              size="sm"
              icon="chatbubble-outline"
              onPress={() => {
                onClose();
                onMessage();
              }}
            >
              {t("booking.writeTeacher")}
            </Button>
          ) : undefined
        }
      />
    );
  if (!current)
    return (
      <EmptyState
        icon="calendar-clear-outline"
        title={t("booking.noSlots")}
        description={t("booking.noSlotsHint")}
      />
    );
  if (chosen) return <ChosenSlot slots={slots} chosen={chosen} until={until} />;
  return (
    <DayPicker
      days={days}
      current={current}
      booked={booked}
      dayLessons={dayLessons}
      onDay={onDay}
      onPick={onPick}
    />
  );
}

function ChosenSlot({
  slots,
  chosen,
  until,
}: Readonly<{ slots: BookingSlots; chosen: BookingSlot; until: Date | null }>) {
  const { styles } = useTheme();
  return (
    <Card tone="brand">
      <Text style={styles.h2}>
        {dayLabel(chosen.startsAt, { weekday: "long" })} ·{" "}
        {timeLabel(chosen.startsAt)}–{timeLabel(chosen.endsAt)}
      </Text>
      <Text style={styles.muted}>
        {slots.location || t("lesson.noLocation")}
      </Text>
      <Text style={styles.caption}>
        {until
          ? t("booking.cancelUntil", {
              time: dayTimeLabel(until.toISOString()),
            })
          : t("booking.cancelNotAllowed")}
      </Text>
    </Card>
  );
}

function DayPicker({
  days,
  current,
  booked,
  dayLessons,
  onDay,
  onPick,
}: Readonly<{
  days: DayGroup[];
  current: DayGroup;
  booked: ReturnType<typeof scheduledByDay>;
  dayLessons: string[] | undefined;
  onDay: (day: string) => void;
  onPick: (slot: BookingSlot) => void;
}>) {
  const { colors, styles, type } = useTheme();
  return (
    <>
      <Text style={styles.label}>{t("booking.pickDay")}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {days.map((d) => {
          const on = d.day === current.day,
            // Bu gün zaten planlı dersi var: seçili değilse uyarı tonu.
            warn = booked.has(d.day) && !on;
          const label = dayLabel(d.day + "T12:00:00+03:00", {
            weekday: "short",
            month: "short",
          });
          return (
            <Pressable
              key={d.day}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                booked.has(d.day)
                  ? `${label}, ${t("booking.hasLesson")}`
                  : label
              }
              onPress={() => onDay(d.day)}
              style={{
                minHeight: 40,
                justifyContent: "center",
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: dayBorder(colors, on, warn),
                backgroundColor: dayFill(colors, on, warn),
              }}
            >
              <Text
                style={{
                  ...type.medium,
                  color: warn ? colors.warn : colors.ink,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {dayLessons && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.warnLine,
            backgroundColor: colors.warnSoft,
          }}
        >
          <Ionicons
            name="warning-outline"
            size={18}
            color={colors.warn}
            accessible={false}
          />
          <Text style={[styles.muted, { flex: 1, color: colors.warn }]}>
            {t("booking.dayHasLessons", { times: dayLessons.join(", ") })}
          </Text>
        </View>
      )}
      <Text style={styles.label}>{t("booking.pickTime")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {current.slots.map((s) => (
          <Button
            key={s.startsAt}
            secondary
            size="sm"
            onPress={() => onPick(s)}
            style={{ minWidth: 88 }}
          >
            {timeLabel(s.startsAt)}
          </Button>
        ))}
      </View>
    </>
  );
}

function dayBorder(colors: Palette, on: boolean, warn: boolean) {
  if (on) return colors.brandLine;
  return warn ? colors.warnLine : colors.lineControl;
}

function dayFill(colors: Palette, on: boolean, warn: boolean) {
  if (on) return colors.brandSoft;
  return warn ? colors.warnSoft : colors.surface;
}
