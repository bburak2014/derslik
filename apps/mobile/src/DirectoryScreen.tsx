import React, { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import type { TeacherPage } from "@derslik/api-client";
import {
  DECISION_NOTE_MAX,
  intlLocale,
  lessonModes,
  PHOTO_MAX_BYTES,
  PHOTO_SIZE,
  photoPath,
  priceCurrencies,
  priceSteps,
  REQUEST_EXPIRY_DAYS,
  t,
  teacherLevels,
  teacherSorts,
  teacherSubjects,
  teachingLanguages,
  type LessonRequest,
  type MessageKey,
  type MyLessonRequest,
  type PublicReview,
  type PublicTeacher,
  type RequestStatus,
  type Showcase,
  type TeacherFilter,
  type TeacherProfileInput,
  type TeacherRelation,
  type TeacherRelations,
} from "@derslik/contracts";
import { client, configuration } from "./core";
import {
  Avatar,
  Badge,
  type BadgeTone,
  Brand,
  Button,
  Card,
  ChipGroup,
  confirmAction,
  EmptyState,
  ErrorText,
  Field,
  FormSheet,
  type FormSpec,
  Input,
  Kicker,
  Loading,
  Picker,
  SectionHeading,
  Segmented,
  SuccessText,
  TabStrip,
  Toggle,
  useTheme,
} from "./ui";

// Öğretmen vitrini (web: components/derslik/directory.tsx ve showcase.tsx).
// Öğrenci öğretmenleri inceler ve ders isteği gönderir; öğretmen vitrin
// profilini düzenler ve gelen istekleri yanıtlar.

const label = (key: string) => t(key as MessageKey);
export const subjectName = (s: string) => label(`dir.subject.${s}`);
export const levelName = (s: string) => label(`dir.level.${s}`);
const modeName = (s: string) => label(`dir.mode.${s}`);
const langName = (s: string) => label(`dir.lang.${s}`);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
function priceText(p: { hourlyPrice: number | null; currency: string }) {
  if (p.hourlyPrice === null) return null;
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: p.currency,
    maximumFractionDigits: 0,
  }).format(p.hourlyPrice);
}
const photoUri = (id: string, version: number | null) => {
  const path = photoPath(id, version);
  return path ? configuration.api.replace(/\/$/, "") + path : null;
};
const statusTone: Record<RequestStatus, BadgeTone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};
export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge tone={statusTone[status]} dot>
      {label(`dir.status.${status}`)}
    </Badge>
  );
}

export function TeacherPhoto({
  id,
  version,
  name,
  size = 56,
}: {
  id: string;
  version: number | null;
  name: string;
  size?: number;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = photoUri(id, version);
  if (!uri || failed) return <Avatar name={name} size={size} />;
  return (
    <Image
      source={{ uri }}
      alt={name}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.sunken,
      }}
    />
  );
}

function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  const { colors } = useTheme();
  const v = value ?? 0;
  return (
    <View
      accessibilityLabel={t("dir.stars", { count: Math.round(v) })}
      style={{ flexDirection: "row", gap: 1 }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={
            v >= i - 0.25
              ? "star"
              : v >= i - 0.75
                ? "star-half"
                : "star-outline"
          }
          size={size}
          color={v ? colors.warn : colors.faint}
        />
      ))}
    </View>
  );
}

function Rating({ teacher }: { teacher: PublicTeacher }) {
  const { styles } = useTheme();
  if (!teacher.ratingCount)
    return <Badge tone="info">{t("dir.newTeacher")}</Badge>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Stars value={teacher.ratingAverage} />
      <Text style={styles.caption}>
        {teacher.ratingAverage?.toFixed(1)} (
        {t("dir.reviewCount", { count: teacher.ratingCount })})
      </Text>
    </View>
  );
}

function Price({ teacher }: { teacher: PublicTeacher }) {
  const { styles } = useTheme();
  const price = priceText(teacher);
  if (!price)
    return <Text style={styles.muted}>{t("dir.priceOnRequest")}</Text>;
  return (
    <Text style={styles.h2}>
      {price} <Text style={styles.muted}>{t("dir.perHour")}</Text>
    </Text>
  );
}

/** Giriş yapan kişi bu öğretmene neden istek gönderemez; null: gönderebilir. */
type CardState = "own" | "student" | "pending" | "cooling" | null;
const cardState = (r: TeacherRelations | null, id: string): CardState =>
  !r
    ? null
    : r.own.includes(id)
      ? "own"
      : r.students.includes(id)
        ? "student"
        : r.pending.includes(id)
          ? "pending"
          : r.cooling.includes(id)
            ? "cooling"
            : null;

