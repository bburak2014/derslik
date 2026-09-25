import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Access } from "@derslik/api-client";
import {
  addDays,
  emptyWorkspace,
  dateKey,
  dayLabel,
  money,
  parseLira,
  timeLabel,
  type WorkspaceData,
  type Student,
  type Lesson,
  type Command,
} from "@derslik/contracts";
import { request } from "./core";
import {
  Avatar,
  Badge,
  BottomTabs,
  Brand,
  Button,
  Card,
  confirmAction,
  DateTile,
  EmptyState,
  ErrorText,
  FormSheet,
  type FormSpec,
  IconButton,
  InkFigures,
  InkPanel,
  Input,
  Kicker,
  LessonStatus,
  List,
  ListRow,
  Loading,
  Metric,
  Picker,
  SectionHeading,
  Segmented,
  useTheme,
} from "./ui";
import {
  LearningScreen,
  Inbox,
  type NoticeFocus,
  type TeachingView,
} from "./LearningScreen";
import {
  compareText,
  lower,
  t,
  upper,
  type MessageKey,
  type NoticeTarget,
} from "@derslik/contracts";
const dateTime = (day: string, time: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error(t("mt.dateTimeFormat"));
  const date = new Date(`${day}T${time}:00+03:00`);
  if (Number.isNaN(date.getTime())) throw new Error(t("mt.dateInvalid"));
  return date.toISOString();
};
export function TeacherScreen({
  access,
  onAccount,
  focus,
  onNotice,
}: {
  access: Access;
  onAccount: () => void;
  /** Bildirimden açılacak yer ve bildirime dokununca çağrılan işlev. */
  focus?: NoticeFocus | null;
  onNotice?: (target: NoticeTarget) => void;
}) {
  const { colors, styles, section } = useTheme();
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("overview"),
    // Öğretim sekmesi: web'deki Ödevler / PDF / Videolar görünümlerinin
    // karşılığı. Hangi öğrencinin içeriği gösteriliyor, hangi bölüm açık.
    [teachingView, setTeachingView] = useState<TeachingView>("assignments"),
    [teachingStudent, setTeachingStudent] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [learning, setLearning] = useState(false),
    [search, setSearch] = useState(""),
    [day, setDay] = useState(dateKey()),
    [form, setForm] = useState<FormSpec | null>(null),
    [busy, setBusy] = useState(false),
    [unread, setUnread] = useState(0),
    // Bildirim: ödev ve videolar Öğretim sekmesinde o öğrenciyle, paylaşımlar
    // öğrencinin öğrenme alanında açılır (web ile aynı kural).
    [appliedFocus, setAppliedFocus] = useState(0),
    [teachingFocus, setTeachingFocus] = useState<NoticeFocus | null>(null),
    [learningFocus, setLearningFocus] = useState<NoticeFocus | null>(null);
  if (focus && focus.at !== appliedFocus && focus.workspaceId === access.id) {
    setAppliedFocus(focus.at);
    if (focus.section === "notes") {
      setSelected(focus.studentId);
      setLearning(true);
      setLearningFocus(focus);
    } else {
      setSelected(null);
      setLearning(false);
      setTab("teaching");
      setTeachingView(focus.section);
      setTeachingStudent(focus.studentId);
      setTeachingFocus(focus);
    }
  }
  const inFlight = useRef(false);
  // Zildeki sayaç için bildirimler sessizce alınır (web ile aynı); hata olursa
  // zil sayaçsız kalır. Bildirimler sekmesinden çıkınca yeniden sayılır.
  const inInbox = tab === "inbox";
  useEffect(() => {
    let alive = true;
    request<{ data: { readAt: string | null }[] }>("/inbox")
      .then((r) => {
        if (alive) setUnread(r.data.filter((n) => !n.readAt).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [inInbox]);
  const load = useCallback(async () => {
    try {
      setData(await request(`/workspaces/${access.id}/snapshot`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [access.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  async function mutate(command: Command) {
    if (inFlight.current) throw new Error(t("mt.busy"));
    inFlight.current = true;
    setBusy(true);
    try {
      await request(`/workspaces/${access.id}/commands`, command);
      await load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const student = data.students.find((s) => s.id === selected),
    active = data.students.filter((s) => s.active),
    studentOptions = active.map((s) => ({ value: s.id, label: s.name }));
  function editStudent(person?: Student) {
    setForm({
      title: person ? t("record.editStudent") : t("record.newStudent"),
      fields: [
        { key: "name", label: t("record.fullName"), value: person?.name },
        {
          key: "subject",
          label: t("record.subject"),
          value: person?.subject || t("record.defaultSubject"),
        },
        {
          key: "grade",
          label: t("mt.grade"),
          value: person?.grade,
          required: false,
        },
        {
          key: "phone",
          label: t("mt.phone"),
          value: person?.phone,
          required: false,
        },
        {
          key: "email",
          label: t("mt.email"),
          value: person?.email,
          keyboard: "email-address",
          required: false,
        },
      ],
      submit: async (v) => {
        const fields = {
          name: v.name,
          subject: v.subject,
          grade: v.grade,
          phone: v.phone,
          email: v.email,
        };
        await mutate(
          person
            ? {
                action: "student.update",
                id: person.id,
                version: person.version,
                ...fields,
              }
            : { action: "student.create", ...fields },
        );
      },
    });
  }
  function newPackage(id?: string) {
    if (!active.length) {
      editStudent();
      return;
    }
    setForm({
      title: t("record.addPackage"),
      description: t("mt.packageHint"),
      fields: [
        {
          key: "studentId",
          label: t("common.student"),
          value: id,
          options: studentOptions,
        },
        {
          key: "name",
          label: t("record.packageName"),
          value: t("mt.defaultPackage"),
        },
        {
          key: "granted",
          label: t("mt.lessonCount"),
          value: "8",
          keyboard: "decimal-pad",
        },
        { key: "price", label: t("mt.packagePrice"), keyboard: "decimal-pad" },
        {
          key: "expiresOn",
          label: t("mt.expiresField"),
          required: false,
        },
      ],
      submit: async (v) => {
        await mutate({
          action: "package.create",
          studentId: v.studentId,
          name: v.name,
          granted: Number(v.granted),
          priceMinor: parseLira(v.price),
          expiresOn: v.expiresOn || null,
        });
      },
    });
  }
  function newLesson(id?: string, makeup?: Lesson) {
    const packages = data.packages.filter(
      (p) =>
        p.remaining > 0 &&
        active.some((s) => s.id === p.student_id) &&
        (!id || p.student_id === id),
    );
    if (!packages.length) {
      newPackage(id);
      return;
    }
    setForm({
      title: makeup ? t("lesson.planMakeup") : t("ws.planLesson"),
      description: t("mt.timezoneNote"),
      fields: [
        {
          key: "packageId",
          label: t("mt.studentPackage"),
          options: packages.map((p) => ({
            value: p.id,
            label: `${data.students.find((s) => s.id === p.student_id)?.name} · ${p.name} (${t("common.creditCount", { count: p.remaining })})`,
          })),
        },
        { key: "topic", label: t("record.topic"), value: makeup?.topic },
        { key: "day", label: t("mt.dateField"), value: day },
        { key: "time", label: t("mt.timeField"), value: "16:00" },
        {
          key: "duration",
          label: t("record.duration"),
          value: "60",
          keyboard: "decimal-pad",
        },
        {
          key: "location",
          label: t("mt.location"),
          value: makeup?.location,
          required: false,
        },
        ...(!makeup
          ? [
              {
                key: "weeks",
                label: t("mt.repeatWeeks"),
                value: "1",
                options: [
                  { value: "1", label: t("record.single") },
                  { value: "4", label: t("mt.weeks", { count: 4 }) },
                  { value: "8", label: t("mt.weeks", { count: 8 }) },
                ],
              },
            ]
          : []),
      ],
      submit: async (v) => {
        const pack = packages.find((p) => p.id === v.packageId)!;
        await mutate({
          action: "lesson.create",
          studentId: pack.student_id,
          packageId: pack.id,
          topic: v.topic,
          startsAt: dateTime(v.day, v.time),
          duration: Number(v.duration),
          weeks: makeup ? 1 : Number(v.weeks),
          location: v.location,
          ...(makeup ? { makeupForId: makeup.id } : {}),
        });
      },
    });
  }
  function reschedule(l: Lesson) {
    setForm({
      title: t("mt.rescheduleTitle"),
      fields: [
        {
          key: "day",
          label: t("mt.dateField"),
          value: dateKey(l.starts_at),
        },
        {
          key: "time",
          label: t("mt.timeField"),
          value: new Intl.DateTimeFormat("tr-TR", {
            timeZone: "Europe/Istanbul",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(l.starts_at)),
        },
        {
          key: "duration",
          label: t("record.duration"),
          value: String(
            (Date.parse(l.ends_at) - Date.parse(l.starts_at)) / 60000,
          ),
          keyboard: "decimal-pad",
        },
      ],
      submit: async (v) => {
        await mutate({
          action: "lesson.reschedule",
          id: l.id,
          version: l.version,
          startsAt: dateTime(v.day, v.time),
          duration: Number(v.duration),
        });
      },
    });
  }
  function newPayment(id?: string) {
    if (!active.length) {
      editStudent();
      return;
    }
    setForm({
      title: t("record.recordPayment"),
      description: t("mt.paymentNote"),
      fields: [
        {
          key: "studentId",
          label: t("common.student"),
          value: id,
          options: data.students.map((s) => ({ value: s.id, label: s.name })),
        },
        { key: "amount", label: t("mt.amountField"), keyboard: "decimal-pad" },
        { key: "receivedOn", label: t("mt.dateField"), value: dateKey() },
        {
          key: "method",
          label: t("payments.method"),
          value: "TRANSFER",
          options: [
            { value: "TRANSFER", label: t("payments.methods.TRANSFER") },
            { value: "CASH", label: t("payments.methods.CASH") },
            { value: "OTHER", label: t("payments.methods.OTHER") },
          ],
        },
        { key: "reference", label: t("mt.reference"), required: false },
      ],
      submit: async (v) => {
        await mutate({
          action: "payment.create",
          studentId: v.studentId,
          amountMinor: parseLira(v.amount),
          receivedOn: v.receivedOn,
          method: v.method as "TRANSFER" | "CASH" | "OTHER",
          reference: v.reference,
        });
      },
    });
  }
  function lessonCard(l: Lesson) {
    const person = data.students.find((s) => s.id === l.student_id),
      pack = data.packages.find((p) => p.id === l.package_id);
    return (
      <Card key={l.id}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <DateTile date={l.starts_at} />
          <View style={{ flex: 1, gap: 3 }}>
            <View
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t("mt.openStudentHint")}
                onPress={() => setSelected(l.student_id)}
                hitSlop={4}
                style={{ flex: 1 }}
              >
                <Text style={styles.h2} numberOfLines={1}>
                  {person?.name}
                </Text>
              </Pressable>
              <LessonStatus status={l.status} />
            </View>
            <Text style={styles.text} numberOfLines={2}>
              {l.topic}
            </Text>
            <View style={[styles.row, { gap: 5, marginTop: 2 }]}>
              <Ionicons name="time-outline" size={14} color={colors.faint} />
              <Text style={styles.caption}>
                {timeLabel(l.starts_at)}–{timeLabel(l.ends_at)}
              </Text>
              <Text style={styles.caption}>·</Text>
              <Text style={styles.caption} numberOfLines={1}>
                {l.location || t("lesson.noLocation")}
              </Text>
              {!!pack && l.status === "SCHEDULED" && (
                <>
                  <Text style={styles.caption}>·</Text>
                  <Text style={styles.caption}>
                    {t("lesson.creditsLeft", { count: pack.remaining })}
                  </Text>
                </>
              )}
            </View>
            {!!l.makeup_for_id && (
              <View style={{ marginTop: 4 }}>
                <Badge tone="warning" icon="refresh">
                  {t("mt.makeupBadge")}
                </Badge>
              </View>
            )}
          </View>
        </View>
        {l.status === "SCHEDULED" ? (
          <View style={[styles.row, { marginTop: 2 }]}>
            <Button
              size="sm"
              icon="checkmark"
              disabled={busy}
              style={{ flexGrow: 1, flexBasis: "100%" }}
              onPress={() =>
                confirmAction(
                  t("confirm.completeTitle"),
                  t("mt.completeBody"),
                  () =>
                    mutate({
                      action: "lesson.complete",
                      id: l.id,
                      version: l.version,
                    }),
                  setError,
                )
              }
            >
              {t("mt.completeLesson")}
            </Button>
            <Button
              secondary
              size="sm"
              icon="calendar-outline"
              disabled={busy}
              onPress={() => reschedule(l)}
              style={{ flexGrow: 1 }}
            >
              {t("mt.changeTime")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon="close"
              disabled={busy}
              style={{ flexGrow: 1 }}
              onPress={() =>
                confirmAction(
                  t("mt.cancelTitle"),
                  t("mt.cancelBody"),
                  () =>
                    mutate({
                      action: "lesson.cancel",
                      id: l.id,
                      version: l.version,
                    }),
                  setError,
                )
              }
            >
              {t("mt.cancelLesson")}
            </Button>
          </View>
        ) : l.status === "COMPLETED" ? (
          <Button
            secondary
            size="sm"
            icon="arrow-undo-outline"
            disabled={busy}
            style={{ alignSelf: "flex-start" }}
            onPress={() =>
              confirmAction(
                t("confirm.reverseTitle"),
                t("mt.reverseBody"),
                () =>
                  mutate({
                    action: "lesson.reverse",
                    id: l.id,
                    version: l.version,
                  }),
                setError,
              )
            }
          >
            {t("confirm.reverseTitle")}
          </Button>
        ) : (
          <Button
            secondary
            size="sm"
            icon="refresh-outline"
            style={{ alignSelf: "flex-start" }}
            onPress={() => newLesson(l.student_id, l)}
          >
            {t("lesson.planMakeup")}
          </Button>
        )}
      </Card>
    );
  }
  if (loading) return <Loading />;
  if (learning && student)
    return (
      <LearningScreen
        access={access}
        studentId={student.id}
        studentName={student.name}
        onBack={() => {
          setLearning(false);
          setLearningFocus(null);
        }}
        focus={learningFocus}
      />
    );
  const balance = (id?: string) =>
    data.packages
      .filter((p) => !id || p.student_id === id)
      .reduce((n, p) => n + Number(p.price_minor), 0) -
    data.payments
      .filter((p) => !p.voided_at && (!id || p.student_id === id))
      .reduce((n, p) => n + Number(p.amount_minor), 0);
  // Özet, web'deki Genel bakış ile aynı: bugünün dersleri varsa onlar, yoksa
  // bitmemiş en yakın dört ders.
  const today = dateKey(),
    todayLessons = data.lessons
      .filter((l) => dateKey(l.starts_at) === today)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    now = new Date().toISOString(),
    upcoming = data.lessons
      .filter((l) => l.status === "SCHEDULED" && l.ends_at >= now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    shown = todayLessons.length ? todayLessons : upcoming.slice(0, 4);
  const title =
    tab === "overview"
      ? t("portal.studentNote1") + "\n" + t("portal.studentNote2")
      : tab === "students"
        ? t("ws.studentsTitle")
        : tab === "calendar"
          ? t("nav.calendar")
          : tab === "payments"
            ? t("nav.payments")
            : tab === "teaching"
              ? t("mt.teaching")
              : t("mt.notifications");
  const header = (
    <View style={styles.header}>
      {student ? (
        <Button
          variant="ghost"
          size="sm"
          icon="chevron-back"
          onPress={() => setSelected(null)}
          style={{ marginLeft: -10 }}
        >
          {t("nav.students")}
        </Button>
      ) : (
        <Brand />
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton
          ghost
          icon="notifications-outline"
          label={t("mt.notifications")}
          selected={tab === "inbox" && !student}
          count={unread}
          onPress={() => {
            setSelected(null);
            setTab("inbox");
          }}
        />
        <Button
          secondary
          size="sm"
          icon="person-circle-outline"
          onPress={onAccount}
        >
          {t("mt.myAccount")}
        </Button>
      </View>
    </View>
  );
  // Alt gezinme iki yerden çiziliyor (normal görünüm ve Öğretim ekranı), o
  // yüzden tek yerde duruyor. Öğrenci dosyası açıkken gizlenir.
  const tabBar = !student && (
    <BottomTabs
      value={tab}
      onChange={setTab}
      items={[
        { id: "overview", label: t("mt.tabOverview"), icon: "grid-outline" },
        {
          id: "calendar",
          label: t("mt.tabCalendar"),
          icon: "calendar-outline",
        },
        { id: "students", label: t("nav.students"), icon: "people-outline" },
        { id: "payments", label: t("nav.payments"), icon: "wallet-outline" },
        { id: "teaching", label: t("mt.teaching"), icon: "school-outline" },
      ]}
    />
  );
  // Öğretim ekranı: webde sol menüdeki Ödevler / PDF ve dosyalar / Ders
  // videoları başlıklarının karşılığı. Mobilde alt çubukta tek sekme, içinde
  // öğrenci seçici ve bölüm segmenti var.
  if (tab === "teaching") {
    const roster = [...data.students].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || compareText(a.name, b.name),
    );
    const chosen = roster.find((x) => x.id === teachingStudent) || roster[0];
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        {header}
        {!chosen ? (
          <View style={styles.body}>
            <EmptyState
              icon="people-outline"
              title={t("hub.emptyTitle")}
              description={t("mt.teachingEmpty")}
            />
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 10 }}>
              <Picker
                label={t("common.student")}
                value={chosen.id}
                onChange={(id) => {
                  setTeachingStudent(id);
                  setTeachingFocus(null);
                }}
                options={roster.map((x) => ({
                  value: x.id,
                  label: x.name + (x.active ? "" : " · " + t("hub.archived")),
                  hint: x.subject,
                }))}
              />
              <Segmented
                label={t("mt.section")}
                value={teachingView}
                onChange={(value) => {
                  setTeachingView(value as TeachingView);
                  setTeachingFocus(null);
                }}
                options={[
                  {
                    value: "assignments",
                    label: t("nav.assignments"),
                    icon: "clipboard-outline",
                  },
                  { value: "files", label: "PDF", icon: "document-outline" },
                  {
                    value: "videos",
                    label: t("mt.videos"),
                    icon: "videocam-outline",
                  },
                ]}
              />
            </View>
            <LearningScreen
              key={chosen.id + ":" + teachingView}
              access={access}
              studentId={chosen.id}
              studentName={chosen.name}
              onBack={onAccount}
              view={teachingView}
              focus={teachingFocus}
            />
          </>
        )}
        {tabBar}
        <FormSheet form={form} onClose={() => setForm(null)} />
      </SafeAreaView>
    );
  }

  const studentPackages = student
      ? data.packages.filter((p) => p.student_id === student.id)
      : [],
    remaining = studentPackages.reduce((n, p) => n + p.remaining, 0),
    lowPackages = data.packages.filter(
      (p) =>
        p.remaining <= 2 &&
        active.some((s) => s.id === p.student_id) &&
        (!p.expires_on || p.expires_on >= today),
    );
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {header}
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            colors={[colors.brand]}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {student ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Avatar name={student.name} size={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <Kicker>{t("mt.studentFile")}</Kicker>
              <Text style={styles.title} numberOfLines={2}>
                {student.name}
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Kicker>{access.name}</Kicker>
            <Text style={styles.title}>{title}</Text>
          </View>
        )}
        <ErrorText message={error} />
        {!!error && (
          <Button
            secondary
            icon="refresh-outline"
            style={{ alignSelf: "flex-start" }}
            onPress={() => void load()}
          >
            {t("common.retry")}
          </Button>
        )}
        {student ? (
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
                  [
                    "ws.planLesson",
                    "calendar-outline",
                    () => newLesson(student.id),
                  ],
                  [
                    "mt.addPackage",
                    "cube-outline",
                    () => newPackage(student.id),
                  ],
                  [
                    "mt.payment",
                    "wallet-outline",
                    () => newPayment(student.id),
                  ],
                ] as const satisfies readonly (readonly [
                  MessageKey,
                  ...unknown[],
                ])[]
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
                <Ionicons
                  name="lock-closed-outline"
                  size={13}
                  color={colors.brand}
                />
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
                  const note = data.notes.find(
                    (n) => n.student_id === student.id,
                  );
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
              <Card key={p.id}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <Text style={[styles.h2, { flex: 1 }]}>{p.name}</Text>
                  <Badge
                    tone={p.remaining <= 2 ? "warning" : "info"}
                    icon={p.remaining <= 2 ? "alert-circle-outline" : undefined}
                  >
                    {t("common.creditCount", { count: p.remaining })}
                  </Badge>
                </View>
                <Text style={styles.muted}>
                  {t("mt.creditsOf", {
                    remaining: p.remaining,
                    granted: p.granted,
                  })}{" "}
                  · {money(p.price_minor)}
                </Text>
                <Text style={styles.caption}>
                  {p.expires_on
                    ? t("detail.lastDay", { date: p.expires_on })
                    : t("detail.noExpiry")}
                </Text>
              </Card>
            ))}
            <SectionHeading title={t("detail.lessonHistory")} />
            {data.lessons
              .filter((l) => l.student_id === student.id)
              .map(lessonCard)}
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
        ) : tab === "overview" ? (
          <>
            <Text style={[styles.muted, { marginTop: -6 }]}>
              {t("ws.overviewSubtitle")}
            </Text>
            {/* Web'deki Bugün paneli: tarih, günün sayıları ve takvim kısayolu
                tek bir mürekkep şeritte. */}
            <InkPanel>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
              >
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
                  <Text
                    style={[styles.muted, { color: colors.onFeatureMuted }]}
                  >
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
                  todayLessons.length
                    ? t("mt.todayLessons")
                    : t("mt.nextLessons")
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
                    const person = data.students.find(
                      (s) => s.id === p.student_id,
                    )!;
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
        ) : tab === "students" ? (
          <>
            <Input
              icon="search"
              accessibilityLabel={t("ws.searchStudents")}
              value={search}
              onChangeText={setSearch}
              placeholder={t("mt.searchPlaceholder")}
              autoCorrect={false}
              returnKeyType="search"
            />
            <Button icon="person-add-outline" onPress={() => editStudent()}>
              {t("ws.addStudent")}
            </Button>
            {(() => {
              const found = data.students.filter((s) =>
                lower(`${s.name} ${s.subject}`).includes(lower(search)),
              );
              if (!found.length)
                return (
                  <EmptyState
                    icon="people-outline"
                    title={
                      data.students.length
                        ? t("mt.noMatchTitle")
                        : t("record.noStudents")
                    }
                    description={
                      data.students.length
                        ? t("mt.noMatchText")
                        : t("mt.noStudentsText")
                    }
                  />
                );
              return (
                <List>
                  {found.map((s, i) => {
                    const open = balance(s.id);
                    return (
                      <ListRow
                        key={s.id}
                        divider={i > 0}
                        accessibilityLabel={s.name}
                        onPress={() => setSelected(s.id)}
                      >
                        <Avatar name={s.name} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.h2} numberOfLines={1}>
                            {s.name}
                          </Text>
                          <Text style={styles.caption} numberOfLines={1}>
                            {[s.subject, s.grade].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        {!s.active ? (
                          <Badge>{t("hub.archived")}</Badge>
                        ) : open > 0 ? (
                          <Badge tone="warning">{money(open)}</Badge>
                        ) : null}
                        <Ionicons
                          name="chevron-forward"
                          size={17}
                          color={colors.faint}
                        />
                      </ListRow>
                    );
                  })}
                </List>
              );
            })()}
          </>
        ) : tab === "calendar" ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>{t("mt.date")}</Text>
              <View style={[styles.row, { flexWrap: "nowrap" }]}>
                <IconButton
                  icon="chevron-back"
                  label={t("mt.prevDay")}
                  onPress={() => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(day))
                      setDay(addDays(day, -1));
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
                    if (/^\d{4}-\d{2}-\d{2}$/.test(day))
                      setDay(addDays(day, 1));
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
        ) : tab === "payments" ? (
          <>
            <InkPanel>
              <Text style={[section.figureLabel, { color: colors.marker }]}>
                {upper(t("mt.totalBalance"))}
              </Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  styles.title,
                  { color: colors.onFeature, marginTop: -8 },
                ]}
              >
                {money(balance())}
              </Text>
              <Text
                style={[
                  styles.muted,
                  { color: colors.onFeatureMuted, marginTop: -8 },
                ]}
              >
                {t("mt.balanceNote")}
              </Text>
            </InkPanel>
            <Button icon="add" onPress={() => newPayment()}>
              {t("record.recordPayment")}
            </Button>
            {!data.payments.length && (
              <EmptyState
                icon="wallet-outline"
                title={t("mt.paymentsEmptyTitle")}
                description={t("mt.paymentsEmptyText")}
              />
            )}
            {data.payments.map((p) => {
              const person = data.students.find((s) => s.id === p.student_id);
              return (
                <Card key={p.id}>
                  <View style={[styles.row, { flexWrap: "nowrap", gap: 12 }]}>
                    <Avatar name={person?.name || "?"} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.h2} numberOfLines={1}>
                        {person?.name}
                      </Text>
                      <Text style={styles.caption}>
                        {dayLabel(p.received_on + "T12:00:00+03:00", {
                          year: "numeric",
                        })}{" "}
                        ·{" "}
                        {t(
                          p.method === "CASH" || p.method === "TRANSFER"
                            ? `payments.methods.${p.method}`
                            : "payments.methods.OTHER",
                        )}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 5 }}>
                      <Text
                        style={[
                          styles.h2,
                          { fontVariant: ["tabular-nums"] },
                          !!p.voided_at && {
                            color: colors.muted,
                            textDecorationLine: "line-through",
                          },
                        ]}
                      >
                        {money(p.amount_minor)}
                      </Text>
                      <Badge
                        tone={p.voided_at ? "neutral" : "success"}
                        icon={p.voided_at ? undefined : "checkmark"}
                      >
                        {p.voided_at ? t("mt.voided") : t("payments.recorded")}
                      </Badge>
                    </View>
                  </View>
                  {!!p.reference && (
                    <Text style={styles.muted}>{p.reference}</Text>
                  )}
                  {!p.voided_at && (
                    <Button
                      variant="danger"
                      size="sm"
                      icon="close"
                      disabled={busy}
                      style={{ alignSelf: "flex-start" }}
                      onPress={() =>
                        confirmAction(
                          t("confirm.voidTitle"),
                          t("mt.voidBody"),
                          () =>
                            mutate({
                              action: "payment.void",
                              id: p.id,
                              version: p.version,
                            }),
                          setError,
                        )
                      }
                    >
                      {t("payments.void")}
                    </Button>
                  )}
                </Card>
              );
            })}
          </>
        ) : (
          <Inbox
            workspaceId={access.id}
            onUnread={setUnread}
            onOpen={onNotice}
          />
        )}
      </ScrollView>
      {tabBar}
      <FormSheet form={form} onClose={() => setForm(null)} />
    </SafeAreaView>
  );
}
