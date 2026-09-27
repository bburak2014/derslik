import { Text, View } from "react-native";
import { dayLabel, money, t } from "@derslik/contracts";
import {
  Avatar,
  Button,
  DateTile,
  EmptyState,
  InkFigures,
  InkPanel,
  List,
  ListRow,
  SectionHeading,
} from "../ui";
import { type TeacherCtx } from "./use-teacher-screen";

export function Overview({ ctx }: { ctx: TeacherCtx }) {
  const {
    colors,
    styles,
    section,
    data,
    setTab,
    active,
    editStudent,
    newPackage,
    newLesson,
    lessonCard,
    balance,
    todayLessons,
    now,
    shown,
    lowPackages,
  } = ctx;
  return (
    <>
      <Text style={[styles.muted, { marginTop: -6 }]}>
        {t("ws.overviewSubtitle")}
      </Text>
      {/* Web'deki Bugün paneli: tarih, günün sayıları ve takvim kısayolu
                tek bir mürekkep şeritte. */}
      <InkPanel>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <DateTile date={now} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[
                section.sectionTitle,
                { fontSize: 22, lineHeight: 28, color: colors.onFeature },
              ]}
            >
              {t("common.today")}
            </Text>
            <Text style={[styles.muted, { color: colors.onFeatureMuted }]}>
              {dayLabel(now, { weekday: "long", year: "numeric" })}
            </Text>
          </View>
        </View>
        <InkFigures
          items={[
            {
              label: t("overview.figureLessons"),
              value: todayLessons.filter((l) => l.status !== "CANCELLED")
                .length,
            },
            {
              label: t("overview.figureCompleted"),
              value: todayLessons.filter((l) => l.status === "COMPLETED")
                .length,
            },
            { label: t("overview.figureActive"), value: active.length },
            { label: t("mt.figurePending"), value: money(balance()) },
          ]}
        />
        <Button
          variant="onInk"
          size="sm"
          trailingIcon="arrow-forward"
          style={{ alignSelf: "flex-start" }}
          onPress={() => setTab("calendar")}
        >
          {t("mt.goCalendar")}
        </Button>
      </InkPanel>
      <Button icon="add" onPress={() => newLesson()}>
        {t("ws.planLesson")}
      </Button>
      {!active.length && (
        <EmptyState
          icon="school-outline"
          title={t("mt.firstStudentTitle")}
          description={t("mt.firstStudentText")}
          action={
            <Button
              size="sm"
              icon="person-add-outline"
              onPress={() => editStudent()}
            >
              {t("overview.addFirstStudent")}
            </Button>
          }
        />
      )}
      {!!active.length && (
        <SectionHeading
          title={
            todayLessons.length ? t("mt.todayLessons") : t("mt.nextLessons")
          }
          description={
            todayLessons.length ? undefined : t("mt.nextLessonsHint")
          }
        />
      )}
      {shown.map(lessonCard)}
      {!shown.length && !!active.length && (
        <EmptyState
          icon="calendar-outline"
          title={t("mt.noLessonsTitle")}
          description={t("mt.noLessonsText")}
        />
      )}
      {!!lowPackages.length && (
        <>
          <SectionHeading
            title={t("mt.lowPackages")}
            description={t("mt.lowPackagesHint")}
          />
          <List>
            {lowPackages.map((p, i) => {
              const person = data.students.find((s) => s.id === p.student_id)!;
              return (
                <ListRow key={p.id} divider={i > 0}>
                  <Avatar name={person.name} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.h2} numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Text style={styles.caption} numberOfLines={1}>
                      {p.name} ·{" "}
                      {t("mt.creditsOf", {
                        remaining: p.remaining,
                        granted: p.granted,
                      })}
                    </Text>
                  </View>
                  <Button
                    secondary
                    size="sm"
                    onPress={() => newPackage(p.student_id)}
                  >
                    {t("mt.addPackage")}
                  </Button>
                </ListRow>
              );
            })}
          </List>
        </>
      )}
    </>
  );
}