function TeacherCard({
  teacher,
  onPress,
  onRequest,
  state = null,
}: {
  teacher: PublicTeacher;
  onPress: () => void;
  /** "İstek gönder": profil, istek formu açık açılır. */
  onRequest: () => void;
  /** İstek gönderilemiyorsa düğme yerine bu durum görünür. */
  state?: CardState;
}) {
  const { styles } = useTheme();
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <TeacherPhoto
          id={teacher.id}
          version={teacher.photoVersion}
          name={teacher.displayName}
        />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.h2} numberOfLines={1}>
            {teacher.displayName}
          </Text>
          {!!teacher.headline && (
            <Text style={styles.muted} numberOfLines={2}>
              {teacher.headline}
            </Text>
          )}
          <Rating teacher={teacher} />
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {teacher.subjects.slice(0, 3).map((s) => (
          <Badge key={s}>{subjectName(s)}</Badge>
        ))}
        {teacher.lessonModes.map((m) => (
          <Badge
            key={m}
            tone="info"
            icon={m === "ONLINE" ? "videocam-outline" : "location-outline"}
          >
            {m === "IN_PERSON" && teacher.city
              ? `${modeName(m)} · ${teacher.city}`
              : modeName(m)}
          </Badge>
        ))}
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Price teacher={teacher} />
        </View>
        {state === "pending" ? (
          <RequestStatusBadge status="PENDING" />
        ) : state === "cooling" ? (
          <RequestStatusBadge status="DECLINED" />
        ) : state ? (
          <Badge tone={state === "student" ? "success" : "neutral"} dot>
            {t(state === "student" ? "dir.cardStudent" : "dir.cardOwn")}
          </Badge>
        ) : (
          <Button size="sm" icon="paper-plane-outline" onPress={onRequest}>
            {t("dir.requestShort")}
          </Button>
        )}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Öğrenci: öğretmen bul ve isteklerim                                 */
/* ------------------------------------------------------------------ */

export type DirectoryTab = "teachers" | "requests";

export function DirectoryScreen({
  onBack,
  onOpenWorkspace,
  tab: initialTab = "teachers",
  teacher: initialTeacher = null,
}: {
  onBack: () => void;
  /** Kabul edilen isteğin öğretmeninin derslerine geçer. */
  onOpenWorkspace: (workspaceId: string) => void;
  tab?: DirectoryTab;
  teacher?: string | null;
}) {
  const { styles } = useTheme();
  const [tab, setTab] = useState<DirectoryTab>(initialTab),
    [teacher, setTeacher] = useState<string | null>(initialTeacher),
    // Karttaki "İstek gönder"den gelindiyse profil istek formu açık açılır.
    [openRequest, setOpenRequest] = useState(false);
  const open = (id: string, request = false) => {
    setOpenRequest(request);
    setTeacher(id);
  };
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        {teacher ? (
          <Button
            variant="ghost"
            size="sm"
            icon="chevron-back"
            onPress={() => setTeacher(null)}
            style={{ marginLeft: -10 }}
          >
            {t("dir.back")}
          </Button>
        ) : (
          <Brand />
        )}
        <Button
          secondary
          size="sm"
          icon="person-circle-outline"
          onPress={onBack}
        >
          {t("mt.myAccount")}
        </Button>
      </View>
      {!teacher && (
        <TabStrip
          tabs={[
            { id: "teachers", label: t("nav.findTeacher") },
            { id: "requests", label: t("nav.myRequests") },
          ]}
          value={tab}
          onChange={(id) => setTab(id as DirectoryTab)}
        />
      )}
      {teacher ? (
        <TeacherProfile
          key={teacher}
          id={teacher}
          onOpenWorkspace={onOpenWorkspace}
          openRequest={openRequest}
        />
      ) : tab === "teachers" ? (
        <TeacherList onOpen={open} />
      ) : (
        <MyRequests
          onOpen={open}
          onBrowse={() => setTab("teachers")}
          onOpenWorkspace={onOpenWorkspace}
        />
      )}
    </SafeAreaView>
  );
}

