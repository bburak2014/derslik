import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { fetch as expoFetch } from "expo/fetch";
import {
  uploadTus,
  type Access,
  type LearningData,
  type Material,
  type PortalData,
  type Video,
} from "@derslik/api-client";
import {
  canEditSubmission,
  dateKey,
  dayLabel,
  money,
  noticeTarget,
  noticeText,
  t,
  timeLabel,
  type Notice,
  type NoticeTarget,
} from "@derslik/contracts";
import { request } from "./core";
import {
  Avatar,
  Badge,
  type BadgeTone,
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
  type IconName,
  InkFigures,
  InkPanel,
  Kicker,
  LessonStatus,
  List,
  ListRow,
  Loading,
  Meter,
  SectionHeading,
  TabStrip,
  TextLink,
  useTheme,
} from "./ui";
import { setStringAsync } from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { PdfViewer } from "./PdfViewer";
import { MediaPlayer } from "./MediaPlayer";
const empty: LearningData = {
  lessons: [],
  assignments: [],
  submissions: [],
  notes: [],
  videos: [],
  questions: [],
  materials: [],
  summaries: [],
  progress: [],
};
/** Bildirimden açılan yer; `at` aynı bildirime yeniden dokununca değişir. */
export type NoticeFocus = NoticeTarget & { at: number };

export function PortalScreen({
  access,
  onAccount,
  focus,
  onNotice,
}: {
  access: Access;
  onAccount: () => void;
  focus?: NoticeFocus | null;
  onNotice?: (target: NoticeTarget) => void;
}) {
  return (
    <LearningScreen
      access={access}
      studentId={access.studentId!}
      studentName={access.studentName!}
      onBack={onAccount}
      focus={focus}
      onNotice={onNotice}
    />
  );
}
export type TeachingView = "assignments" | "files" | "videos";

/**
 * Seçilen dosyayı bayt olarak okur.
 *
 * expo-file-system'in iki API'si de işe yaramıyor: Expo Go, FileSystem'i
 * kendi deneyim klasörüne kapsıyor, DocumentPicker ise kopyayı Expo Go'nun
 * uygulama önbelleğine (cache/DocumentPicker/...) bırakıyor. Yeni API
 * "Missing READ permission", eskisi "isn't readable" diyor.
 *
 * Ağ katmanının blob okuyucusu bu kapsam kontrolünden geçmiyor, o yüzden
 * içeriği oradan alıp FileReader ile bayta çeviriyoruz.
 */
async function readFileBytes(uri: string) {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("ml.readFailed")));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isImageName(name: string) {
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(name);
}

