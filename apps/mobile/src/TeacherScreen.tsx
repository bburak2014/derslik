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
import type { NoticeTarget } from "@derslik/contracts";
const dateTime = (day: string, time: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error("Tarihi YYYY-AA-GG, saati SS:DD biçiminde girin.");
  const date = new Date(`${day}T${time}:00+03:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Tarih geçersiz.");
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
    void load();
  }, [load]);
  async function mutate(command: Command) {
    if (inFlight.current) throw new Error("Önceki işlem tamamlanıyor.");
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
      title: person ? "Öğrenciyi düzenle" : "Yeni öğrenci",
      fields: [
        { key: "name", label: "Ad soyad", value: person?.name },
        {
          key: "subject",
          label: "Ders",
          value: person?.subject || "Matematik",
        },
        { key: "grade", label: "Sınıf", value: person?.grade, required: false },
        {
          key: "phone",
          label: "Telefon",
          value: person?.phone,
          required: false,
        },
        {
          key: "email",
          label: "E-posta",
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
      title: "Ders paketi ekle",
      description: "Tek ders ücreti için ders sayısını 1 girin.",
      fields: [
        {
          key: "studentId",
          label: "Öğrenci",
          value: id,
          options: studentOptions,
        },
        { key: "name", label: "Paket adı", value: "Aylık ders paketi" },
        {
          key: "granted",
          label: "Ders sayısı",
          value: "8",
          keyboard: "decimal-pad",
        },
        { key: "price", label: "Paket ücreti (₺)", keyboard: "decimal-pad" },
        {
          key: "expiresOn",
          label: "Son gün (YYYY-AA-GG, isteğe bağlı)",
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
      title: makeup ? "Telafi dersi planla" : "Ders planla",
      description: "Tüm ders saatleri İstanbul saatidir.",
      fields: [
        {
          key: "packageId",
          label: "Öğrenci / paket",
          options: packages.map((p) => ({
            value: p.id,
            label: `${data.students.find((s) => s.id === p.student_id)?.name} · ${p.name} (${p.remaining} hak)`,
          })),
        },
        { key: "topic", label: "Ders konusu", value: makeup?.topic },
        { key: "day", label: "Tarih (YYYY-AA-GG)", value: day },
        { key: "time", label: "Saat (SS:DD)", value: "16:00" },
        {
          key: "duration",
          label: "Süre (dakika)",
          value: "60",
          keyboard: "decimal-pad",
        },
        {
          key: "location",
          label: "Konum",
          value: makeup?.location,
          required: false,
        },
        ...(!makeup
          ? [
              {
                key: "weeks",
                label: "Kaç hafta tekrar?",
                value: "1",
                options: [
                  { value: "1", label: "Tek ders" },
                  { value: "4", label: "4 hafta" },
                  { value: "8", label: "8 hafta" },
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
      title: "Dersi yeniden planla",
      fields: [
        {
          key: "day",
          label: "Tarih (YYYY-AA-GG)",
          value: dateKey(l.starts_at),
        },
        {
          key: "time",
          label: "Saat (SS:DD)",
          value: new Intl.DateTimeFormat("tr-TR", {
            timeZone: "Europe/Istanbul",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(l.starts_at)),
        },
        {
          key: "duration",
          label: "Süre (dakika)",
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
      title: "Tahsilat kaydet",
      description: "Bu kayıt alınan ödemeyi izler; bankadan para çekmez.",
      fields: [
        {
          key: "studentId",
          label: "Öğrenci",
          value: id,
          options: data.students.map((s) => ({ value: s.id, label: s.name })),
        },
        { key: "amount", label: "Alınan tutar (₺)", keyboard: "decimal-pad" },
        { key: "receivedOn", label: "Tarih (YYYY-AA-GG)", value: dateKey() },
        {
          key: "method",
          label: "Yöntem",
          value: "TRANSFER",
          options: [
            { value: "TRANSFER", label: "Havale" },
            { value: "CASH", label: "Nakit" },
            { value: "OTHER", label: "Diğer" },
          ],
        },
        { key: "reference", label: "Açıklama", required: false },
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
                accessibilityHint="Öğrenci dosyasını açar"
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
                {l.location || "Konum belirtilmedi"}
              </Text>
              {!!pack && l.status === "SCHEDULED" && (
                <>
                  <Text style={styles.caption}>·</Text>
                  <Text style={styles.caption}>{pack.remaining} hak kaldı</Text>
                </>
              )}
            </View>
            {!!l.makeup_for_id && (
              <View style={{ marginTop: 4 }}>
                <Badge tone="warning" icon="refresh">
                  Telafi dersi
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
                  "Ders tamamlansın mı?",
                  "Paketten 1 hak düşülecek.",
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
              Dersi tamamla
            </Button>
            <Button
              secondary
              size="sm"
              icon="calendar-outline"
              disabled={busy}
              onPress={() => reschedule(l)}
              style={{ flexGrow: 1 }}
            >
              Saati değiştir
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon="close"
              disabled={busy}
              style={{ flexGrow: 1 }}
              onPress={() =>
                confirmAction(
                  "Dersi iptal et",
                  "Ders hakkı düşülmeyecek.",
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
              İptal et
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
                "Tamamlamayı geri al",
                "Pakete 1 ders hakkı iade edilecek.",
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
            Tamamlamayı geri al
          </Button>
        ) : (
          <Button
            secondary
            size="sm"
            icon="refresh-outline"
            style={{ alignSelf: "flex-start" }}
            onPress={() => newLesson(l.student_id, l)}
          >
            Telafi dersi planla
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
      ? "Her ders,\nyeni bir adım."
      : tab === "students"
        ? "Öğrencileriniz"
        : tab === "calendar"
          ? "Ders takvimi"
          : tab === "payments"
            ? "Tahsilatlar"
            : tab === "teaching"
              ? "Öğretim"
              : "Bildirimler";
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
          Öğrenciler
        </Button>
      ) : (
        <Brand />
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton
          ghost
          icon="notifications-outline"
          label="Bildirimler"
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
          Hesabım
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
        { id: "overview", label: "Özet", icon: "grid-outline" },
        { id: "calendar", label: "Takvim", icon: "calendar-outline" },
        { id: "students", label: "Öğrenciler", icon: "people-outline" },
        { id: "payments", label: "Tahsilatlar", icon: "wallet-outline" },
        { id: "teaching", label: "Öğretim", icon: "school-outline" },
      ]}
    />
  );
  // Öğretim ekranı: webde sol menüdeki Ödevler / PDF ve dosyalar / Ders
  // videoları başlıklarının karşılığı. Mobilde alt çubukta tek sekme, içinde
  // öğrenci seçici ve bölüm segmenti var.
  if (tab === "teaching") {
    const roster = [...data.students].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name, "tr"),
    );
    const chosen = roster.find((x) => x.id === teachingStudent) || roster[0];
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        {header}
        {!chosen ? (
          <View style={styles.body}>
            <EmptyState
              icon="people-outline"
              title="Önce bir öğrenci ekleyin"
              description="Ödevleri, PDF dosyalarını ve ders videolarını burada paylaşabilirsiniz."
            />
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 10 }}>
              <Picker
                label="Öğrenci"
                value={chosen.id}
                onChange={(id) => {
                  setTeachingStudent(id);
                  setTeachingFocus(null);
                }}
                options={roster.map((x) => ({
                  value: x.id,
                  label: x.name + (x.active ? "" : " · Arşivde"),
                  hint: x.subject,
                }))}
              />
              <Segmented
                label="Bölüm"
                value={teachingView}
                onChange={(value) => {
                  setTeachingView(value as TeachingView);
                  setTeachingFocus(null);
                }}
                options={[
                  {
                    value: "assignments",
                    label: "Ödevler",
                    icon: "clipboard-outline",
                  },
                  { value: "files", label: "PDF", icon: "document-outline" },
                  { value: "videos", label: "Videolar", icon: "videocam-outline" },
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
              <Kicker>Öğrenci dosyası</Kicker>
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
            Yeniden dene
          </Button>
        )}
        {student ? (
          <>
            <View style={[styles.row, { marginTop: -6 }]}>
              <Text style={styles.muted}>
                {[student.subject, student.grade].filter(Boolean).join(" · ")}
              </Text>
              {!student.active && <Badge>Arşivlendi</Badge>}
            </View>
            <View style={styles.row}>
              <Metric
                label="Kalan ders"
                value={remaining}
                warn={remaining <= 2}
              />
              <Metric
                label="Açık bakiye"
                value={money(balance(student.id))}
              />
            </View>
            <Button icon="library-outline" onPress={() => setLearning(true)}>
              Ödevler, videolar ve davetler
            </Button>
            <View style={styles.row}>
              {(
                [
                  ["Düzenle", "create-outline", () => editStudent(student)],
                  [
                    "Ders planla",
                    "calendar-outline",
                    () => newLesson(student.id),
                  ],
                  ["Paket ekle", "cube-outline", () => newPackage(student.id)],
                  ["Tahsilat", "wallet-outline", () => newPayment(student.id)],
                ] as const
              ).map(([label, icon, action]) => (
                <Button
                  key={label}
                  secondary
                  size="sm"
                  icon={icon}
                  onPress={action}
                  style={{ flexGrow: 1, flexBasis: 140 }}
                >
                  {label}
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
                <Kicker>Yalnızca benim notum</Kicker>
              </View>
              <Text style={styles.text}>
                {data.notes.find((n) => n.student_id === student.id)?.body ||
                  "Bir sonraki ders için not ekleyin."}
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
                    title: "Öğretmene özel not",
                    description: "Öğrenci ve veli bu notu göremez.",
                    fields: [
                      {
                        key: "body",
                        label: "Not",
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
                Notu düzenle
              </Button>
            </Card>
            <SectionHeading title="Ders paketleri" />
            {!studentPackages.length && (
              <Text style={styles.muted}>Henüz ders paketi yok.</Text>
            )}
            {studentPackages.map((p) => (
              <Card key={p.id}>
                <View
                  style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
                >
                  <Text style={[styles.h2, { flex: 1 }]}>{p.name}</Text>
                  <Badge
                    tone={p.remaining <= 2 ? "warning" : "info"}
                    icon={p.remaining <= 2 ? "alert-circle-outline" : undefined}
                  >
                    {p.remaining} hak
                  </Badge>
                </View>
                <Text style={styles.muted}>
                  {p.remaining} / {p.granted} hak · {money(p.price_minor)}
                </Text>
                <Text style={styles.caption}>
                  {p.expires_on ? `Son gün: ${p.expires_on}` : "Süre sınırı yok"}
                </Text>
              </Card>
            ))}
            <SectionHeading title="Ders geçmişi" />
            {data.lessons
              .filter((l) => l.student_id === student.id)
              .map(lessonCard)}
            {student.active ? (
              <Button
                variant="danger"
                icon="archive-outline"
                onPress={() =>
                  confirmAction(
                    "Öğrenciyi arşivle",
                    "Planlanmış dersleri önce tamamlayın veya iptal edin. Geçmiş kayıtlar korunur.",
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
                Öğrenciyi arşivle
              </Button>
            ) : (
              <Button
                secondary
                icon="arrow-undo-outline"
                onPress={() =>
                  confirmAction(
                    "Öğrenciyi aktife al",
                    "Öğrenci yeniden aktif listeye dönecek. Aktif öğrenci sınırınız doluysa bu işlem yapılamaz.",
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
                Öğrenciyi aktife al
              </Button>
            )}
          </>
        ) : tab === "overview" ? (
          <>
            <Text style={[styles.muted, { marginTop: -6 }]}>
              Günün planı ve öğrencilerinizin yolculuğu bir arada.
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
                    Bugün
                  </Text>
                  <Text style={[styles.muted, { color: colors.onFeatureMuted }]}>
                    {dayLabel(now, { weekday: "long", year: "numeric" })}
                  </Text>
                </View>
              </View>
              <InkFigures
                items={[
                  {
                    label: "Ders",
                    value: todayLessons.filter((l) => l.status !== "CANCELLED")
                      .length,
                  },
                  {
                    label: "Tamamlanan",
                    value: todayLessons.filter((l) => l.status === "COMPLETED")
                      .length,
                  },
                  { label: "Aktif öğrenci", value: active.length },
                  { label: "Bekleyen tahsilat", value: money(balance()) },
                ]}
              />
              <Button
                variant="onInk"
                size="sm"
                trailingIcon="arrow-forward"
                style={{ alignSelf: "flex-start" }}
                onPress={() => setTab("calendar")}
              >
                Takvime git
              </Button>
            </InkPanel>
            <Button icon="add" onPress={() => newLesson()}>
              Ders planla
            </Button>
            {!active.length && (
              <EmptyState
                icon="school-outline"
                title="İlk öğrencinizle başlayın"
                description="Öğrenci ekleyin, paket tanımlayın, dersinizi planlayın."
                action={
                  <Button
                    size="sm"
                    icon="person-add-outline"
                    onPress={() => editStudent()}
                  >
                    İlk öğrencimi ekle
                  </Button>
                }
              />
            )}
            {!!active.length && (
              <SectionHeading
                title={todayLessons.length ? "Bugünün dersleri" : "Sıradaki dersler"}
                description={
                  todayLessons.length ? undefined : "Bitmemiş en yakın dersler."
                }
              />
            )}
            {shown.map(lessonCard)}
            {!shown.length && !!active.length && (
              <EmptyState
                icon="calendar-outline"
                title="Planlanmış ders yok"
                description="Takvimden yeni bir ders planlayabilirsiniz."
              />
            )}
            {!!lowPackages.length && (
              <>
                <SectionHeading
                  title="Azalan paketler"
                  description="İki ders hakkı veya daha azı kalanlar."
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
                            {p.name} · {p.remaining} / {p.granted} hak
                          </Text>
                        </View>
                        <Button
                          secondary
                          size="sm"
                          onPress={() => newPackage(p.student_id)}
                        >
                          Paket ekle
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
              accessibilityLabel="Öğrenci ara"
              value={search}
              onChangeText={setSearch}
              placeholder="İsim veya ders ara…"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Button icon="person-add-outline" onPress={() => editStudent()}>
              Öğrenci ekle
            </Button>
            {(() => {
              const found = data.students.filter((s) =>
                `${s.name} ${s.subject}`
                  .toLocaleLowerCase("tr")
                  .includes(search.toLocaleLowerCase("tr")),
              );
              if (!found.length)
                return (
                  <EmptyState
                    icon="people-outline"
                    title={
                      data.students.length
                        ? "Eşleşen öğrenci yok"
                        : "Henüz öğrenci yok"
                    }
                    description={
                      data.students.length
                        ? "Aramayı değiştirip yeniden deneyin."
                        : "İlk öğrencinizi ekleyerek başlayın."
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
                          <Badge>Arşivde</Badge>
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
              <Text style={styles.label}>Tarih</Text>
              <View style={[styles.row, { flexWrap: "nowrap" }]}>
                <IconButton
                  icon="chevron-back"
                  label="Önceki gün"
                  onPress={() => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setDay(addDays(day, -1));
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Input
                    value={day}
                    onChangeText={setDay}
                    accessibilityLabel="Takvim tarihi"
                    placeholder="YYYY-AA-GG"
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                    style={{ textAlign: "center" }}
                  />
                </View>
                <IconButton
                  icon="chevron-forward"
                  label="Sonraki gün"
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
                  : "Biçim: YYYY-AA-GG"}
              </Text>
            </View>
            <Button icon="add" onPress={() => newLesson()}>
              Ders planla
            </Button>
            {data.lessons
              .filter((l) => dateKey(l.starts_at) === day)
              .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
              .map(lessonCard)}
            {!data.lessons.some((l) => dateKey(l.starts_at) === day) && (
              <EmptyState
                icon="calendar-clear-outline"
                title="Bu gün için ders yok"
                description="Seçili tarihte planlanmış bir ders bulunmuyor."
              />
            )}
          </>
        ) : tab === "payments" ? (
          <>
            <InkPanel>
              <Text style={[section.figureLabel, { color: colors.marker }]}>
                TOPLAM AÇIK BAKİYE
              </Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.title, { color: colors.onFeature, marginTop: -8 }]}
              >
                {money(balance())}
              </Text>
              <Text
                style={[
                  styles.muted,
                  { color: colors.onFeatureMuted, marginTop: -8 },
                ]}
              >
                Öğrenci tahsilatları; Derslik abonelik ücreti değildir.
              </Text>
            </InkPanel>
            <Button icon="add" onPress={() => newPayment()}>
              Tahsilat kaydet
            </Button>
            {!data.payments.length && (
              <EmptyState
                icon="wallet-outline"
                title="Henüz tahsilat yok"
                description="Aldığınız ödemeleri kaydettikçe burada listelenir."
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
                        {p.method === "CASH"
                          ? "Nakit"
                          : p.method === "TRANSFER"
                            ? "Havale"
                            : "Diğer"}
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
                        {p.voided_at ? "İptal edildi" : "Kaydedildi"}
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
                          "Tahsilat kaydını iptal et",
                          "Öğrenci bakiyesi yeniden artacak. Bankadan iade yapılmaz.",
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
                      Kaydı iptal et
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