function TeacherList({
  onOpen,
}: {
  onOpen: (id: string, request?: boolean) => void;
}) {
  const { styles } = useTheme();
  const [filter, setFilter] = useState<TeacherFilter>({}),
    [query, setQuery] = useState(""),
    [page, setPage] = useState<TeacherPage | null>(null),
    [rows, setRows] = useState<PublicTeacher[]>([]),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [relations, setRelations] = useState<TeacherRelations | null>(null);
  const key = JSON.stringify(filter);
  async function load(next: number) {
    setLoading(true);
    // İlişkiler ilk sayfayla (ve yenilemeyle) tazelenir; hata listeyi durdurmaz.
    if (next === 1)
      client
        .teacherRelations()
        .then((r) => setRelations(r.data))
        .catch(() => undefined);
    try {
      const r = await client.teachers({ ...filter, page: next });
      setPage(r);
      setRows((old) => (next === 1 ? r.data : [...old, ...r.data]));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the filter changes.
  }, [key]);
  // Arama yazarken her tuşta istek atılmaz; yarım saniye beklenir.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = query.trim() || undefined;
      setFilter((f) => (f.q === q ? f : { ...f, q }));
    }, 500);
    return () => clearTimeout(timer);
  }, [query]);
  const set = (patch: Partial<TeacherFilter>) =>
    setFilter((f) => ({ ...f, ...patch }));
  const any = (value: string) => value || undefined;
  const active = [
    filter.subject,
    filter.level,
    filter.mode,
    filter.city,
    filter.maxPrice,
  ].some((v) => v !== undefined);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load(1);
          }}
        />
      }
    >
      <SectionHeading
        title={t("dir.findTitle")}
        description={t("dir.findSubtitle")}
      />
      <Input
        icon="search-outline"
        placeholder={t("dir.searchPlaceholder")}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        returnKeyType="search"
      />
      {/* Web'deki gibi: her filtre tek dokunuşla açılan bir hap; satır yana
          kayar, seçili haplar marka tonunda görünür. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
      >
        {active && (
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onPress={() => setFilter((f) => ({ q: f.q, sort: f.sort }))}
          >
            {t("dir.clearFilters")}
          </Button>
        )}
        <Picker
          pill={{ icon: "book-outline" }}
          label={t("dir.subjectLabel")}
          value={filter.subject || ""}
          onChange={(v) => set({ subject: any(v) as TeacherFilter["subject"] })}
          options={[
            { value: "", label: t("dir.allSubjects") },
            ...teacherSubjects.map((s) => ({
              value: s,
              label: subjectName(s),
            })),
          ]}
        />
        <Picker
          pill={{ icon: "school-outline" }}
          label={t("dir.levelLabel")}
          value={filter.level || ""}
          onChange={(v) => set({ level: any(v) as TeacherFilter["level"] })}
          options={[
            { value: "", label: t("dir.allLevels") },
            ...teacherLevels.map((s) => ({ value: s, label: levelName(s) })),
          ]}
        />
        <Picker
          pill={{ icon: "desktop-outline" }}
          label={t("dir.lessonModes")}
          value={filter.mode || ""}
          onChange={(v) => {
            const mode = any(v) as TeacherFilter["mode"];
            // Yalnız online derslerde şehir anlamsız.
            set(mode === "ONLINE" ? { mode, city: undefined } : { mode });
          }}
          options={[
            { value: "", label: t("dir.anyMode") },
            ...lessonModes.map((m) => ({ value: m, label: modeName(m) })),
          ]}
        />
        {filter.mode !== "ONLINE" && !!page?.cities.length && (
          <Picker
            pill={{ icon: "location-outline" }}
            label={t("dir.city")}
            value={filter.city || ""}
            onChange={(v) => set({ city: any(v) })}
            options={[
              { value: "", label: t("dir.anyCity") },
              ...page.cities.map((c) => ({ value: c, label: c })),
            ]}
          />
        )}
        <Picker
          pill={{ icon: "wallet-outline" }}
          label={t("dir.hourlyPrice")}
          value={filter.maxPrice ? String(filter.maxPrice) : ""}
          onChange={(v) => set({ maxPrice: v ? Number(v) : undefined })}
          options={[
            { value: "", label: t("common.all") },
            ...priceSteps.map((n) => ({
              value: String(n),
              label: "≤ " + priceText({ hourlyPrice: n, currency: "TRY" }),
            })),
          ]}
        />
        <Picker
          pill={{ icon: "swap-vertical-outline" }}
          label={t("dir.sortLabel")}
          value={
            filter.sort && filter.sort !== "recommended" ? filter.sort : ""
          }
          onChange={(v) =>
            set({ sort: (v || undefined) as TeacherFilter["sort"] })
          }
          options={teacherSorts.map((s) => ({
            value: s === "recommended" ? "" : s,
            label: label(`dir.sort.${s}`),
          }))}
        />
      </ScrollView>
      <ErrorText message={error} />
      {page && (
        <Text style={styles.muted}>
          {t("dir.resultCount", { count: page.total })}
        </Text>
      )}
      {/* Arama değişince eski sonuçlar yenisi gelene kadar kalır. */}
      {!page ? (
        !error && <Loading />
      ) : !rows.length && !error ? (
        <EmptyState
          icon="search-outline"
          title={t("dir.emptyTitle")}
          description={t("dir.emptyText")}
        />
      ) : (
        rows.map((x) => (
          <TeacherCard
            key={x.id}
            teacher={x}
            onPress={() => onOpen(x.id)}
            onRequest={() => onOpen(x.id, true)}
            state={cardState(relations, x.id)}
          />
        ))
      )}
      {page && rows.length < page.total && (
        <Button
          secondary
          loading={loading}
          onPress={() => void load(page.page + 1)}
        >
          {t("dir.loadMore")}
        </Button>
      )}
    </ScrollView>
  );
}

/** Öğretmenin reddederken yazdığı not; öğrencinin gördüğü haliyle. */
function TeacherNote({ note }: { note: string }) {
  const { styles } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Kicker muted>{t("dir.teacherNote")}</Kicker>
      <Text style={styles.text}>{note}</Text>
    </View>
  );
}

