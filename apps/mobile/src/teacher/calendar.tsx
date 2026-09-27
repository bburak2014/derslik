import { Text, View } from "react-native";
import { addDays, dateKey, dayLabel, t } from "@derslik/contracts";
import { Button, EmptyState, IconButton, Input } from "../ui";
import { type TeacherCtx } from "./use-teacher-screen";

export function CalendarSection({ ctx }: { ctx: TeacherCtx }) {
  const { styles, data, day, setDay, newLesson, lessonCard } = ctx;
  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>{t("mt.date")}</Text>
        <View style={[styles.row, { flexWrap: "nowrap" }]}>
          <IconButton
            icon="chevron-back"
            label={t("mt.prevDay")}
            onPress={() => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setDay(addDays(day, -1));
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
              if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setDay(addDays(day, 1));
            }}
          />
        </View>
        <Text style={styles.hint}>
          {/^\d{4}-\d{2}-\d{2}$/.test(day)
            ? dayLabel(day + "T12:00:00+03:00", {
                weekday: "long",
                year: "numeric",
              })
            : t("mt.dateFormatHint")}
        </Text>
      </View>
      <Button icon="add" onPress={() => newLesson()}>
        {t("ws.planLesson")}
      </Button>
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
