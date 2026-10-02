import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { addDays, dateKey, dayLabel, isDateKey, t } from "@derslik/contracts";
import { Button, EmptyState, IconButton, Input } from "../ui";
import { CalendarFeed } from "../calendar-feed";
import { client } from "../core";
import { AvailabilitySheet } from "./availability";
import { type TeacherCtx } from "./use-teacher-screen";

export function CalendarSection({ ctx }: Readonly<{ ctx: TeacherCtx }>) {
  const { styles, data, day, setDay, newLesson, lessonCard, access } = ctx;
  const [availability, setAvailability] = useState(false),
    [enabled, setEnabled] = useState<boolean | null>(null);
  // Düğmede ayarlamanın açık mı kapalı mı olduğu görünür.
  useEffect(() => {
    let alive = true;
    client
      .booking(access.id)
      .then((r) => {
        if (alive) setEnabled(r.data.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [access.id]);
  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>{t("mt.date")}</Text>
        <View style={[styles.row, { flexWrap: "nowrap" }]}>
          <IconButton
            icon="chevron-back"
            label={t("mt.prevDay")}
            onPress={() => {
              if (isDateKey(day)) setDay(addDays(day, -1));
            }}
          />
          <View style={{ flex: 1 }}>
            <Input
              value={day}
              onChangeText={setDay}
              accessibilityLabel={t("mt.calendarDate")}
              placeholder={t("mt.datePattern")}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              style={{ textAlign: "center" }}
            />
          </View>
          <IconButton
            icon="chevron-forward"
            label={t("mt.nextDay")}
            onPress={() => {
              if (isDateKey(day)) setDay(addDays(day, 1));
            }}
          />
        </View>
        <Text style={styles.hint}>
          {isDateKey(day)
            ? dayLabel(day + "T12:00:00+03:00", {
                weekday: "long",
                year: "numeric",
              })
            : t("mt.dateFormatHint")}
        </Text>
      </View>
      <View style={[styles.row, { gap: 8 }]}>
        <Button icon="add" onPress={() => newLesson()} style={{ flex: 1 }}>
          {t("ws.planLesson")}
        </Button>
        <Button
          secondary
          icon="time-outline"
          onPress={() => setAvailability(true)}
          style={{ flex: 1 }}
        >
          {enabled === null
            ? t("booking.availability")
            : `${t("booking.availability")} · ${enabled ? t("booking.on") : t("booking.off")}`}
        </Button>
      </View>
      <AvailabilitySheet
        visible={availability}
        workspaceId={access.id}
        onClose={() => setAvailability(false)}
        onSaved={(saved) => setEnabled(saved.enabled)}
      />
      <CalendarFeed />
      {data.lessons
        .filter((l) => dateKey(l.starts_at) === day)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map(lessonCard)}
      {!data.lessons.some((l) => dateKey(l.starts_at) === day) && (
        <EmptyState
          icon="calendar-clear-outline"
          title={t("mt.dayEmptyTitle")}
          description={t("mt.dayEmptyText")}
        />
      )}
    </>
  );
}
