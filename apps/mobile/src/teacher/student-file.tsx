import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { money, t, type MessageKey } from "@derslik/contracts";
import {
  Badge,
  Button,
  Card,
  confirmAction,
  Kicker,
  Metric,
  PackageCard,
  SectionHeading,
} from "../ui";
import { type TeacherCtx } from "./use-teacher-screen";

export function StudentFile({ ctx }: { ctx: TeacherCtx }) {
  const {
    colors,
    styles,
    data,
    setError,
    setSelected,
    setLearning,
    setForm,
    mutate,
    student,
    editStudent,
    newPackage,
    newLesson,
    newPayment,
    lessonCard,
    balance,
    studentPackages,
    remaining,
  } = ctx;
  if (!student) return null;
  return (
    <>
      <View style={[styles.row, { marginTop: -6 }]}>
        <Text style={styles.muted}>
          {[student.subject, student.grade].filter(Boolean).join(" · ")}
        </Text>
        {!student.active && <Badge>{t("detail.archived")}</Badge>}
      </View>
      <View style={styles.row}>
        <Metric
          label={t("mt.remainingLessons")}
          value={remaining}
          warn={remaining <= 2}
        />
        <Metric
          label={t("students.openBalance")}
          value={money(balance(student.id))}
        />
      </View>
      <Button icon="library-outline" onPress={() => setLearning(true)}>
        {t("mt.learningButton")}
      </Button>
      <View style={styles.row}>
        {(
          [
            ["common.edit", "create-outline", () => editStudent(student)],
            ["ws.planLesson", "calendar-outline", () => newLesson(student.id)],
            ["mt.addPackage", "cube-outline", () => newPackage(student.id)],
            ["mt.payment", "wallet-outline", () => newPayment(student.id)],
          ] as const satisfies readonly (readonly [MessageKey, ...unknown[]])[]
        ).map(([label, icon, action]) => (
          <Button
            key={label}
            secondary
            size="sm"
            icon={icon}
            onPress={action}
            style={{ flexGrow: 1, flexBasis: 140 }}
          >
            {t(label)}
          </Button>
        ))}
      </View>
      <Card tone="muted">
        <View style={[styles.row, { gap: 6 }]}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.brand} />
          <Kicker>{t("detail.privateNote")}</Kicker>
        </View>
        <Text style={styles.text}>
          {data.notes.find((n) => n.student_id === student.id)?.body ||
            t("mt.notePlaceholder")}
        </Text>
        <Button
          secondary
          size="sm"
          icon="create-outline"
          style={{ alignSelf: "flex-start" }}
          onPress={() => {
            const note = data.notes.find((n) => n.student_id === student.id);
            setForm({
              title: t("mt.noteTitle"),
              description: t("mt.noteHint"),
              fields: [
                {
                  key: "body",
                  label: t("mt.note"),
                  value: note?.body,
                  multiline: true,
                  required: false,
                },
              ],
              submit: async (v) => {
                await mutate({
                  action: "note.save",
                  studentId: student.id,
                  body: v.body,
                  version: note?.version || 0,
                });
              },
            });
          }}
        >
          {t("mt.editNote")}
        </Button>
      </Card>
      <SectionHeading title={t("mt.packages")} />
      {!studentPackages.length && (
        <Text style={styles.muted}>{t("detail.noPackages")}</Text>
      )}
      {studentPackages.map((p) => (
        <PackageCard key={p.id} pack={p}>
          <Text style={styles.caption}>
            {p.expires_on
              ? t("detail.lastDay", { date: p.expires_on })
              : t("detail.noExpiry")}
          </Text>
        </PackageCard>
      ))}
      <SectionHeading title={t("detail.lessonHistory")} />
      {data.lessons.filter((l) => l.student_id === student.id).map(lessonCard)}
      {student.active ? (
        <Button
          variant="danger"
          icon="archive-outline"
          onPress={() =>
            confirmAction(
              t("confirm.archiveTitle"),
              t("mt.archiveBody"),
              async () => {
                await mutate({
                  action: "student.archive",
                  id: student.id,
                  version: student.version,
                });
                setSelected(null);
              },
              setError,
            )
          }
        >
          {t("confirm.archiveTitle")}
        </Button>
      ) : (
        <Button
          secondary
          icon="arrow-undo-outline"
          onPress={() =>
            confirmAction(
              t("confirm.restoreTitle"),
              t("mt.restoreBody"),
              async () => {
                await mutate({
                  action: "student.restore",
                  id: student.id,
                  version: student.version,
                });
              },
              setError,
            )
          }
        >
          {t("confirm.restoreTitle")}
        </Button>
      )}
    </>
  );
}
