import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@derslik/api-client";
import {
  cancelDeadline,
  dayLabel,
  dayTimeLabel,
  groupSlotsByDay,
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
  useTheme,
} from "./ui";

// Öğrencinin boş saatten ders ayarlaması (web: components/derslik/learning/booking.tsx).

type Props = {
  workspaceId: string;
  studentId: string;
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
  onClose,
  onChanged,
  onMessage,
}: Props) {
  const { colors, styles, section, type } = useTheme();
  const base = `/portal/${workspaceId}/${studentId}/booking`;
  const [slots, setSlots] = useState<BookingSlots | null>(null),
    [error, setError] = useState(""),
    [day, setDay] = useState(""),
    [chosen, setChosen] = useState<BookingSlot | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setSlots((await request<{ data: BookingSlots }>(base + "/slots")).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  const days = slots ? groupSlotsByDay(slots.slots) : [];
  const current = days.find((d) => d.day === day) ?? days[0];
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
        {!slots ? (
          error ? (
            <ErrorText message={error} />
          ) : (
            <Loading />
          )
        ) : slots.freeCredits < 1 ? (
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
        ) : !current ? (
          <EmptyState
            icon="calendar-clear-outline"
            title={t("booking.noSlots")}
            description={t("booking.noSlotsHint")}
          />
        ) : chosen ? (
          <Card tone="brand">
            <Text style={styles.h2}>
              {dayLabel(chosen.startsAt, { weekday: "long" })} ·{" "}
              {timeLabel(chosen.startsAt)}–{timeLabel(chosen.endsAt)}
            </Text>
            <Text style={styles.muted}>
              {slots.location || t("lesson.noLocation")}
            </Text>
            <Text style={styles.caption}>
              {t("booking.cancelUntil", {
                time: dayTimeLabel(
                  cancelDeadline(
                    chosen.startsAt,
                    slots.cancelHours,
                  ).toISOString(),
                ),
              })}
            </Text>
          </Card>
        ) : (
          <>
            <Text style={styles.label}>{t("booking.pickDay")}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {days.map((d) => {
                const on = d.day === current.day;
                return (
                  <Pressable
                    key={d.day}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setDay(d.day)}
                    style={{
                      minHeight: 40,
                      justifyContent: "center",
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.brandLine : colors.lineControl,
                      backgroundColor: on ? colors.brandSoft : colors.surface,
                    }}
                  >
                    <Text style={{ ...type.medium, color: colors.ink }}>
                      {dayLabel(d.day + "T12:00:00+03:00", {
                        weekday: "short",
                        month: "short",
                      })}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.label}>{t("booking.pickTime")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {current.slots.map((s) => (
                <Button
                  key={s.startsAt}
                  secondary
                  size="sm"
                  onPress={() => setChosen(s)}
                  style={{ minWidth: 88 }}
                >
                  {timeLabel(s.startsAt)}
                </Button>
              ))}
            </View>
          </>
        )}
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
