import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Access } from "@derslik/api-client";
import {
  emptyWorkspace,
  dateKey,
  isDateKey,
  parseLira,
  timeLabel,
  type WorkspaceData,
  type Student,
  type Lesson,
  type Command,
  t,
  type NoticeTarget,
} from "@derslik/contracts";
import { client, request } from "../core";
import {
  Badge,
  BottomTabs,
  Brand,
  Button,
  Card,
  confirmAction,
  DateTile,
  type FormSpec,
  IconButton,
  LessonStatus,
  useTheme,
} from "../ui";
import { type NoticeFocus, type TeachingView } from "../LearningScreen";
import { useMessages } from "../messages";

export const dateTime = (day: string, time: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error(t("mt.dateTimeFormat"));
  // 2026-02-31 would otherwise roll over to 3 March without a word.
  if (!isDateKey(day)) throw new Error(t("mt.dateInvalid"));
  const date = new Date(`${day}T${time}:00+03:00`);
  if (Number.isNaN(date.getTime())) throw new Error(t("mt.dateInvalid"));
  return date.toISOString();
};

export type TeacherScreenProps = {
  access: Access;
  onAccount: () => void;
  /** Bildirimden açılacak yer ve bildirime dokununca çağrılan işlev. */
  focus?: NoticeFocus | null;
  onNotice?: (target: NoticeTarget) => void;
};

/** TeacherScreen'in durumu, işlemleri ve ortak parçaları; bölümler bunu
 *  `ctx` olarak alır. */