function TeacherProfile({
  id,
  onOpenWorkspace,
  openRequest = false,
}: {
  id: string;
  onOpenWorkspace: (workspaceId: string) => void;
  /** Karttaki "İstek gönder"den gelindi: gönderilebiliyorsa form açık başlar. */
  openRequest?: boolean;
}) {
  const { colors, styles } = useTheme();
  const [teacher, setTeacher] = useState<PublicTeacher | null>(null),
    [reviews, setReviews] = useState<PublicReview[]>([]),
    [relation, setRelation] = useState<TeacherRelation | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState<FormSpec | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [autoOpened, setAutoOpened] = useState(!openRequest);
  async function load() {
    try {
      const [profile, rel] = await Promise.all([
        client.teacher(id),
        client.teacherRelation(id),
      ]);
      setTeacher(profile.data);
      setReviews(profile.reviews);
      setRelation(rel.data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the screen is keyed by teacher id.
  }, []);
  if (!teacher)
    return error ? (
      <View style={styles.body}>
        <ErrorText message={error} />
      </View>
    ) : (
      <Loading />
    );
  const request = relation?.request;
  const sendForm = () =>
    setForm({
      title: t("dir.requestTitle"),
      description: t("dir.requestText", { name: teacher.displayName }),
      submit_label: t("dir.send"),
      fields: [
        { key: "studentName", label: t("dir.studentName") },
        {
          key: "subject",
          label: t("dir.subjectLabel"),
          options: teacher.subjects.map((s) => ({
            value: s,
            label: subjectName(s),
          })),
        },
        {
          key: "level",
          label: t("dir.levelLabel"),
          required: false,
          options: [
            { value: "", label: t("dir.noLevel") },
            ...(teacher.levels.length ? teacher.levels : teacherLevels).map(
              (s) => ({ value: s, label: levelName(s) }),
            ),
          ],
        },
        { key: "phone", label: t("mt.phone"), required: false },
        {
          key: "message",
          label: t("dir.message"),
          placeholder: t("dir.messagePlaceholder"),
          multiline: true,
          required: false,
        },
      ],
      submit: async (v) => {
        await client.sendLessonRequest(id, {
          studentName: v.studentName,
          subject: v.subject as PublicTeacher["subjects"][number],
          level: v.level as PublicTeacher["levels"][number] | "",
          phone: v.phone,
          message: v.message,
        });
        setNotice(t("dir.sent"));
        await load();
      },
    });
  const canRequest =
    !!relation &&
    !relation.isOwn &&
    !relation.isStudent &&
    request?.status !== "PENDING" &&
    !relation.retryAfter;
  // Karttan gelindiyse form bir kez açılır; gönderilemiyorsa kutu nedenini söyler.
  if (!autoOpened && relation) {
    setAutoOpened(true);
    if (canRequest) sendForm();
  }
  const note =
    request?.status === "DECLINED" && request.decisionNote ? (
      <TeacherNote note={request.decisionNote} />
    ) : null;
  let action: React.ReactNode;
  if (!relation) action = null;
  else if (relation.isOwn)
    action = <Text style={styles.muted}>{t("dir.ownProfile")}</Text>;
  else if (relation.isStudent)
    action = (
      <>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Ionicons name="checkmark-circle" size={18} color={colors.ok} />
          <Text style={[styles.text, { flex: 1 }]}>
            {t("dir.alreadyStudent")}
          </Text>
        </View>
        <Button icon="school-outline" onPress={() => onOpenWorkspace(id)}>
          {t("dir.openLessons")}
        </Button>
      </>
    );
  else if (request?.status === "PENDING")
    action = (
      <>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Ionicons name="time-outline" size={18} color={colors.warn} />
          <Text style={[styles.text, { flex: 1 }]}>
            {t("dir.pendingState")}
          </Text>
        </View>
        <Text style={styles.caption}>
          {t("dir.expiryHint", { days: REQUEST_EXPIRY_DAYS })}
        </Text>
        <Button
          secondary
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await client.cancelLessonRequest(request.id);
              setNotice(t("dir.cancelled"));
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("dir.cancelRequest")}
        </Button>
      </>
    );
  else if (relation.retryAfter)
    action = (
      <>
        <Text style={styles.muted}>
          {t("dir.declinedState", { date: shortDate(relation.retryAfter) })}
        </Text>
        {note}
      </>
    );
  else
    action = (
      <>
        {request?.status === "EXPIRED" && (
          <Text style={styles.muted}>
            {t("dir.expiredState", { days: REQUEST_EXPIRY_DAYS })}
          </Text>
        )}
        {note}
        <Button icon="paper-plane-outline" onPress={sendForm}>
          {t("dir.sendRequest")}
        </Button>
      </>
    );
  const facts: [string, string[]][] = [
    [t("dir.subjects"), teacher.subjects.map(subjectName)],
    [t("dir.levels"), teacher.levels.map(levelName)],
    [
      t("dir.lessonModes"),
      teacher.lessonModes.map((m) =>
        m === "IN_PERSON" && teacher.city
          ? `${modeName(m)} · ${teacher.city}`
          : modeName(m),
      ),
    ],
    [t("dir.languages"), teacher.languages.map(langName)],
  ];
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        <View style={{ alignItems: "center", gap: 8 }}>
          <TeacherPhoto
            id={teacher.id}
            version={teacher.photoVersion}
            name={teacher.displayName}
            size={112}
          />
          <Text style={[styles.title, { textAlign: "center" }]}>
            {teacher.displayName}
          </Text>
          {!!teacher.headline && (
            <Text style={[styles.muted, { textAlign: "center" }]}>
              {teacher.headline}
            </Text>
          )}
          <Rating teacher={teacher} />
          {teacher.experienceYears !== null && (
            <Text style={styles.caption}>
              {t("dir.experience", { count: teacher.experienceYears })}
            </Text>
          )}
        </View>
        <Card>
          <Price teacher={teacher} />
          {action}
          <ErrorText message={error} />
          <SuccessText message={notice} />
        </Card>
        {facts
          .filter(([, values]) => values.length)
          .map(([title, values]) => (
            <View key={title} style={{ gap: 8 }}>
              <Kicker muted>{title}</Kicker>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {values.map((v) => (
                  <Badge key={v}>{v}</Badge>
                ))}
              </View>
            </View>
          ))}
        {!!teacher.bio && (
          <View style={{ gap: 8 }}>
            <Kicker muted>{t("dir.about")}</Kicker>
            <Text style={styles.text}>{teacher.bio}</Text>
          </View>
        )}
        {relation?.canReview && (
          <ReviewForm
            key={relation.review?.updatedAt ?? "new"}
            teacherId={id}
            review={relation.review}
            onSaved={load}
          />
        )}
        <SectionHeading
          title={t("dir.reviews")}
          description={
            teacher.ratingCount
              ? t("dir.reviewCount", { count: teacher.ratingCount })
              : undefined
          }
        />
        <ReviewList reviews={reviews} empty={t("dir.noReviews")} />
      </ScrollView>
      <FormSheet form={form} onClose={() => setForm(null)} />
    </>
  );
}