export function LearningScreen({
  access,
  studentId,
  studentName,
  onBack,
  view,
  focus,
  onNotice,
}: {
  access: Access;
  studentId: string;
  studentName: string;
  onBack: () => void;
  /** Tek bir bölümü gömülü göstermek için (Öğretim sekmesi). Verilince
   *  ekranın kendi başlığı ve sekme şeridi çizilmez. */
  view?: TeachingView;
  /** Bildirimden gelinen kayıt: bölümü açılır, karta kaydırılıp kısa süre
   *  vurgulanır. */
  focus?: NoticeFocus | null;
  /** Bildirimler sekmesinde bir bildirime dokunulunca. */
  onNotice?: (target: NoticeTarget) => void;
}) {
  const { colors, styles, section } = useTheme();
  const owner = access.role === "OWNER",
    student = access.role === "STUDENT";
  const [capabilities, setCapabilities] = useState<{
    files: boolean;
    videos: boolean;
  } | null>(null);
  // Ekranın SafeAreaView'ı alt kenarı kapsamıyor; kaydırma içeriği alt güvenli
  // alan kadar boşluk bırakıyor ki son kart home indicator altında kalmasın.
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LearningData | PortalData>(empty),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState(view ?? (owner ? "assignments" : "lessons")),
    [invite, setInvite] = useState<{
      url: string;
      email: string;
      emailed: boolean;
    } | null>(null),
    [copied, setCopied] = useState(false),
    // Görsel önizlemesi uygulama içinde açılır; PDF'i Android tarayıcısı
    // çizemediği için o sistem görüntüleyicisine gider.
    [preview, setPreview] = useState<{
      name: string;
      url: string;
      kind: "image" | "pdf";
    } | null>(null),
    [form, setForm] = useState<FormSpec | null>(null),
    [busy, setBusy] = useState(false),
    [video, setVideo] = useState<Video | null>(null),
    [upload, setUpload] = useState<{
      asset: DocumentPicker.DocumentPickerAsset;
      id: string;
      url: string;
    } | null>(null),
    [progress, setProgress] = useState<number | null>(null),
    [links, setLinks] = useState<any>(null);
  const inFlight = useRef(false),
    fileReservations = useRef(new Map<string, string>());
  // Bildirim hedefi: kartların kaydırma içindeki yeri onLayout ile tutulur;
  // hedef kart yerleşince (ya da zaten yerindeyse) oraya kaydırılır.
  const scroller = useRef<ScrollView>(null),
    spots = useRef(new Map<string, number>()),
    pending = useRef<string | null>(null),
    [appliedFocus, setAppliedFocus] = useState(0),
    [highlight, setHighlight] = useState<string | null>(null);
  if (
    focus &&
    focus.at !== appliedFocus &&
    focus.workspaceId === access.id &&
    focus.studentId === studentId
  ) {
    setAppliedFocus(focus.at);
    if (!view) setTab(focus.section);
    setHighlight(focus.itemId);
  }
  useEffect(() => {
    if (!highlight) return;
    pending.current = highlight;
    // Hedef zaten ekrandaysa onLayout yeniden gelmez; kısa bir bekleyişten
    // sonra bilinen konuma kaydırılır.
    const scroll = setTimeout(() => {
      const y = spots.current.get(highlight);
      if (pending.current === highlight && y !== undefined) {
        pending.current = null;
        scroller.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
      }
    }, 300);
    const clear = setTimeout(() => setHighlight(null), 2600);
    return () => {
      clearTimeout(scroll);
      clearTimeout(clear);
    };
  }, [highlight, appliedFocus]);
  const spot = (id: string) => ({
    onLayout: (e: { nativeEvent: { layout: { y: number } } }) => {
      const y = e.nativeEvent.layout.y;
      spots.current.set(id, y);
      if (pending.current === id) {
        pending.current = null;
        scroller.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
      }
    },
    style:
      highlight === id
        ? { borderColor: colors.marker, borderWidth: 2 }
        : undefined,
  });
  const base = owner
      ? `/workspaces/${access.id}/students/${studentId}/learning`
      : `/portal/${access.id}/${studentId}`,
    media = `/media/${access.id}/${studentId}`;
  const reload = useCallback(async () => {
    try {
      const [result, status] = await Promise.all([
        request(base),
        request("/media/capabilities").catch(() => ({
          files: false,
          videos: false,
        })),
      ]);
      setData(result);
      setCapabilities(status);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [base]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function action(command: unknown) {
    if (inFlight.current) throw new Error(t("mt.busy"));
    inFlight.current = true;
    try {
      await request(owner ? base : base + "/actions", command);
      await reload();
    } finally {
      inFlight.current = false;
    }
  }
  const formAction = (
    title: string,
    fields: FormSpec["fields"],
    convert: (v: Record<string, string>) => unknown,
  ) =>
    setForm({
      title,
      fields,
      submit: async (v) => {
        await action(convert(v));
      },
    });
  const permissions = owner
    ? ["assignments", "lessons", "videos", "notes", "payments"]
    : (data as PortalData).permissions || [];
  const tabs = [
    { id: "lessons", label: t("nav.lessons"), permission: "lessons" },
    {
      id: "assignments",
      label: t("nav.assignments"),
      permission: "assignments",
    },
    { id: "files", label: t("nav.files"), permission: "assignments" },
    { id: "videos", label: t("mt.videos"), permission: "videos" },
    { id: "notes", label: t("nav.notes"), permission: "notes" },
    ...(owner
      ? [{ id: "access", label: t("learn.tabAccess"), permission: "lessons" }]
      : [{ id: "payments", label: t("ml.balance"), permission: "payments" }]),
    { id: "inbox", label: t("inbox.title"), permission: "lessons" },
  ].filter((x) => permissions.includes(x.permission));
  useEffect(() => {
    if (view) return;
    if (tabs.length && !tabs.some((x) => x.id === tab)) setTab(tabs[0].id);
  }, [permissions.join(","), tab, view]);
  async function loadLinks() {
    try {
      setLinks(
        await request(`/workspaces/${access.id}/students/${studentId}/access`),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function attach(assignmentId: string | null) {
    if (!capabilities?.files) {
      setError(t("learn.uploadUnavailable"));
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    setBusy(true);
    setError("");
    try {
      // DocumentPicker dosyayı Expo Go'nun kendi önbelleğine kopyalıyor
      // (cache/DocumentPicker/...). expo-file-system'in yeni kapsamlı API'si
      // orayı proje kapsamı dışında saydığı için `exists` false dönüyor ve
      // okuma "Missing READ permission" ile reddediliyor. Eski API kapsam
      // kontrolü yapmıyor; hem bu yolu hem content:// adreslerini okuyabiliyor.
      if ((asset.size ?? 0) > 10 * 1024 ** 2)
        throw new Error(t("ml.fileTooLarge"));
      const bytes = await readFileBytes(asset.uri);
      if (bytes.byteLength > 10 * 1024 ** 2)
        throw new Error(t("ml.fileTooLarge"));
      const fingerprint = [assignmentId, asset.name, bytes.byteLength].join(
          ":",
        ),
        reserved = fileReservations.current.get(fingerprint);
      let id = reserved;
      if (!id) {
        const r = await request(media + "/files", {
          assignmentId,
          purpose: owner
            ? assignmentId
              ? "ASSIGNMENT"
              : "RESOURCE"
            : "SUBMISSION",
          name: asset.name,
          mimeType: asset.mimeType || "application/octet-stream",
          sizeBytes: bytes.byteLength,
        });
        id = r.data.id;
        fileReservations.current.set(fingerprint, id!);
        if (r.data.uploadUrl) {
          const sent = await expoFetch(r.data.uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": asset.mimeType || "application/octet-stream",
              "x-upsert": "false",
            },
            body: bytes,
          });
          if (!sent.ok && sent.status !== 409) {
            fileReservations.current.delete(fingerprint);
            throw new Error(t("learn.uploadFailed"));
          }
        }
      }
      try {
        await request(media + `/files/${id}/finish`, {});
      } catch (e) {
        fileReservations.current.delete(fingerprint);
        throw e;
      }
      fileReservations.current.delete(fingerprint);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendVideo(session: {
    asset: DocumentPicker.DocumentPickerAsset;
    id: string;
    url: string;
  }) {
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      // Dosya okuması, PDF/görsel yüklemesiyle aynı sebepten FileSystem API'si
      // üzerinden yapılamıyor: Expo Go, DocumentPicker'ın bıraktığı yolu
      // kapsam dışı sayıyor. Blob parçalara ayrılırken kopyalanmıyor, bu yüzden
      // büyük videolar da bellek şişirmeden gönderilebiliyor.
      const blob = await (await fetch(session.asset.uri)).blob();
      await uploadTus(
        session.url,
        {
          size: blob.size,
          slice: (start, end) => blob.slice(start, end) as unknown as BodyInit,
        },
        {
          fetch: expoFetch as unknown as typeof fetch,
          onProgress: setProgress,
        },
      );
      await request(media + `/videos/${session.id}/refresh`, {});
      setUpload(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function chooseVideo() {
    if (!capabilities?.videos) {
      setError(t("ml.videoUnavailable"));
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "video/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if ((asset.size ?? 0) > 2 * 1024 ** 3)
        throw new Error(t("ml.videoTooLarge"));
      setForm({
        title: t("ml.uploadVideo"),
        description: `${asset.name} · ${t("ml.videoMaxHours")}`,
        fields: [
          {
            key: "title",
            label: t("learn.videoTitle"),
            value: asset.name.replace(/\.[^.]+$/, ""),
          },
          {
            key: "lessonId",
            label: t("learn.lesson"),
            options: [
              { value: "", label: t("learn.generalVideo") },
              ...data.lessons.map((l) => ({
                value: l.id,
                label: `${l.topic} · ${dateKey(l.starts_at)}`,
              })),
            ],
            required: false,
          },
          {
            key: "duration",
            label: t("ml.maxDuration"),
            value: "60",
            keyboard: "decimal-pad",
          },
        ],
        submit: async (v) => {
          const r = await request(media + "/videos", {
            title: v.title,
            lessonId: v.lessonId || null,
            sizeBytes: asset.size ?? 0,
            maxDurationSeconds: Number(v.duration) * 60,
          });
          const session = { asset, id: r.data.id, url: r.data.uploadUrl };
          setUpload(session);
          void sendVideo(session);
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Silme iki yerden çağrılıyor (hazır dosya satırı ve bekleyen satır).
  function removeFile(file: Material) {
    confirmAction(
      t("ml.deleteFile"),
      t("ml.deleteFileBody"),
      async () => {
        setBusy(true);
        try {
          await request(media + `/files/${file.id}/delete`, {});
          await reload();
        } catch (e) {
          await reload();
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      },
      setError,
    );
  }
  if (loading) return <Loading />;
  const assignmentState = (
    a: LearningData["assignments"][number],
    sub?: LearningData["submissions"][number],
  ): [BadgeTone, string] =>
    a.status === "CANCELLED"
      ? ["neutral", t("lesson.cancelled")]
      : a.status === "COMPLETED"
        ? ["success", t("lesson.completed")]
        : sub
          ? sub.status === "REVIEWED"
            ? ["success", t("learn.reviewed")]
            : ["info", t("learn.submitted")]
          : a.due_on && a.due_on < dateKey()
            ? ["danger", t("learn.late")]
            : ["warning", t("learn.awaiting")];
  return (
    <SafeAreaView
      style={styles.screen}
      edges={view ? ["left", "right"] : ["top", "left", "right"]}
    >
      {!view && (
        <View style={styles.header}>
          {owner ? (
            <Button
              variant="ghost"
              size="sm"
              icon="chevron-back"
              onPress={onBack}
              style={{ marginLeft: -10 }}
            >
              {t("mt.studentFile")}
            </Button>
          ) : (
            <Brand />
          )}
          {!owner && (
            <Button
              secondary
              size="sm"
              icon="person-circle-outline"
              onPress={onBack}
            >
              {t("mt.myAccount")}
            </Button>
          )}
        </View>
      )}
      {!view && (
        <TabStrip
          tabs={tabs}
          value={tab}
          onChange={(id) => {
            setTab(id);
            if (id === "access") void loadLinks();
          }}
        />
      )}
      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            colors={[colors.brand]}
            onRefresh={() => {
              setRefreshing(true);
              void reload();
            }}
          />
        }
        contentContainerStyle={[
          styles.body,
          { paddingBottom: 44 + insets.bottom },
        ]}
      >
        {!view && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Avatar name={studentName} size={52} />
            <View style={{ flex: 1, gap: 4 }}>
              <Kicker>
                {owner
                  ? t("ml.learningArea")
                  : student
                    ? t("ml.studentArea")
                    : t("ml.guardianArea")}
              </Kicker>
              <Text style={styles.title} numberOfLines={2}>
                {studentName}
              </Text>
            </View>
          </View>
        )}
        <ErrorText message={error} />
        {!!error && (
          <Button
            secondary
            icon="refresh-outline"
            style={{ alignSelf: "flex-start" }}
            onPress={() => void reload()}
          >
            {t("ml.reload")}
          </Button>
        )}
        {(owner || student) &&
          ((tab === "videos" && !capabilities?.videos) ||
            (["assignments", "files"].includes(tab) &&
              !capabilities?.files)) && (
            <Card tone="muted">
              <View style={[styles.row, { gap: 8 }]}>
                <Ionicons
                  name="cloud-offline-outline"
                  size={18}
                  color={colors.muted}
                />
                <Text style={styles.h2}>
                  {tab === "videos"
                    ? t("ml.videoNotReady")
                    : t("ml.fileNotReady")}
                </Text>
              </View>
              <Text style={styles.muted}>{t("learn.uploadServiceDown")}</Text>
              <Button
                secondary
                size="sm"
                icon="refresh-outline"
                style={{ alignSelf: "flex-start" }}
                onPress={() => void reload()}
              >
                {t("learn.checkAgain")}
              </Button>
            </Card>
          )}
        {tab === "lessons" && (
          <>
            {!data.lessons.length && (
              <EmptyState
                icon="calendar-outline"
                title={t("learn.noLessons")}
                description={t("learn.noLessonsHint")}
              />
            )}
            {data.lessons.map((l) => (
              <Card key={l.id}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <DateTile date={l.starts_at} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <Text style={[styles.h2, { flex: 1 }]} numberOfLines={2}>
                        {l.topic}
                      </Text>
                      <LessonStatus status={l.status} />
                    </View>
                    <View style={[styles.row, { gap: 5 }]}>
                      <Ionicons
                        name="time-outline"
                        size={14}
                        color={colors.faint}
                      />
                      <Text style={styles.caption}>
                        {dayLabel(l.starts_at, { weekday: "long" })} ·{" "}
                        {timeLabel(l.starts_at)}–{timeLabel(l.ends_at)}
                      </Text>
                    </View>
                    <View style={[styles.row, { gap: 5 }]}>
                      <Ionicons
                        name="location-outline"
                        size={14}
                        color={colors.faint}
                      />
                      <Text style={styles.caption}>
                        {l.location || t("lesson.noLocation")}
                      </Text>
                    </View>
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}
        {tab === "assignments" && (
          <>
            {owner && (
              <Button
                icon="add"
                onPress={() =>
                  formAction(
                    t("notice.assignmentNew"),
                    [
                      { key: "title", label: t("learn.title") },
                      {
                        key: "instructions",
                        label: t("learn.instructions"),
                        multiline: true,
                        required: false,
                      },
                      {
                        key: "dueOn",
                        label: t("ml.dueField"),
                        required: false,
                        value: dateKey(),
                      },
                    ],
                    (v) => ({ action: "assignment.create", ...v }),
                  )
                }
              >
                {t("learn.assign")}
              </Button>
            )}
            {!data.assignments.length && (
              <EmptyState
                icon="clipboard-outline"
                title={t("learn.noAssignments")}
                description={t("learn.noAssignmentsHint")}
              />
            )}
            {data.assignments.map((a) => {
              const sub = data.submissions.find(
                (s) => s.assignment_id === a.id,
              );
              const [tone, state] = assignmentState(a, sub);
              const editable = canEditSubmission(a, !!sub);
              return (
                <Card key={a.id} {...spot(a.id)}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <Text style={[styles.h2, { flex: 1 }]}>{a.title}</Text>
                    <Badge tone={tone} dot>
                      {state}
                    </Badge>
                  </View>
                  <View style={[styles.row, { gap: 5, marginTop: -4 }]}>
                    <Ionicons
                      name="flag-outline"
                      size={14}
                      color={colors.faint}
                    />
                    <Text style={styles.caption}>
                      {a.due_on
                        ? t("learn.dueDate", {
                            date: dayLabel(a.due_on + "T12:00:00+03:00"),
                          })
                        : t("learn.noDueDate")}
                    </Text>
                  </View>
                  {student && sub && a.status === "OPEN" && (
                    <Text style={[styles.caption, { marginTop: -4 }]}>
                      {editable
                        ? a.due_on
                          ? t("ml.editableToday")
                          : t("ml.editableAnytime")
                        : t("ml.locked")}
                    </Text>
                  )}
                  {!!a.instructions && (
                    <Text style={styles.text}>{a.instructions}</Text>
                  )}
                  {sub && (
                    <View style={section.quote}>
                      <Text style={styles.label}>
                        {t("learn.studentSubmission")}
                      </Text>
                      <Text style={styles.text}>{sub.body}</Text>
                      {!!sub.feedback && (
                        <>
                          <Text style={[styles.label, { marginTop: 6 }]}>
                            {t("learn.teacherFeedback")}
                          </Text>
                          <Text style={styles.text}>{sub.feedback}</Text>
                        </>
                      )}
                    </View>
                  )}
                  {data.materials
                    .filter((m) => m.assignment_id === a.id)
                    .map((m) => (
                      <Button
                        key={m.id}
                        secondary
                        size="sm"
                        icon="document-attach-outline"
                        trailingIcon="open-outline"
                        style={{ alignSelf: "flex-start", maxWidth: "100%" }}
                        disabled={m.status !== "READY" || m.delete_requested}
                        onPress={async () => {
                          try {
                            const r = await request(
                              media + `/files/${m.id}/download`,
                            );
                            await Linking.openURL(r.data.url);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        {m.name}
                        {m.status !== "READY"
                          ? ` (${t("ml.uploadingShort")})`
                          : ""}
                      </Button>
                    ))}
                  <View style={styles.row}>
                    {owner && (
                      <Button
                        secondary
                        size="sm"
                        icon="create-outline"
                        style={{ flexGrow: 1 }}
                        onPress={() =>
                          formAction(
                            t("learn.editAssignment"),
                            [
                              {
                                key: "title",
                                label: t("learn.title"),
                                value: a.title,
                              },
                              {
                                key: "instructions",
                                label: t("learn.instructions"),
                                value: a.instructions,
                                multiline: true,
                                required: false,
                              },
                              {
                                key: "dueOn",
                                label: t("ml.dueField"),
                                value: a.due_on || "",
                                required: false,
                              },
                              {
                                key: "status",
                                label: t("common.status"),
                                value: a.status,
                                options: [
                                  {
                                    value: "OPEN",
                                    label: t("learn.inProgress"),
                                  },
                                  {
                                    value: "COMPLETED",
                                    label: t("lesson.completed"),
                                  },
                                  {
                                    value: "CANCELLED",
                                    label: t("lesson.cancelled"),
                                  },
                                ],
                              },
                            ],
                            (v) => ({
                              action: "assignment.update",
                              assignmentId: a.id,
                              version: a.version,
                              ...v,
                            }),
                          )
                        }
                      >
                        {t("common.edit")}
                      </Button>
                    )}
                    {student && editable && (
                      <Button
                        size="sm"
                        icon="paper-plane-outline"
                        style={{ flexGrow: 1 }}
                        onPress={() =>
                          formAction(
                            sub
                              ? t("learn.editSubmission")
                              : t("learn.submitTitle"),
                            [
                              {
                                key: "body",
                                label: t("learn.yourAnswer"),
                                multiline: true,
                                value: sub?.body,
                              },
                            ],
                            (v) => ({
                              action: "assignment.submit",
                              assignmentId: a.id,
                              body: v.body,
                              version: sub?.version || 0,
                            }),
                          )
                        }
                      >
                        {sub ? t("learn.editSubmission") : t("learn.submit")}
                      </Button>
                    )}
                    {owner && sub && (
                      <Button
                        size="sm"
                        icon="chatbubble-ellipses-outline"
                        style={{ flexGrow: 1 }}
                        onPress={() =>
                          formAction(
                            t("learn.reviewTitle"),
                            [
                              {
                                key: "feedback",
                                label: t("learn.feedback"),
                                multiline: true,
                                value: sub.feedback,
                              },
                            ],
                            (v) => ({
                              action: "assignment.review",
                              submissionId: sub.id,
                              feedback: v.feedback,
                              version: sub.version,
                            }),
                          )
                        }
                      >
                        {t("learn.writeFeedback")}
                      </Button>
                    )}
                    {(owner || (student && editable)) && (
                      <Button
                        secondary
                        size="sm"
                        icon="attach-outline"
                        style={{ flexGrow: 1 }}
                        disabled={busy || !capabilities?.files}
                        onPress={() => void attach(a.id)}
                      >
                        {busy ? t("learn.uploading") : t("learn.addFile")}
                      </Button>
                    )}
                  </View>
                </Card>
              );
            })}
          </>
        )}
        {tab === "files" && (
          <>
            {owner && (
              <Button
                icon="cloud-upload-outline"
                disabled={busy || !capabilities?.files}
                onPress={() => void attach(null)}
              >
                {busy ? t("learn.uploading") : t("ml.uploadMaterial")}
              </Button>
            )}
            <Text style={styles.caption}>{t("ml.fileNote")}</Text>
            {!data.materials.length && (
              <EmptyState
                icon="document-text-outline"
                title={t("learn.noFiles")}
                description={t("learn.noFilesHint")}
              />
            )}
            {!!data.materials.length && (
              <List>
                {data.materials.map((file, i) => {
                  const ready =
                    file.status === "READY" && !file.delete_requested;
                  return (
                    <ListRow key={file.id} divider={i > 0}>
                      <FileIcon
                        icon={
                          isImageName(file.name)
                            ? "image-outline"
                            : "document-text-outline"
                        }
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.label} numberOfLines={2}>
                          {file.name}
                        </Text>
                        <Text style={styles.caption} numberOfLines={1}>
                          {!ready
                            ? file.delete_requested
                              ? t("learn.deletePending")
                              : t("learn.uploadIncomplete")
                            : file.assignment_id
                              ? data.assignments.find(
                                  (a) => a.id === file.assignment_id,
                                )?.title
                              : t("learn.generalMaterial")}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {ready && (
                          <IconButton
                            icon="eye-outline"
                            label={t("learn.preview")}
                            onPress={async () => {
                              try {
                                // inline=1: bağlantı indirme yerine
                                // görüntülenmek üzere imzalanır.
                                const r = await request(
                                  media + `/files/${file.id}/download?inline=1`,
                                );
                                // Görsel yerel olarak, PDF pdf.js ile çizilir;
                                // ikisi de uygulamadan çıkmadan açılır.
                                setPreview({
                                  name: file.name,
                                  url: r.data.url,
                                  kind: isImageName(file.name)
                                    ? "image"
                                    : "pdf",
                                });
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          />
                        )}
                        {ready && (
                          <IconButton
                            icon="download-outline"
                            label={t("learn.download")}
                            onPress={async () => {
                              try {
                                const r = await request(
                                  media + `/files/${file.id}/download`,
                                );
                                await Linking.openURL(r.data.url);
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          />
                        )}
                        {owner && (
                          <IconButton
                            danger
                            icon="trash-outline"
                            label={
                              file.delete_requested
                                ? t("learn.retryDelete")
                                : t("ml.deleteFile")
                            }
                            disabled={busy}
                            onPress={() => removeFile(file)}
                          />
                        )}
                      </View>
                    </ListRow>
                  );
                })}
              </List>
            )}
          </>
        )}
        {tab === "videos" && (
          <>
            {owner && (
              <Button
                icon="videocam-outline"
                disabled={busy || !capabilities?.videos}
                onPress={() => void chooseVideo()}
              >
                {t("ml.uploadVideo")}
              </Button>
            )}
            {progress !== null && (
              <Card>
                <Meter
                  label={t("ml.videoUploading")}
                  used={Math.round(progress * 100)}
                  limit={100}
                  unit="%"
                />
              </Card>
            )}
            {upload && !busy && (
              <Button
                secondary
                icon="play-forward-outline"
                onPress={() => void sendVideo(upload)}
              >
                {t("ml.resumeUpload")}
              </Button>
            )}
            {!data.videos.length && (
              <EmptyState
                icon="videocam-outline"
                title={t("learn.noVideos")}
                description={t("learn.noVideosHint")}
              />
            )}
            {data.videos.map((v) => {
              const ready = v.status === "READY" && !v.delete_requested;
              return (
                <Card key={v.id} {...spot(v.id)}>
                  <View style={[styles.row, { flexWrap: "nowrap", gap: 12 }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("ml.watchVideoLabel", {
                        title: v.title,
                      })}
                      disabled={!ready}
                      onPress={() => setVideo(v)}
                      style={({ pressed }) => [
                        section.videoThumb,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Ionicons
                        name={ready ? "play" : "hourglass-outline"}
                        size={20}
                        color={colors.onFeature}
                      />
                    </Pressable>
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={styles.h2} numberOfLines={2}>
                        {v.title}
                      </Text>
                      <Badge
                        tone={
                          v.delete_requested || v.status === "FAILED"
                            ? "danger"
                            : v.status === "READY"
                              ? "success"
                              : "warning"
                        }
                        icon={
                          v.status === "READY" && !v.delete_requested
                            ? "time-outline"
                            : undefined
                        }
                        dot={!(v.status === "READY" && !v.delete_requested)}
                      >
                        {v.delete_requested
                          ? t("learn.deletePending")
                          : v.status === "READY"
                            ? t("learn.minutes", {
                                count: Math.ceil(
                                  (v.duration_seconds || 0) / 60,
                                ),
                              })
                            : v.status === "FAILED"
                              ? t("learn.videoFailed")
                              : t("learn.videoPreparing")}
                      </Badge>
                    </View>
                  </View>
                  <View style={styles.row}>
                    {ready && (
                      <Button
                        size="sm"
                        icon="play-outline"
                        style={{ flexGrow: 1 }}
                        onPress={() => setVideo(v)}
                      >
                        {t("ml.watchVideo")}
                      </Button>
                    )}
                    {owner && (
                      <>
                        <IconButton
                          icon="refresh-outline"
                          label={t("ml.refreshStatus")}
                          disabled={busy}
                          onPress={async () => {
                            try {
                              await request(
                                media + `/videos/${v.id}/refresh`,
                                {},
                              );
                              await reload();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        />
                        <IconButton
                          danger
                          icon="trash-outline"
                          label={t("ml.deleteVideo")}
                          disabled={busy}
                          onPress={() =>
                            confirmAction(
                              t("ml.deleteVideo"),
                              t("ml.deleteVideoBody"),
                              async () => {
                                await request(
                                  media + `/videos/${v.id}/delete`,
                                  {},
                                );
                                await reload();
                              },
                              setError,
                            )
                          }
                        />
                      </>
                    )}
                  </View>
                  {data.questions
                    .filter((q) => q.video_id === v.id)
                    .map((q) => (
                      <View key={q.id} style={section.quote}>
                        <View style={[styles.row, { gap: 6 }]}>
                          <Ionicons
                            name="help-circle-outline"
                            size={15}
                            color={colors.brand}
                          />
                          <Text style={styles.label}>
                            {Math.floor(q.at_seconds / 60)}:
                            {String(q.at_seconds % 60).padStart(2, "0")} ·{" "}
                            {t("ml.question")}
                          </Text>
                          {q.resolved && (
                            <Badge tone="success" icon="checkmark">
                              {t("learn.answered")}
                            </Badge>
                          )}
                        </View>
                        <Text style={styles.text}>{q.body}</Text>
                        {!!q.answer && (
                          <Text style={styles.muted}>
                            {t("ml.answerLine", { answer: q.answer })}
                          </Text>
                        )}
                        {owner && (
                          <View style={{ alignSelf: "flex-start" }}>
                            <TextLink
                              icon="arrow-undo-outline"
                              onPress={() =>
                                formAction(
                                  t("ml.answerTitle"),
                                  [
                                    {
                                      key: "answer",
                                      label: t("ml.answer"),
                                      value: q.answer,
                                      multiline: true,
                                    },
                                  ],
                                  (v) => ({
                                    action: "question.answer",
                                    questionId: q.id,
                                    answer: v.answer,
                                    resolved: true,
                                    version: q.version,
                                  }),
                                )
                              }
                            >
                              {t("learn.reply")}
                            </TextLink>
                          </View>
                        )}
                      </View>
                    ))}
                </Card>
              );
            })}
          </>
        )}
        {tab === "notes" && (
          <>
            {owner && (
              <View style={styles.row}>
                <Button
                  icon="create-outline"
                  style={{ flexGrow: 1 }}
                  onPress={() =>
                    formAction(
                      t("learn.shareNote"),
                      [
                        { key: "body", label: t("mt.note"), multiline: true },
                        {
                          key: "audience",
                          label: t("learn.audience"),
                          value: "BOTH",
                          options: [
                            { value: "BOTH", label: t("learn.audienceBoth") },
                            {
                              value: "STUDENT",
                              label: t("learn.audienceStudent"),
                            },
                          ],
                        },
                      ],
                      (v) => ({ action: "note.publish", ...v }),
                    )
                  }
                >
                  {t("learn.shareNote")}
                </Button>
                <Button
                  secondary
                  icon="sparkles-outline"
                  style={{ flexGrow: 1 }}
                  onPress={() =>
                    formAction(
                      t("learn.summaryTitle"),
                      [
                        {
                          key: "weekOn",
                          label: t("ml.weekStartField"),
                          value: dateKey(),
                        },
                      ],
                      (v) => ({ action: "summary.draft", ...v }),
                    )
                  }
                >
                  {t("ml.summaryDraft")}
                </Button>
              </View>
            )}
            {data.summaries.map((s) => (
              <Card key={s.id} {...spot(s.id)}>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Kicker>{t("learn.weeklySummary")}</Kicker>
                  <Badge
                    tone={s.status === "DRAFT" ? "warning" : "success"}
                    dot
                  >
                    {s.status === "DRAFT"
                      ? t("learn.draft")
                      : t("learn.shared")}
                  </Badge>
                </View>
                <Text style={styles.h2}>
                  {t("learn.weekOf", { date: s.week_on })}
                </Text>
                <Text style={styles.text}>{s.body}</Text>
                {owner && (
                  <Button
                    secondary
                    size="sm"
                    icon={
                      s.status === "DRAFT" ? "checkmark-done" : "create-outline"
                    }
                    style={{ alignSelf: "flex-start" }}
                    onPress={() =>
                      formAction(
                        t("learn.reviewSummary"),
                        [
                          {
                            key: "body",
                            label: t("learn.summary"),
                            value: s.body,
                            multiline: true,
                          },
                        ],
                        (v) => ({
                          action: "summary.publish",
                          summaryId: s.id,
                          body: v.body,
                          version: s.version,
                        }),
                      )
                    }
                  >
                    {s.status === "DRAFT"
                      ? t("learn.editApprove")
                      : t("learn.updateSummary")}
                  </Button>
                )}
              </Card>
            ))}
            {data.notes.map((n) => (
              <Card key={n.id}>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Kicker>
                    {n.audience === "BOTH"
                      ? t("learn.audienceBoth")
                      : t("common.student")}
                  </Kicker>
                  <Text style={styles.caption}>{dayLabel(n.created_at)}</Text>
                </View>
                <Text style={styles.text}>{n.body}</Text>
              </Card>
            ))}
            {!data.notes.length && !data.summaries.length && (
              <EmptyState
                icon="reader-outline"
                title={t("learn.noNotes")}
                description={t("learn.noNotesHint")}
              />
            )}
          </>
        )}
        {tab === "payments" && "packages" in data && (
          <>
            <InkPanel>
              <InkFigures
                items={[
                  {
                    label: t("students.openBalance"),
                    value: money(
                      data.packages.reduce(
                        (n, p) => n + Number(p.price_minor),
                        0,
                      ) -
                        data.payments
                          .filter((p) => !p.voided_at)
                          .reduce((n, p) => n + Number(p.amount_minor), 0),
                    ),
                  },
                  {
                    label: t("mt.remainingLessons"),
                    value: data.packages.reduce((n, p) => n + p.remaining, 0),
                  },
                ]}
              />
              <Text
                style={[
                  styles.muted,
                  { color: colors.onFeatureMuted, marginTop: -4 },
                ]}
              >
                {t("ml.balanceBasis")}
              </Text>
            </InkPanel>
            {!!data.packages.length && (
              <SectionHeading title={t("mt.packages")} />
            )}
            {data.packages.map((p) => (
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
              </Card>
            ))}
            {!!data.payments.length && (
              <SectionHeading title={t("nav.payments")} />
            )}
            {!!data.payments.length && (
              <List>
                {data.payments.map((p, i) => (
                  <ListRow key={p.id} divider={i > 0}>
                    <View style={{ flex: 1, gap: 2 }}>
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
                      <Text style={styles.caption}>
                        {dayLabel(p.received_on + "T12:00:00+03:00")}
                      </Text>
                    </View>
                    <Badge
                      tone={p.voided_at ? "neutral" : "success"}
                      icon={p.voided_at ? undefined : "checkmark"}
                    >
                      {p.voided_at ? t("mt.voided") : t("learn.paid")}
                    </Badge>
                  </ListRow>
                ))}
              </List>
            )}
          </>
        )}
        {tab === "access" && owner && (
          <>
            <Text style={styles.muted}>{t("learn.accessText")}</Text>
            <Button
              icon="person-add-outline"
              onPress={() =>
                setForm({
                  title: t("learn.createInvite"),
                  fields: [
                    {
                      key: "email",
                      label: t("mt.email"),
                      keyboard: "email-address",
                    },
                    {
                      key: "role",
                      label: t("learn.accountType"),
                      value: "STUDENT",
                      options: [
                        { value: "STUDENT", label: t("roles.STUDENT") },
                        { value: "GUARDIAN", label: t("roles.GUARDIAN") },
                      ],
                    },
                    {
                      key: "payments",
                      label: t("learn.paymentInfo"),
                      value: "no",
                      options: [
                        { value: "no", label: t("learn.paymentHidden") },
                        { value: "yes", label: t("learn.paymentVisible") },
                      ],
                    },
                  ],
                  submit: async (v) => {
                    const r = await request(
                      `/workspaces/${access.id}/students/${studentId}/invitations`,
                      {
                        email: v.email,
                        role: v.role,
                        permissions: [
                          "lessons",
                          "assignments",
                          "videos",
                          "notes",
                          ...(v.payments === "yes" ? ["payments"] : []),
                        ],
                      },
                    );
                    await loadLinks();
                    setInvite({
                      url: r.data.url,
                      email: v.email,
                      emailed: Boolean(r.data.emailed),
                    });
                    await Share.share({
                      message: t("ml.shareInvite", { url: r.data.url }),
                    });
                  },
                })
              }
            >
              {t("learn.inviteTitle")}
            </Button>
            {invite && (
              <Card tone="brand">
                <View style={[styles.row, { gap: 6 }]}>
                  <Ionicons
                    name={invite.emailed ? "mail-outline" : "link-outline"}
                    size={16}
                    color={colors.brand}
                  />
                  <Text style={styles.label}>
                    {invite.emailed ? t("ml.inviteSent") : t("ml.inviteReady")}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  {invite.emailed
                    ? t("ml.inviteEmailed", { email: invite.email })
                    : t("ml.inviteNoEmail")}
                </Text>
                <Text style={styles.caption} numberOfLines={2}>
                  {invite.url}
                </Text>
                <View style={styles.row}>
                  <Button
                    secondary
                    size="sm"
                    icon={copied ? "checkmark" : "copy-outline"}
                    onPress={async () => {
                      await setStringAsync(invite.url);
                      setCopied(true);
                    }}
                  >
                    {copied ? t("ml.copied") : t("learn.copy")}
                  </Button>
                  <Button
                    secondary
                    size="sm"
                    icon="share-outline"
                    onPress={() =>
                      void Share.share({
                        message: t("ml.shareInvite", { url: invite.url }),
                      })
                    }
                  >
                    {t("ml.send")}
                  </Button>
                </View>
              </Card>
            )}
            {!!links && !links.data?.length && !links.invitations?.length && (
              <EmptyState
                icon="person-add-outline"
                title={t("learn.noInvites")}
                description={t("learn.noInvitesHint")}
              />
            )}
            {!!(links?.data?.length || links?.invitations?.length) && (
              <List>
                {links?.data?.map((l: any, i: number) => (
                  <ListRow key={l.id} divider={i > 0}>
                    <FileIcon
                      icon={
                        l.role === "STUDENT"
                          ? "school-outline"
                          : "people-outline"
                      }
                    />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.label}>
                        {l.role === "STUDENT"
                          ? t("learn.studentAccess")
                          : t("learn.guardianAccess")}
                      </Text>
                      <Badge tone={l.revokedAt ? "neutral" : "success"} dot>
                        {l.revokedAt ? t("learn.removed") : t("ml.active")}
                      </Badge>
                    </View>
                    {!l.revokedAt && (
                      <Button
                        variant="danger"
                        size="sm"
                        onPress={() =>
                          confirmAction(
                            t("learn.revokeAccess"),
                            t("ml.revokeBody"),
                            async () => {
                              await request(
                                `/workspaces/${access.id}/students/${studentId}/access/revoke`,
                                { id: l.id, kind: "link" },
                              );
                              await loadLinks();
                            },
                            setError,
                          )
                        }
                      >
                        {t("learn.remove")}
                      </Button>
                    )}
                  </ListRow>
                ))}
                {links?.invitations?.map((inv: any, i: number) => {
                  const expired = new Date(inv.expiresAt) < new Date();
                  const [tone, state]: [BadgeTone, string] = inv.acceptedAt
                    ? ["success", t("learn.accepted")]
                    : inv.revokedAt
                      ? ["neutral", t("lesson.cancelled")]
                      : expired
                        ? ["neutral", t("learn.expired")]
                        : ["warning", t("learn.invitePending")];
                  return (
                    <ListRow
                      key={inv.id}
                      divider={i > 0 || !!links?.data?.length}
                    >
                      <FileIcon icon="mail-outline" />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.label} numberOfLines={1}>
                          {inv.email}
                        </Text>
                        <Badge tone={tone} dot>
                          {state}
                        </Badge>
                      </View>
                      {!inv.acceptedAt && !inv.revokedAt && (
                        <Button
                          secondary
                          size="sm"
                          onPress={async () => {
                            try {
                              await request(
                                `/workspaces/${access.id}/students/${studentId}/access/revoke`,
                                { id: inv.id, kind: "invitation" },
                              );
                              await loadLinks();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          {t("mt.cancelLesson")}
                        </Button>
                      )}
                    </ListRow>
                  );
                })}
              </List>
            )}
          </>
        )}
        {tab === "inbox" && (
          <Inbox
            workspaceId={owner ? access.id : undefined}
            onOpen={onNotice}
          />
        )}
      </ScrollView>
      {preview?.kind === "pdf" && (
        <PdfViewer
          name={preview.name}
          url={preview.url}
          onClose={() => setPreview(null)}
        />
      )}
      <Modal
        visible={preview?.kind === "image"}
        animationType="fade"
        transparent
        onRequestClose={() => setPreview(null)}
      >
        <View style={{ flex: 1, backgroundColor: colors.scrim }}>
          <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                numberOfLines={1}
                style={[styles.label, { flex: 1, color: colors.onNavyStrong }]}
              >
                {preview?.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                onPress={() => setPreview(null)}
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed
                    ? "rgba(255,255,255,0.18)"
                    : "rgba(255,255,255,0.1)",
                })}
              >
                <Ionicons name="close" size={22} color={colors.onNavyStrong} />
              </Pressable>
            </View>
            {preview && (
              <Image
                source={{ uri: preview.url }}
                resizeMode="contain"
                accessibilityLabel={preview.name}
                style={{ flex: 1, width: "100%" }}
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>
      <FormSheet form={form} onClose={() => setForm(null)} />
      {video && (
        <MediaPlayer
          key={video.id}
          video={video}
          path={media}
          initialTime={
            data.progress.find((p) => p.video_id === video.id)?.seconds || 0
          }
          canAsk={student}
          onClose={() => setVideo(null)}
          action={action}
        />
      )}
    </SafeAreaView>
  );
}

/** Dosya, erişim ve davet satırlarının başındaki simge karosu. */
function FileIcon({ icon }: { icon: IconName }) {
  const { colors, section } = useTheme();
  return (
    <View style={section.fileIcon}>
      <Ionicons name={icon} size={19} color={colors.brand} />
    </View>
  );
}

/** Bildirim simgesi türden seçilir (web ile aynı eşleme); türü olmayan eski
 *  kayıtlarda sunucunun Türkçe başlığına bakılır. */
function noticeIcon(n: Notice): IconName {
  if (n.kind === "QUESTION" || n.kind === "ANSWER") return "chatbubble-outline";
  if (n.kind === "VIDEO") return "videocam-outline";
  if (n.kind === "SUMMARY") return "sparkles-outline";
  if (n.kind) return "clipboard-outline";
  const title = n.title.toLocaleLowerCase("tr");
  if (title.includes("soru")) return "chatbubble-outline";
  if (title.includes("video")) return "videocam-outline";
  if (title.includes("özet")) return "sparkles-outline";
  if (title.includes("ödev")) return "clipboard-outline";
  return "notifications-outline";
}

function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return t("time.daysAgo", { count: days });
  return dayLabel(iso);
}

/** Bildirimler ve (öğretmende) plan kullanımı: web'deki bildirim penceresinin
 *  mobil karşılığı. */
export function Inbox({
  workspaceId,
  onUnread,
  onOpen,
}: {
  workspaceId?: string;
  onUnread?: (count: number) => void;
  /** Bildirime dokununca ilgili ekranı açar. */
  onOpen?: (target: NoticeTarget) => void;
}) {
  const { colors, styles, section } = useTheme();
  const [rows, setRows] = useState<Notice[] | null>(null),
    [limits, setLimits] = useState<any>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const [inbox, usage] = await Promise.all([
          request<{ data: Notice[] }>("/inbox"),
          workspaceId
            ? request(`/workspaces/${workspaceId}/settings/limits`)
            : Promise.resolve(null),
        ]);
        setRows(inbox.data);
        setNow(Date.now());
        if (usage) setLimits(usage.data);
      } catch (e) {
        setError((e as Error).message);
        setRows((old) => old ?? []);
      }
    })();
  }, [workspaceId]);
  const unread = (rows || []).filter((n) => !n.readAt);
  const unreadCount = rows ? unread.length : null;
  useEffect(() => {
    if (unreadCount !== null) onUnread?.(unreadCount);
  }, [unreadCount, onUnread]);
  async function markRead(ids: string[]) {
    try {
      await Promise.all(ids.map((id) => request(`/inbox/${id}/read`, {})));
      const at = new Date().toISOString();
      setRows((old) =>
        (old || []).map((n) => (ids.includes(n.id) ? { ...n, readAt: at } : n)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <ErrorText message={error} />
      {rows && (
        <SectionHeading
          title={t("ml.recentNotices")}
          description={
            unread.length
              ? t("ml.unreadCount", { count: unread.length })
              : t("ml.allRead")
          }
          action={
            unread.length ? (
              <Button
                variant="ghost"
                size="sm"
                icon="checkmark-done"
                onPress={() => void markRead(unread.map((n) => n.id))}
              >
                {t("inbox.markAll")}
              </Button>
            ) : undefined
          }
        />
      )}
      {rows && !rows.length && (
        <EmptyState
          icon="notifications-off-outline"
          title={t("inbox.empty")}
          description={t("inbox.emptyHint")}
        />
      )}
      {!!rows?.length && (
        <List>
          {rows.map((n, i) => {
            const target = onOpen ? noticeTarget(n) : null;
            return (
              <Pressable
                key={n.id}
                disabled={!target}
                accessibilityRole={target ? "button" : undefined}
                accessibilityHint={target ? t("ml.openRelated") : undefined}
                onPress={() => {
                  if (!target) return;
                  if (!n.readAt) void markRead([n.id]);
                  onOpen?.(target);
                }}
                style={({ pressed }) => [
                  section.notice,
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.line },
                  !n.readAt && { backgroundColor: colors.infoSoft },
                  pressed && { backgroundColor: colors.sunken },
                ]}
              >
                <View
                  style={[
                    section.noticeIcon,
                    n.readAt
                      ? { backgroundColor: colors.sunken }
                      : { backgroundColor: colors.brandSoft },
                  ]}
                >
                  <Ionicons
                    name={noticeIcon(n)}
                    size={16}
                    color={n.readAt ? colors.muted : colors.brand}
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View
                    style={[
                      styles.row,
                      { flexWrap: "nowrap", alignItems: "flex-start" },
                    ]}
                  >
                    <Text
                      style={[
                        n.readAt ? styles.text : styles.label,
                        { flex: 1, fontSize: 14.5 },
                      ]}
                    >
                      {noticeText(n.title)}
                    </Text>
                    {!n.readAt && (
                      <View
                        accessibilityLabel={t("inbox.unread")}
                        style={section.unreadDot}
                      />
                    )}
                  </View>
                  <Text style={styles.muted}>{noticeText(n.body)}</Text>
                  <View style={[styles.row, { gap: 14, marginTop: 4 }]}>
                    <Text style={styles.caption}>{ago(n.createdAt, now)}</Text>
                    {!n.readAt && (
                      <TextLink onPress={() => void markRead([n.id])}>
                        {t("inbox.markRead")}
                      </TextLink>
                    )}
                  </View>
                </View>
                {target && (
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.faint}
                    style={{ alignSelf: "center" }}
                  />
                )}
              </Pressable>
            );
          })}
        </List>
      )}
      {limits && (
        <>
          <SectionHeading
            title={t("inbox.tabUsage")}
            description={t("inbox.usageText")}
            action={
              <Badge tone="info">
                {limits.limits.plan === "PRO"
                  ? t("inbox.planPro")
                  : t("inbox.planPilot")}
              </Badge>
            }
          />
          <Card style={{ gap: 18 }}>
            <Meter
              label={t("overview.figureActive")}
              used={Number(limits.used.students)}
              limit={Number(limits.limits.studentLimit)}
            />
            <Meter
              label={t("inbox.video")}
              used={Math.ceil(Number(limits.used.videoSeconds) / 60)}
              limit={Math.floor(Number(limits.limits.videoSeconds) / 60)}
              unit={t("inbox.minutesUnit")}
            />
            <Meter
              label={t("inbox.storage")}
              used={Math.round(Number(limits.used.materialBytes) / 1024 ** 2)}
              limit={Math.floor(
                Number(limits.limits.materialBytes) / 1024 ** 2,
              )}
              unit="MB"
            />
          </Card>
        </>
      )}
    </>
  );
}