export function useTeacherScreen({
  access,
  onAccount,
  focus,
  onNotice,
}: TeacherScreenProps) {
  const { colors, styles, section } = useTheme();
  const { width, fontScale } = useWindowDimensions();
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
    [learningFocus, setLearningFocus] = useState<NoticeFocus | null>(null),
    // Vitrin: bekleyen ders isteği sayısı ve bildirimden gelinen istek.
    [requests, setRequests] = useState(0),
    [showcaseFocus, setShowcaseFocus] = useState<string | null>(null),
    // Mesaj okununca o yazışmanın bildirimleri de okunur; zil yeniden sayılır.
    [noticeTick, setNoticeTick] = useState(0);
  // Mesajlar: yazışma listesi, açık yazışma ve başlıktaki okunmamış sayacı.
  const messages = useMessages(`/workspaces/${access.id}/messages`);
  if (focus && focus.at !== appliedFocus && focus.workspaceId === access.id) {
    setAppliedFocus(focus.at);
    if (focus.section === "requests") {
      setSelected(null);
      setLearning(false);
      setTab("showcase");
      setShowcaseFocus(focus.itemId);
    } else if (focus.section === "myRequests") {
      // Öğrencinin kendi istekleri; öğretmen görünümünde açılacak yer yok.
    } else if (focus.section === "messages") {
      // Mesaj bildirimi: yazışma Mesajlar ekranında açılır.
      setSelected(null);
      setLearning(false);
      messages.setSearch("");
      messages.setStudentFilter(null);
      messages.setOpen(focus.itemId);
      setTab("messages");
    } else if (focus.section === "lessons") {
      // Ders hatırlatması: takvim o dersin gününde açılır.
      const lesson = data.lessons.find((l) => l.id === focus.itemId);
      setSelected(null);
      setLearning(false);
      setDay(dateKey(lesson?.starts_at));
      setTab("calendar");
    } else if (focus.section === "notes") {
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
  // zil sayaçsız kalır. Bildirimler sekmesinden çıkınca ve bir yazışma
  // okununca yeniden sayılır.
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
  }, [inInbox, noticeTick]);
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
  // Vitrin simgesindeki sayaç; vitrin açılınca ekran kendisi günceller.
  useEffect(() => {
    let alive = true;
    client
      .showcase(access.id)
      .then((r) => {
        if (alive)
          setRequests(
            r.data.requests.filter((x) => x.status === "PENDING").length,
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [access.id]);
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
  /** Öğrenci dosyasındaki Mesajlar düğmesi: liste o öğrenciyle süzülür; tek
   *  yazışma varsa o da açılır, birden çok varsa (öğrenci ve veliler) süzülmüş
   *  liste görünür. Karar güncel listeyle verilir (az önce erişim verilmiş
   *  olabilir); liste de böylece yenilenir. Bağlı hesap yoksa false döner. */
  async function messageStudent(person: Student) {
    const own = (await messages.reload()).filter(
      (x) => x.studentId === person.id,
    );
    if (!own.length) return false;
    setSelected(null);
    setLearning(false);
    messages.setSearch("");
    messages.setUnreadOnly(false);
    // Süzgeç tek yazışmada da kurulur: geri dönünce liste bu öğrenciyle
    // sınırlı kalır (web'deki gibi).
    messages.setStudentFilter({ id: person.id, name: person.name });
    messages.setOpen(own.length === 1 ? own[0].linkId : null);
    setTab("messages");
    return true;
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
    // Arşivdeki öğrenciden de tahsilat alınır (web'deki gibi).
    if (!data.students.length) {
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
            {!!l.booked_by && (
              <View style={{ marginTop: 4 }}>
                <Badge tone="info" icon="person-outline">
                  {t("booking.bookedByStudent")}
                </Badge>
              </View>
            )}
          </View>
        </View>
        {lessonActions(l)}
      </Card>
    );
  }
  function lessonActions(l: Lesson) {
    if (l.status === "SCHEDULED")
      return (
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
      );
    if (l.status === "COMPLETED")
      return (
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
      );
    return (
      <Button
        secondary
        size="sm"
        icon="refresh-outline"
        style={{ alignSelf: "flex-start" }}
        onPress={() => newLesson(l.student_id, l)}
      >
        {t("lesson.planMakeup")}
      </Button>
    );
  }
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
  const title = tabTitle(tab);
  // Dar ekranda marka, üç simge ve "Hesabım" yazısı yan yana sığmıyor: telefonda
  // hesap düğmesi simgeye döner; çok dar ekranda (ya da büyük yazıda) marka
  // yalnızca işaretiyle, öğrenci dosyasının geri düğmesi yazısız çizilir.
  // Adlar ekran okuyucuda kalır. Ölçü: kenar boşlukları 40, dört simge 200,
  // marka 121 (toplam 373), "Öğrenciler" geri düğmesi 112 (toplam 364) px.
  const scale = Math.max(1, fontScale),
    phone = width < 520,
    tight = width < 380 * scale,
    narrow = width < 370 * scale;
  function headerLead() {
    if (student && narrow)
      return (
        <IconButton
          ghost
          icon="chevron-back"
          label={t("nav.students")}
          onPress={() => setSelected(null)}
        />
      );
    if (student)
      return (
        <Button
          variant="ghost"
          size="sm"
          icon="chevron-back"
          onPress={() => setSelected(null)}
          style={{ marginLeft: -10 }}
        >
          {t("nav.students")}
        </Button>
      );
    return <Brand compact={tight} />;
  }
  const header = (
    <View style={styles.header}>
      {headerLead()}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton
          ghost
          icon="storefront-outline"
          label={t("nav.showcase")}
          selected={tab === "showcase" && !student}
          count={requests}
          onPress={() => {
            setSelected(null);
            setShowcaseFocus(null);
            setTab("showcase");
          }}
        />
        <IconButton
          ghost
          icon="chatbubbles-outline"
          label={t("chat.title")}
          selected={tab === "messages" && !student}
          count={messages.badge}
          onPress={() => {
            setSelected(null);
            messages.setOpen(null);
            messages.setSearch("");
            messages.setStudentFilter(null);
            setTab("messages");
          }}
        />
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
        {phone ? (
          <IconButton
            icon="person-circle-outline"
            label={t("mt.myAccount")}
            onPress={onAccount}
          />
        ) : (
          <Button
            secondary
            size="sm"
            icon="person-circle-outline"
            onPress={onAccount}
          >
            {t("mt.myAccount")}
          </Button>
        )}
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
  return {
    access,
    onAccount,
    focus,
    onNotice,
    colors,
    styles,
    section,
    data,
    setData,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
    error,
    setError,
    tab,
    setTab,
    teachingView,
    setTeachingView,
    teachingStudent,
    setTeachingStudent,
    selected,
    setSelected,
    learning,
    setLearning,
    search,
    setSearch,
    day,
    setDay,
    form,
    setForm,
    busy,
    setBusy,
    unread,
    setUnread,
    appliedFocus,
    setAppliedFocus,
    teachingFocus,
    setTeachingFocus,
    learningFocus,
    setLearningFocus,
    requests,
    setRequests,
    showcaseFocus,
    setShowcaseFocus,
    messages,
    messageStudent,
    setNoticeTick,
    inFlight,
    inInbox,
    load,
    mutate,
    student,
    active,
    studentOptions,
    editStudent,
    newPackage,
    newLesson,
    reschedule,
    newPayment,
    lessonCard,
    balance,
    today,
    todayLessons,
    now,
    upcoming,
    shown,
    title,
    header,
    tabBar,
    studentPackages,
    remaining,
    lowPackages,
  };
}
export type TeacherCtx = ReturnType<typeof useTeacherScreen>;

function tabTitle(tab: string) {
  if (tab === "overview")
    return t("portal.studentNote1") + "\n" + t("portal.studentNote2");
  if (tab === "students") return t("ws.studentsTitle");
  if (tab === "calendar") return t("nav.calendar");
  if (tab === "payments") return t("nav.payments");
  if (tab === "teaching") return t("mt.teaching");
  if (tab === "messages") return t("chat.title");
  return t("mt.notifications");
}
