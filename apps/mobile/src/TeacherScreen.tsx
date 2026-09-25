import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { Access } from "@derslik/api-client";
import {
  emptyWorkspace,
  dateKey,
  dayLabel,
  money,
  parseLira,
  type WorkspaceData,
  type Student,
  type Lesson,
  type Command,
} from "@derslik/contracts";
import { request } from "./core";
import {
  Badge,
  Button,
  colors,
  Card,
  confirmAction,
  EmptyState,
  ErrorText,
  FormSheet,
  type FormSpec,
  Input,
  Loading,
  radius,
  SectionHeading,
  styles,
} from "./ui";
import { LearningScreen, Inbox } from "./LearningScreen";
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
}: {
  access: Access;
  onAccount: () => void;
}) {
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("overview"),
    [selected, setSelected] = useState<string | null>(null),
    [learning, setLearning] = useState(false),
    [search, setSearch] = useState(""),
    [day, setDay] = useState(dateKey()),
    [form, setForm] = useState<FormSpec | null>(null),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // Ekranın SafeAreaView'ı alt kenarı kapsamıyor (gövde tam yükseklikte kalsın
  // diye); alt güvenli alanı sekme çubuğu kendi taşıyor.
  const insets = useSafeAreaInsets();
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
    return (
      <Card key={l.id}>
        <View style={styles.row}>
          <Badge
            tone={
              l.status === "SCHEDULED"
                ? "neutral"
                : l.status === "COMPLETED"
                  ? "success"
                  : "danger"
            }
          >
            {l.status === "SCHEDULED"
              ? "Planlandı"
              : l.status === "COMPLETED"
                ? "Tamamlandı"
                : "İptal edildi"}
          </Badge>
          {!!l.makeup_for_id && <Badge tone="warning">Telafi</Badge>}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSelected(l.student_id)}
        >
          <Text style={styles.h2}>
            {data.students.find((s) => s.id === l.student_id)?.name}
          </Text>
        </Pressable>
        <Text style={styles.text}>{l.topic}</Text>
        <View style={[styles.row, { gap: 6 }]}>
          <Ionicons name="time-outline" size={15} color={colors.muted} />
          <Text style={styles.muted}>
            {dayLabel(l.starts_at, { hour: "2-digit", minute: "2-digit" })}
          </Text>
          <Text style={[styles.muted, { color: colors.faint }]}>·</Text>
          <Text style={styles.muted}>{l.location || "Konum belirtilmedi"}</Text>
        </View>
        {l.status === "SCHEDULED" ? (
          <>
            <Button
              disabled={busy}
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
              icon="checkmark-circle-outline"
            >
              Dersi tamamla
            </Button>
            <View style={styles.row}>
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
                icon="close-circle-outline"
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
          </>
        ) : l.status === "COMPLETED" ? (
          <Button
            secondary
            size="sm"
            icon="arrow-undo-outline"
            disabled={busy}
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
        onBack={() => setLearning(false)}
      />
    );
  const balance = (id?: string) =>
    data.packages
      .filter((p) => !id || p.student_id === id)
      .reduce((n, p) => n + Number(p.price_minor), 0) -
    data.payments
      .filter((p) => !p.voided_at && (!id || p.student_id === id))
      .reduce((n, p) => n + Number(p.amount_minor), 0);
  const upcoming = data.lessons
    .filter((l) => l.status === "SCHEDULED")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const title = student
    ? student.name
    : tab === "overview"
      ? "Her ders,\nyeni bir adım."
      : tab === "students"
        ? "Öğrencileriniz"
        : tab === "calendar"
          ? "Ders takvimi"
          : tab === "payments"
            ? "Tahsilatlar"
            : "Bildirimler";
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        {student ? (
          <Button
            secondary
            size="sm"
            icon="chevron-back"
            onPress={() => setSelected(null)}
          >
            Geri
          </Button>
        ) : (
          <Text style={styles.brand}>
            derslik<Text style={{ color: colors.green }}>.</Text>
          </Text>
        )}
        <Button
          secondary
          size="sm"
          icon="person-circle-outline"
          onPress={onAccount}
        >
          Hesabım
        </Button>
      </View>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Text style={styles.kicker}>
            {student ? "Öğrenci dosyası" : access.name}
          </Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <ErrorText message={error} />
        {error && (
          <Button secondary onPress={() => void load()}>
            Yeniden dene
          </Button>
        )}
        {student ? (
          <>
            <Text style={styles.muted}>
              {student.subject} · {student.grade}
              {!student.active ? " · Arşivlendi" : ""}
            </Text>
            <View style={styles.row}>
              <View style={styles.metric}>
                <Text style={styles.muted}>Kalan ders</Text>
                <Text style={styles.metricValue}>
                  {data.packages
                    .filter((p) => p.student_id === student.id)
                    .reduce((n, p) => n + p.remaining, 0)}
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.muted}>Açık bakiye</Text>
                <Text style={styles.metricValue}>
                  {money(balance(student.id))}
                </Text>
              </View>
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
            <Card>
              <View style={styles.row}>
                <Ionicons
                  name="lock-closed-outline"
                  size={14}
                  color={colors.green}
                />
                <Text style={styles.kicker}>Yalnızca benim notum</Text>
              </View>
              <Text style={styles.text}>
                {data.notes.find((n) => n.student_id === student.id)?.body ||
                  "Bir sonraki ders için not ekleyin."}
              </Text>
              <Button
                secondary
                size="sm"
                icon="create-outline"
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
            {data.packages
              .filter((p) => p.student_id === student.id)
              .map((p) => (
                <Card key={p.id}>
                  <Text style={styles.h2}>{p.name}</Text>
                  <Text style={styles.text}>
                    {p.remaining} / {p.granted} hak · {money(p.price_minor)}
                  </Text>
                  <Text style={styles.muted}>
                    {p.expires_on
                      ? `Son gün: ${p.expires_on}`
                      : "Süre sınırı yok"}
                  </Text>
                </Card>
              ))}
            <SectionHeading title="Ders geçmişi" />
            {data.lessons
              .filter((l) => l.student_id === student.id)
              .map(lessonCard)}
            {!!student.active && (
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
            )}
          </>
        ) : tab === "overview" ? (
          <>
            <Text style={styles.muted}>
              Günün planı ve öğrencilerinizin yolculuğu bir arada.
            </Text>
            <View style={styles.row}>
              <View style={styles.metric}>
                <Text style={styles.muted}>Aktif öğrenci</Text>
                <Text style={styles.metricValue}>{active.length}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.muted}>Açık bakiye</Text>
                <Text style={styles.metricValue}>{money(balance())}</Text>
              </View>
            </View>
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
            <SectionHeading
              title="Sıradaki dersler"
              description="En yakın beş ders."
            />
            {upcoming.slice(0, 5).map(lessonCard)}
            {!upcoming.length && !!active.length && (
              <EmptyState
                icon="calendar-outline"
                title="Planlanmış ders yok"
                description="Takvimden yeni bir ders planlayabilirsiniz."
              />
            )}
            <SectionHeading
              title="Azalan paketler"
              description="İki ders hakkı veya daha azı kalanlar."
            />
            {data.packages
              .filter(
                (p) =>
                  p.remaining <= 2 && active.some((s) => s.id === p.student_id),
              )
              .map((p) => (
                <Card key={p.id}>
                  <Text style={styles.h2}>
                    {data.students.find((s) => s.id === p.student_id)?.name}
                  </Text>
                  <Text style={styles.text}>
                    {p.name} · {p.remaining} hak
                  </Text>
                  <Button secondary onPress={() => newPackage(p.student_id)}>
                    Yeni paket ekle
                  </Button>
                </Card>
              ))}
          </>
        ) : tab === "students" ? (
          <>
            <Input
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
            {data.students
              .filter((s) =>
                `${s.name} ${s.subject}`
                  .toLocaleLowerCase("tr")
                  .includes(search.toLocaleLowerCase("tr")),
              )
              .map((s) => (
                <Card key={s.id} onPress={() => setSelected(s.id)}>
                  <View style={[styles.row, { flexWrap: "nowrap" }]}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.h2}>{s.name}</Text>
                      <Text style={styles.muted}>
                        {s.subject}
                        {s.grade ? " · " + s.grade : ""}
                      </Text>
                      <Text style={styles.text}>
                        {money(balance(s.id))} açık bakiye
                      </Text>
                    </View>
                    {!s.active && <Badge tone="warning">Arşiv</Badge>}
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.faint}
                    />
                  </View>
                </Card>
              ))}
          </>
        ) : tab === "calendar" ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Tarih</Text>
              <Input
                value={day}
                onChangeText={setDay}
                accessibilityLabel="Takvim tarihi"
                placeholder="YYYY-AA-GG"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              <Text style={styles.hint}>Biçim: YYYY-AA-GG</Text>
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
            <Card tone="brand">
              <Text style={styles.kicker}>Toplam açık bakiye</Text>
              <Text style={styles.title}>{money(balance())}</Text>
              <Text style={styles.muted}>
                Öğrenci tahsilatları; Derslik abonelik ücreti değildir.
              </Text>
            </Card>
            <Button icon="add" onPress={() => newPayment()}>
              Tahsilat kaydet
            </Button>
            {data.payments.map((p) => (
              <Card key={p.id}>
                <Text style={styles.h2}>
                  {data.students.find((s) => s.id === p.student_id)?.name}
                </Text>
                <Text style={styles.title}>{money(p.amount_minor)}</Text>
                <View style={styles.row}>
                  <Text style={styles.muted}>
                    {p.received_on} ·{" "}
                    {p.method === "CASH"
                      ? "Nakit"
                      : p.method === "TRANSFER"
                        ? "Havale"
                        : "Diğer"}
                  </Text>
                  <Badge tone={p.voided_at ? "danger" : "success"}>
                    {p.voided_at ? "İptal edildi" : "Kaydedildi"}
                  </Badge>
                </View>
                {p.reference && <Text style={styles.text}>{p.reference}</Text>}
                {!p.voided_at && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon="close-circle-outline"
                    disabled={busy}
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
            ))}
          </>
        ) : (
          <Inbox workspaceId={access.id} />
        )}
      </ScrollView>
      {!student && (
        <View style={[styles.tabs, { paddingBottom: insets.bottom + 6 }]}>
          {[
            { id: "overview", label: "Özet", icon: "grid-outline" as const },
            {
              id: "calendar",
              label: "Takvim",
              icon: "calendar-outline" as const,
            },
            {
              id: "students",
              label: "Öğrenciler",
              icon: "people-outline" as const,
            },
            {
              id: "payments",
              label: "Tahsilatlar",
              icon: "wallet-outline" as const,
            },
            {
              id: "inbox",
              label: "Bildirimler",
              icon: "notifications-outline" as const,
            },
          ].map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.id }}
              onPress={() => setTab(t.id)}
              style={({ pressed }) => [
                styles.tab,
                tab === t.id && {
                  backgroundColor: colors.greenSoft,
                  borderRadius: radius.md,
                },
                pressed && tab !== t.id && { backgroundColor: colors.subtle },
              ]}
            >
              <Ionicons
                name={t.icon}
                size={22}
                color={tab === t.id ? colors.green : colors.muted}
              />
              <Text
                style={[
                  styles.tabText,
                  tab === t.id && { color: colors.green },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <FormSheet form={form} onClose={() => setForm(null)} />
    </SafeAreaView>
  );
}