function ReviewList({
  reviews,
  empty,
}: {
  reviews: PublicReview[];
  empty: string;
}) {
  const { styles } = useTheme();
  if (!reviews.length) return <Text style={styles.muted}>{empty}</Text>;
  return (
    <>
      {reviews.map((r) => (
        <Card key={r.id}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Avatar name={r.authorName} size={34} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.label}>{r.authorName}</Text>
              <Text style={styles.caption}>{shortDate(r.updatedAt)}</Text>
            </View>
            <Stars value={r.rating} />
          </View>
          {!!r.comment && <Text style={styles.text}>{r.comment}</Text>}
        </Card>
      ))}
    </>
  );
}

function ReviewForm({
  teacherId,
  review,
  onSaved,
}: {
  teacherId: string;
  review: PublicReview | null;
  onSaved: () => Promise<void>;
}) {
  const { colors, styles } = useTheme();
  const [rating, setRating] = useState(review?.rating ?? 0),
    [comment, setComment] = useState(review?.comment ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(done);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card tone="brand">
      <Text style={styles.h2}>
        {review ? t("dir.yourReview") : t("dir.writeReview")}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("dir.ratingLabel")}
        style={{ flexDirection: "row", gap: 4 }}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable
            key={i}
            accessibilityRole="radio"
            accessibilityLabel={t("dir.stars", { count: i })}
            accessibilityState={{ checked: rating === i }}
            onPress={() => setRating(i)}
            hitSlop={6}
          >
            <Ionicons
              name={rating >= i ? "star" : "star-outline"}
              size={30}
              color={rating >= i ? colors.warn : colors.faint}
            />
          </Pressable>
        ))}
      </View>
      <Field label={t("dir.commentLabel")}>
        <Input
          multiline
          value={comment}
          onChangeText={setComment}
          placeholder={t("dir.commentPlaceholder")}
          maxLength={500}
        />
      </Field>
      <ErrorText message={error} />
      <SuccessText message={notice} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          loading={busy}
          onPress={() => {
            if (!rating) {
              setError(t("dir.pickRating"));
              return;
            }
            void run(
              () => client.saveReview(teacherId, { rating, comment }),
              t("dir.reviewSaved"),
            );
          }}
        >
          {t("dir.saveReview")}
        </Button>
        {review && (
          <Button
            variant="ghost"
            icon="trash-outline"
            disabled={busy}
            onPress={() =>
              confirmAction(
                t("dir.deleteReview"),
                "",
                () =>
                  run(
                    () => client.deleteReview(teacherId),
                    t("dir.reviewDeleted"),
                  ),
                setError,
              )
            }
          >
            {t("dir.deleteReview")}
          </Button>
        )}
      </View>
    </Card>
  );
}

function MyRequests({
  onOpen,
  onBrowse,
  onOpenWorkspace,
}: {
  onOpen: (id: string) => void;
  onBrowse: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  const { styles } = useTheme();
  const [rows, setRows] = useState<MyLessonRequest[] | null>(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  async function load() {
    try {
      setRows((await client.myLessonRequests()).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, []);
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      <SectionHeading
        title={t("nav.myRequests")}
        description={t("dir.myRequestsSubtitle")}
      />
      <ErrorText message={error} />
      {!rows ? (
        !error && <Loading />
      ) : !rows.length ? (
        <EmptyState
          icon="paper-plane-outline"
          title={t("dir.noRequests")}
          action={
            <Button secondary onPress={onBrowse}>
              {t("dir.browse")}
            </Button>
          }
        />
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TeacherPhoto
                id={r.workspaceId}
                version={r.teacherPhotoVersion}
                name={r.teacherName}
                size={44}
              />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.h2} numberOfLines={1}>
                  {r.teacherName}
                </Text>
                <Text style={styles.muted}>
                  {subjectName(r.subject)}
                  {r.level ? " · " + levelName(r.level) : ""}
                </Text>
                <Text style={styles.caption}>
                  {t("dir.sentOn", { date: shortDate(r.createdAt) })}
                </Text>
              </View>
            </View>
            <RequestStatusBadge status={r.status} />
            {r.status === "DECLINED" && !!r.decisionNote && (
              <TeacherNote note={r.decisionNote} />
            )}
            {r.status === "PENDING" && (
              <Text style={styles.caption}>
                {t("dir.expiryHint", { days: REQUEST_EXPIRY_DAYS })}
              </Text>
            )}
            {r.status === "EXPIRED" && (
              <Text style={styles.muted}>
                {t("dir.expiredState", { days: REQUEST_EXPIRY_DAYS })}
              </Text>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {r.status === "ACCEPTED" && (
                <Button
                  size="sm"
                  icon="school-outline"
                  onPress={() => onOpenWorkspace(r.workspaceId)}
                >
                  {t("dir.openLessons")}
                </Button>
              )}
              {r.status === "PENDING" && (
                <Button
                  size="sm"
                  secondary
                  onPress={() =>
                    confirmAction(
                      t("dir.cancelRequest"),
                      "",
                      async () => {
                        await client.cancelLessonRequest(r.id);
                        await load();
                      },
                      setError,
                    )
                  }
                >
                  {t("dir.cancelRequest")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onPress={() => onOpen(r.workspaceId)}
              >
                {t("dir.viewTeacher")}
              </Button>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Öğretmen: vitrin                                                    */
/* ------------------------------------------------------------------ */

type ShowcaseTab = "requests" | "profile" | "reviews";

export function ShowcaseView({
  workspaceId,
  onPending,
  onAccepted,
  focus,
}: {
  workspaceId: string;
  /** Bekleyen istek sayısı (vitrin simgesindeki sayaç). */
  onPending: (count: number) => void;
  /** Kabul edilen istek yeni öğrenci kaydı açar; çağıran listeyi yeniler. */
  onAccepted: (studentId: string | null) => void;
  /** Bildirimden gelinen istek. */
  focus?: string | null;
}) {
  const { styles } = useTheme();
  const [data, setData] = useState<Showcase | null>(null),
    [tab, setTab] = useState<ShowcaseTab>("requests"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [form, setForm] = useState<FormSpec | null>(null);
  async function load() {
    try {
      const r = (await client.showcase(workspaceId)).data;
      setData(r);
      onPending(r.requests.filter((x) => x.status === "PENDING").length);
      setError("");
      // Profili olmayan öğretmen önce profili görür.
      if (!r.profile) setTab((old) => (old === "requests" ? "profile" : old));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when a notice opens the showcase again.
  }, [workspaceId, focus]);
  // Reddederken öğrenciye isteğe bağlı kısa not yazılabilir.
  const decline = (r: LessonRequest) =>
    setForm({
      title: t("dir.declineTitle"),
      description: t("dir.declineBody"),
      submit_label: t("dir.decline"),
      fields: [
        {
          key: "note",
          label: t("dir.declineNoteLabel"),
          placeholder: t("dir.declineNotePlaceholder"),
          multiline: true,
          required: false,
          maxLength: DECISION_NOTE_MAX,
        },
      ],
      submit: async (v) => {
        setNotice("");
        await client.decideLessonRequest(workspaceId, r.id, "decline", v.note);
        setNotice(t("dir.declined"));
        await load();
      },
    });
  const decide = (r: LessonRequest, decision: "accept" | "decline") =>
    decision === "decline"
      ? decline(r)
      : confirmAction(
          t("dir.acceptTitle", { name: r.studentName }),
          t("dir.acceptBody"),
          async () => {
            setNotice("");
            const res = await client.decideLessonRequest(
              workspaceId,
              r.id,
              "accept",
            );
            setNotice(t("dir.accepted", { name: r.studentName }));
            await load();
            onAccepted(res.data.studentId);
          },
          setError,
        );
  const pending = data?.requests.filter((r) => r.status === "PENDING") ?? [],
    earlier = data?.requests.filter((r) => r.status !== "PENDING") ?? [];
  return (
    <>
      <TabStrip
        tabs={[
          {
            id: "requests",
            label: pending.length
              ? `${t("dir.tabRequests")} (${pending.length})`
              : t("dir.tabRequests"),
          },
          { id: "profile", label: t("dir.tabProfile") },
          { id: "reviews", label: t("dir.tabReviews") },
        ]}
        value={tab}
        onChange={(id) => {
          setTab(id as ShowcaseTab);
          setNotice("");
        }}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        <SectionHeading
          title={t("nav.showcase")}
          description={t("dir.showcaseSubtitle")}
          action={
            data?.profile ? (
              <Badge tone={data.profile.published ? "success" : "neutral"} dot>
                {data.profile.published
                  ? t("dir.liveBadge")
                  : t("dir.hiddenBadge")}
              </Badge>
            ) : undefined
          }
        />
        <ErrorText message={error} />
        <SuccessText message={notice} />
        {!data ? (
          !error && <Loading />
        ) : tab === "requests" ? (
          <>
            {!data.requests.length && (
              <EmptyState
                icon="mail-unread-outline"
                title={t("dir.noRequestsTeacher")}
              />
            )}
            {pending.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                highlight={r.id === focus}
                onDecide={decide}
              />
            ))}
            {!!earlier.length && (
              <Kicker muted>{t("dir.earlierRequests")}</Kicker>
            )}
            {earlier.map((r) => (
              <RequestCard key={r.id} request={r} onDecide={decide} />
            ))}
          </>
        ) : tab === "profile" ? (
          <ProfileEditor
            key={String(data.profile?.photoVersion) + !!data.profile}
            workspaceId={workspaceId}
            showcase={data}
            onSaved={async (message) => {
              setNotice(message);
              await load();
            }}
          />
        ) : (
          <>
            {!!data.ratingCount && (
              <Card>
                <Kicker muted>{t("dir.average")}</Kicker>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Text style={styles.title}>
                    {data.ratingAverage?.toFixed(1)}
                  </Text>
                  <Stars value={data.ratingAverage} size={18} />
                </View>
                <Text style={styles.muted}>
                  {t("dir.reviewCount", { count: data.ratingCount })}
                </Text>
              </Card>
            )}
            <ReviewList
              reviews={data.reviews}
              empty={t("dir.noReviewsTeacher")}
            />
          </>
        )}
      </ScrollView>
      <FormSheet form={form} onClose={() => setForm(null)} />
    </>
  );
}

function RequestCard({
  request: r,
  highlight = false,
  onDecide,
}: {
  request: LessonRequest;
  highlight?: boolean;
  onDecide: (r: LessonRequest, decision: "accept" | "decline") => void;
}) {
  const { styles } = useTheme();
  return (
    <Card tone={highlight ? "brand" : "plain"}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Avatar name={r.studentName} size={42} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.h2} numberOfLines={1}>
            {r.studentName}
          </Text>
          <Text style={styles.muted}>
            {subjectName(r.subject)}
            {r.level ? " · " + levelName(r.level) : ""}
          </Text>
          <Text style={styles.caption}>
            {t("dir.requestFrom", { date: shortDate(r.createdAt) })}
          </Text>
        </View>
      </View>
      {r.status !== "PENDING" && <RequestStatusBadge status={r.status} />}
      <Text style={r.message ? styles.text : styles.muted}>
        {r.message || t("dir.noMessage")}
      </Text>
      <View style={{ gap: 4 }}>
        <Kicker muted>{t("dir.contact")}</Kicker>
        {!!r.email && <Text style={styles.text}>{r.email}</Text>}
        {!!r.phone && <Text style={styles.text}>{r.phone}</Text>}
      </View>
      {r.status === "DECLINED" && !!r.decisionNote && (
        <Text style={styles.muted}>
          {t("dir.yourNote")}: {r.decisionNote}
        </Text>
      )}
      {r.status === "PENDING" && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            icon="checkmark"
            onPress={() => onDecide(r, "accept")}
            style={{ flex: 1 }}
          >
            {t("dir.accept")}
          </Button>
          <Button
            secondary
            onPress={() => onDecide(r, "decline")}
            style={{ flex: 1 }}
          >
            {t("dir.decline")}
          </Button>
        </View>
      )}
    </Card>
  );
}

/** Kare kırpar, 400 piksele küçültür ve JPEG olarak base64 döndürür. */
async function pickPhoto() {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  const side = Math.min(asset.width, asset.height);
  const result = await manipulateAsync(
    asset.uri,
    [
      {
        crop: {
          originX: Math.floor((asset.width - side) / 2),
          originY: Math.floor((asset.height - side) / 2),
          width: side,
          height: side,
        },
      },
      { resize: { width: PHOTO_SIZE, height: PHOTO_SIZE } },
    ],
    { compress: 0.82, format: SaveFormat.JPEG, base64: true },
  );
  if (!result.base64 || (result.base64.length * 3) / 4 > PHOTO_MAX_BYTES)
    throw new Error(t("dir.photoInvalid"));
  return result.base64;
}

function ProfileEditor({
  workspaceId,
  showcase,
  onSaved,
}: {
  workspaceId: string;
  showcase: Showcase;
  onSaved: (message: string) => Promise<void>;
}) {
  const { styles } = useTheme();
  const saved = showcase.profile;
  const [v, setV] = useState({
      displayName: saved?.displayName ?? "",
      headline: saved?.headline ?? "",
      bio: saved?.bio ?? "",
      subjects: (saved?.subjects ?? []) as string[],
      levels: (saved?.levels ?? []) as string[],
      lessonModes: (saved?.lessonModes ?? ["ONLINE"]) as string[],
      city: saved?.city ?? "",
      hourlyPrice:
        saved?.hourlyPrice === null || saved?.hourlyPrice === undefined
          ? ""
          : String(saved.hourlyPrice),
      currency: saved?.currency ?? "TRY",
      languages: (saved?.languages ?? ["tr"]) as string[],
      experienceYears:
        saved?.experienceYears === null || saved?.experienceYears === undefined
          ? ""
          : String(saved.experienceYears),
      // Yeni profil ilk kayıtta yayına girer (web ile aynı).
      published: saved?.published ?? true,
    }),
    [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [error, setError] = useState("");
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) =>
    setV((old) => ({ ...old, [key]: value }));
  const body = (published: boolean): TeacherProfileInput => ({
    displayName: v.displayName,
    headline: v.headline,
    bio: v.bio,
    subjects: v.subjects as TeacherProfileInput["subjects"],
    levels: v.levels as TeacherProfileInput["levels"],
    lessonModes: v.lessonModes as TeacherProfileInput["lessonModes"],
    city: v.city,
    hourlyPrice: v.hourlyPrice ? Number(v.hourlyPrice) : null,
    currency: v.currency,
    languages: v.languages as TeacherProfileInput["languages"],
    experienceYears: v.experienceYears ? Number(v.experienceYears) : null,
    published,
  });
  async function save(published = v.published) {
    setBusy(true);
    setError("");
    try {
      await client.saveShowcase(workspaceId, body(published));
      await onSaved(t("dir.profileSaved"));
    } catch (e) {
      setError((e as Error).message);
      // Anahtar hemen kaydedilir; olmadıysa eski konumuna döner.
      if (published !== v.published) set("published", !published);
    } finally {
      setBusy(false);
    }
  }
  async function photo(action: () => Promise<string | null>) {
    setPhotoBusy(true);
    setError("");
    try {
      const message = await action();
      if (message) await onSaved(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }
  const text = (
    key: "displayName" | "headline" | "city",
    title: string,
    options: { placeholder?: string; required?: boolean; max: number },
  ) => (
    <Field label={title} required={options.required}>
      <Input
        value={v[key]}
        onChangeText={(x) => set(key, x)}
        placeholder={options.placeholder}
        maxLength={options.max}
      />
    </Field>
  );
  return (
    <>
      {!saved && (
        <Card tone="brand">
          <Text style={styles.text}>{t("dir.setupFirst")}</Text>
        </Card>
      )}
      <Card>
        <Kicker muted>{t("dir.photo")}</Kicker>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <TeacherPhoto
            id={workspaceId}
            version={saved?.photoVersion ?? null}
            name={v.displayName || "?"}
            size={72}
          />
          <View style={{ flex: 1, gap: 8 }}>
            {saved ? (
              <>
                <Button
                  secondary
                  size="sm"
                  icon="image-outline"
                  loading={photoBusy}
                  onPress={() =>
                    void photo(async () => {
                      const data = await pickPhoto();
                      if (!data) return null;
                      await client.saveShowcasePhoto(workspaceId, {
                        mimeType: "image/jpeg",
                        data,
                      });
                      return t("dir.photoSaved");
                    })
                  }
                >
                  {saved.photoVersion
                    ? t("dir.changePhoto")
                    : t("dir.uploadPhoto")}
                </Button>
                {!!saved.photoVersion && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash-outline"
                    disabled={photoBusy}
                    onPress={() =>
                      void photo(async () => {
                        await client.deleteShowcasePhoto(workspaceId);
                        return t("dir.photoRemoved");
                      })
                    }
                  >
                    {t("dir.removePhoto")}
                  </Button>
                )}
              </>
            ) : (
              <Text style={styles.muted}>{t("dir.photoAfterSave")}</Text>
            )}
          </View>
        </View>
        {!!saved && <Text style={styles.hint}>{t("dir.photoHint")}</Text>}
      </Card>
      <Card>
        <Toggle
          label={t("dir.published")}
          hint={t("dir.publishedHint")}
          value={v.published}
          disabled={busy}
          onChange={(on) => {
            set("published", on);
            // Profil zaten varsa anahtar hemen kaydedilir (web ile aynı).
            if (saved) void save(on);
          }}
        />
      </Card>
      {text("displayName", t("dir.displayName"), { max: 80 })}
      {text("headline", t("dir.headline"), {
        placeholder: t("dir.headlinePlaceholder"),
        required: false,
        max: 120,
      })}
      <Field label={t("dir.bio")} required={false}>
        <Input
          multiline
          value={v.bio}
          onChangeText={(x) => set("bio", x)}
          placeholder={t("dir.bioPlaceholder")}
          maxLength={2000}
        />
      </Field>
      <Field label={t("dir.subjects")} hint={t("dir.pickSubjects")}>
        <ChipGroup
          label={t("dir.subjects")}
          max={6}
          value={v.subjects}
          onChange={(x) => set("subjects", x)}
          options={teacherSubjects.map((s) => ({
            value: s,
            label: subjectName(s),
          }))}
        />
      </Field>
      <Field label={t("dir.levels")} required={false}>
        <ChipGroup
          label={t("dir.levels")}
          value={v.levels}
          onChange={(x) => set("levels", x)}
          options={teacherLevels.map((s) => ({
            value: s,
            label: levelName(s),
          }))}
        />
      </Field>
      <Field label={t("dir.lessonModes")}>
        <ChipGroup
          label={t("dir.lessonModes")}
          value={v.lessonModes}
          onChange={(x) => set("lessonModes", x)}
          options={lessonModes.map((m) => ({ value: m, label: modeName(m) }))}
        />
      </Field>
      {text("city", t("dir.city"), {
        required: v.lessonModes.includes("IN_PERSON"),
        max: 60,
      })}
      <Field
        label={t("dir.hourlyPrice")}
        hint={t("dir.priceHint")}
        required={false}
      >
        <Input
          value={v.hourlyPrice}
          onChangeText={(x) => set("hourlyPrice", x.replace(/\D/g, ""))}
          keyboardType="number-pad"
          placeholder={t("dir.priceOnRequest")}
        />
      </Field>
      <Segmented
        label={t("dir.currency")}
        value={v.currency}
        onChange={(x) => set("currency", x as typeof v.currency)}
        options={priceCurrencies.map((c) => ({ value: c, label: c }))}
      />
      <Field label={t("dir.languages")} required={false}>
        <ChipGroup
          label={t("dir.languages")}
          value={v.languages}
          onChange={(x) => set("languages", x)}
          options={teachingLanguages.map((l) => ({
            value: l,
            label: langName(l),
          }))}
        />
      </Field>
      <Field label={t("dir.experienceYears")} required={false}>
        <Input
          value={v.experienceYears}
          onChangeText={(x) =>
            set("experienceYears", x.replace(/\D/g, "").slice(0, 2))
          }
          keyboardType="number-pad"
        />
      </Field>
      <ErrorText message={error} />
      <Button icon="checkmark" loading={busy} onPress={() => void save()}>
        {t("dir.saveProfile")}
      </Button>
    </>
  );
}
