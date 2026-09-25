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
  timeLabel,
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
export function PortalScreen({
  access,
  onAccount,
}: {
  access: Access;
  onAccount: () => void;
}) {
  return (
    <LearningScreen
      access={access}
      studentId={access.studentId!}
      studentName={access.studentName!}
      onBack={onAccount}
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
    reader.onerror = () => reject(new Error("Dosya okunamadı."));
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
}: {
  access: Access;
  studentId: string;
  studentName: string;
  onBack: () => void;
  /** Tek bir bölümü gömülü göstermek için (Öğretim sekmesi). Verilince
   *  ekranın kendi başlığı ve sekme şeridi çizilmez. */
  view?: TeachingView;
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
    if (inFlight.current) throw new Error("Önceki işlem tamamlanıyor.");
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
    { id: "lessons", label: "Dersler", permission: "lessons" },
    { id: "assignments", label: "Ödevler", permission: "assignments" },
    { id: "files", label: "PDF ve dosyalar", permission: "assignments" },
    { id: "videos", label: "Videolar", permission: "videos" },
    { id: "notes", label: "Paylaşımlar", permission: "notes" },
    ...(owner
      ? [{ id: "access", label: "Davetler", permission: "lessons" }]
      : [{ id: "payments", label: "Bakiye", permission: "payments" }]),
    { id: "inbox", label: "Bildirimler", permission: "lessons" },
  ].filter((t) => permissions.includes(t.permission));
  useEffect(() => {
    if (view) return;
    if (tabs.length && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
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
      setError("Dosya yükleme şu anda kullanılamıyor.");
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
        throw new Error("Dosya en fazla 10 MB olabilir.");
      const bytes = await readFileBytes(asset.uri);
      if (bytes.byteLength > 10 * 1024 ** 2)
        throw new Error("Dosya en fazla 10 MB olabilir.");
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
            throw new Error("Dosya yüklenemedi. Yeniden deneyin.");
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
      setError("Video yükleme şu anda kullanılamıyor.");
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
        throw new Error("Video en fazla 2 GB olabilir.");
      setForm({
        title: "Ders videosu yükle",
        description: `${asset.name} · En fazla 2 saat.`,
        fields: [
          {
            key: "title",
            label: "Video başlığı",
            value: asset.name.replace(/\.[^.]+$/, ""),
          },
          {
            key: "lessonId",
            label: "Ders",
            options: [
              { value: "", label: "Genel ders videosu" },
              ...data.lessons.map((l) => ({
                value: l.id,
                label: `${l.topic} · ${dateKey(l.starts_at)}`,
              })),
            ],
            required: false,
          },
          {
            key: "duration",
            label: "En fazla süre (dakika)",
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
      "Dosyayı sil",
      "Bu dosya öğrenci için de kaldırılacak.",
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
      ? ["neutral", "İptal edildi"]
      : a.status === "COMPLETED"
        ? ["success", "Tamamlandı"]
        : sub
          ? sub.status === "REVIEWED"
            ? ["success", "Değerlendirildi"]
            : ["info", "Teslim edildi"]
          : a.due_on && a.due_on < dateKey()
            ? ["danger", "Gecikti"]
            : ["warning", "Teslim bekleniyor"];
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
              Öğrenci dosyası
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
              Hesabım
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
                  ? "Öğrenme alanı"
                  : student
                    ? "Öğrenci çalışma alanı"
                    : "Veli takip alanı"}
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
            Yenile
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
                    ? "Video yükleme hazır değil"
                    : "Dosya yükleme hazır değil"}
                </Text>
              </View>
              <Text style={styles.muted}>
                Yükleme hizmetine şu anda erişilemiyor. Hizmet
                etkinleştirildiğinde tekrar kontrol edin.
              </Text>
              <Button
                secondary
                size="sm"
                icon="refresh-outline"
                style={{ alignSelf: "flex-start" }}
                onPress={() => void reload()}
              >
                Tekrar kontrol et
              </Button>
            </Card>
          )}
        {tab === "lessons" && (
          <>
            {!data.lessons.length && (
              <EmptyState
                icon="calendar-outline"
                title="Henüz ders yok"
                description="Planlanan dersleriniz burada görünecek."
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
                        {l.location || "Konum belirtilmedi"}
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
                    "Yeni ödev",
                    [
                      { key: "title", label: "Başlık" },
                      {
                        key: "instructions",
                        label: "Yönerge",
                        multiline: true,
                        required: false,
                      },
                      {
                        key: "dueOn",
                        label: "Son teslim (YYYY-AA-GG)",
                        required: false,
                        value: dateKey(),
                      },
                    ],
                    (v) => ({ action: "assignment.create", ...v }),
                  )
                }
              >
                Ödev ver
              </Button>
            )}
            {!data.assignments.length && (
              <EmptyState
                icon="clipboard-outline"
                title="Henüz ödev yok"
                description="Verilen ödevler, teslimler ve geri bildirimler burada görünecek."
              />
            )}
            {data.assignments.map((a) => {
              const sub = data.submissions.find(
                (s) => s.assignment_id === a.id,
              );
              const [tone, state] = assignmentState(a, sub);
              const editable = canEditSubmission(a, !!sub);
              return (
                <Card key={a.id}>
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
                        ? "Son teslim " + dayLabel(a.due_on + "T12:00:00+03:00")
                        : "Son teslim tarihi yok"}
                    </Text>
                  </View>
                  {student && sub && a.status === "OPEN" && (
                    <Text style={[styles.caption, { marginTop: -4 }]}>
                      {editable
                        ? a.due_on
                          ? "Teslimi bu günün sonuna kadar düzenleyebilirsiniz."
                          : "Teslimi istediğiniz zaman düzenleyebilirsiniz."
                        : "Son teslim tarihi geçti, teslim kilitlendi."}
                    </Text>
                  )}
                  {!!a.instructions && (
                    <Text style={styles.text}>{a.instructions}</Text>
                  )}
                  {sub && (
                    <View style={section.quote}>
                      <Text style={styles.label}>Öğrenci teslimi</Text>
                      <Text style={styles.text}>{sub.body}</Text>
                      {!!sub.feedback && (
                        <>
                          <Text style={[styles.label, { marginTop: 6 }]}>
                            Öğretmen geri bildirimi
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
                        {m.status !== "READY" ? " (yükleniyor)" : ""}
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
                            "Ödevi düzenle",
                            [
                              { key: "title", label: "Başlık", value: a.title },
                              {
                                key: "instructions",
                                label: "Yönerge",
                                value: a.instructions,
                                multiline: true,
                                required: false,
                              },
                              {
                                key: "dueOn",
                                label: "Son teslim (YYYY-AA-GG)",
                                value: a.due_on || "",
                                required: false,
                              },
                              {
                                key: "status",
                                label: "Durum",
                                value: a.status,
                                options: [
                                  { value: "OPEN", label: "Devam ediyor" },
                                  { value: "COMPLETED", label: "Tamamlandı" },
                                  { value: "CANCELLED", label: "İptal edildi" },
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
                        Düzenle
                      </Button>
                    )}
                    {student && editable && (
                      <Button
                        size="sm"
                        icon="paper-plane-outline"
                        style={{ flexGrow: 1 }}
                        onPress={() =>
                          formAction(
                            sub ? "Teslimi düzenle" : "Ödevi teslim et",
                            [
                              {
                                key: "body",
                                label: "Çözümünüz / açıklamanız",
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
                        {sub ? "Teslimi düzenle" : "Teslim et"}
                      </Button>
                    )}
                    {owner && sub && (
                      <Button
                        size="sm"
                        icon="chatbubble-ellipses-outline"
                        style={{ flexGrow: 1 }}
                        onPress={() =>
                          formAction(
                            "Ödevi değerlendir",
                            [
                              {
                                key: "feedback",
                                label: "Geri bildirim",
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
                        Geri bildirim yaz
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
                        {busy ? "Yükleniyor…" : "Dosya ekle"}
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
                {busy ? "Yükleniyor…" : "PDF / materyal yükle"}
              </Button>
            )}
            <Text style={styles.caption}>
              PDF, JPG, PNG veya WebP · en fazla 10 MB. Ödev ekleri de burada
              görünür.
            </Text>
            {!data.materials.length && (
              <EmptyState
                icon="document-text-outline"
                title="Henüz dosya yok"
                description="Eklenen PDF ve materyaller burada görünecek."
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
                              ? "Silme bekliyor"
                              : "Yükleme tamamlanmadı"
                            : file.assignment_id
                              ? data.assignments.find(
                                  (a) => a.id === file.assignment_id,
                                )?.title
                              : "Genel ders materyali"}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {ready && (
                          <IconButton
                            icon="eye-outline"
                            label="Önizle"
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
                            label="Dosyayı indir"
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
                                ? "Silmeyi yeniden dene"
                                : "Dosyayı sil"
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
                Ders videosu yükle
              </Button>
            )}
            {progress !== null && (
              <Card>
                <Meter
                  label="Video yükleniyor"
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
                Yüklemeye devam et
              </Button>
            )}
            {!data.videos.length && (
              <EmptyState
                icon="videocam-outline"
                title="Henüz video yok"
                description="Hazır olduğunda ders videoları burada görünecek."
              />
            )}
            {data.videos.map((v) => {
              const ready = v.status === "READY" && !v.delete_requested;
              return (
                <Card key={v.id}>
                  <View style={[styles.row, { flexWrap: "nowrap", gap: 12 }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${v.title} videosunu izle`}
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
                          ? "Silme bekliyor"
                          : v.status === "READY"
                            ? `${Math.ceil((v.duration_seconds || 0) / 60)} dakika`
                            : v.status === "FAILED"
                              ? "Yüklenemedi"
                              : "Hazırlanıyor"}
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
                        Videoyu izle
                      </Button>
                    )}
                    {owner && (
                      <>
                        <IconButton
                          icon="refresh-outline"
                          label="Durumu yenile"
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
                          label="Videoyu sil"
                          disabled={busy}
                          onPress={() =>
                            confirmAction(
                              "Videoyu sil",
                              "Öğrenci bu videoyu artık izleyemeyecek.",
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
                            {String(q.at_seconds % 60).padStart(2, "0")} · Soru
                          </Text>
                          {q.resolved && (
                            <Badge tone="success" icon="checkmark">
                              Yanıtlandı
                            </Badge>
                          )}
                        </View>
                        <Text style={styles.text}>{q.body}</Text>
                        {!!q.answer && (
                          <Text style={styles.muted}>Yanıt: {q.answer}</Text>
                        )}
                        {owner && (
                          <View style={{ alignSelf: "flex-start" }}>
                            <TextLink
                              icon="arrow-undo-outline"
                              onPress={() =>
                                formAction(
                                  "Soruyu yanıtla",
                                  [
                                    {
                                      key: "answer",
                                      label: "Yanıt",
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
                              Yanıtla
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
                      "Not paylaş",
                      [
                        { key: "body", label: "Not", multiline: true },
                        {
                          key: "audience",
                          label: "Kim görebilsin?",
                          value: "BOTH",
                          options: [
                            { value: "BOTH", label: "Öğrenci ve veli" },
                            { value: "STUDENT", label: "Yalnız öğrenci" },
                          ],
                        },
                      ],
                      (v) => ({ action: "note.publish", ...v }),
                    )
                  }
                >
                  Not paylaş
                </Button>
                <Button
                  secondary
                  icon="sparkles-outline"
                  style={{ flexGrow: 1 }}
                  onPress={() =>
                    formAction(
                      "Haftalık özet hazırla",
                      [
                        {
                          key: "weekOn",
                          label: "Hafta başlangıcı (YYYY-AA-GG)",
                          value: dateKey(),
                        },
                      ],
                      (v) => ({ action: "summary.draft", ...v }),
                    )
                  }
                >
                  Özet taslağı
                </Button>
              </View>
            )}
            {data.summaries.map((s) => (
              <Card key={s.id}>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Kicker>Haftalık özet</Kicker>
                  <Badge
                    tone={s.status === "DRAFT" ? "warning" : "success"}
                    dot
                  >
                    {s.status === "DRAFT" ? "Taslak" : "Paylaşıldı"}
                  </Badge>
                </View>
                <Text style={styles.h2}>{s.week_on} haftası</Text>
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
                        "Özeti incele ve paylaş",
                        [
                          {
                            key: "body",
                            label: "Özet",
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
                      ? "Düzenle ve onayla"
                      : "Özeti güncelle"}
                  </Button>
                )}
              </Card>
            ))}
            {data.notes.map((n) => (
              <Card key={n.id}>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Kicker>
                    {n.audience === "BOTH" ? "Öğrenci ve veli" : "Öğrenci"}
                  </Kicker>
                  <Text style={styles.caption}>{dayLabel(n.created_at)}</Text>
                </View>
                <Text style={styles.text}>{n.body}</Text>
              </Card>
            ))}
            {!data.notes.length && !data.summaries.length && (
              <EmptyState
                icon="reader-outline"
                title="Henüz paylaşım yok"
                description="Paylaşılan notlar ve haftalık özetler burada görünecek."
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
                    label: "Açık bakiye",
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
                    label: "Kalan ders",
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
                Öğretmenin kaydettiği paketler ve tahsilatlar.
              </Text>
            </InkPanel>
            {!!data.packages.length && (
              <SectionHeading title="Ders paketleri" />
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
                    {p.remaining} hak
                  </Badge>
                </View>
                <Text style={styles.muted}>
                  {p.remaining} / {p.granted} hak · {money(p.price_minor)}
                </Text>
              </Card>
            ))}
            {!!data.payments.length && <SectionHeading title="Tahsilatlar" />}
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
                      {p.voided_at ? "İptal edildi" : "Tahsil edildi"}
                    </Badge>
                  </ListRow>
                ))}
              </List>
            )}
          </>
        )}
        {tab === "access" && owner && (
          <>
            <Text style={styles.muted}>
              Davet bağlantısını yalnızca belirtilen, doğrulanmış e-posta hesabı
              kabul edebilir.
            </Text>
            <Button
              icon="person-add-outline"
              onPress={() =>
                setForm({
                  title: "Davet oluştur",
                  fields: [
                    {
                      key: "email",
                      label: "E-posta",
                      keyboard: "email-address",
                    },
                    {
                      key: "role",
                      label: "Hesap türü",
                      value: "STUDENT",
                      options: [
                        { value: "STUDENT", label: "Öğrenci" },
                        { value: "GUARDIAN", label: "Veli" },
                      ],
                    },
                    {
                      key: "payments",
                      label: "Paket / ödeme bilgisi",
                      value: "no",
                      options: [
                        { value: "no", label: "Gizli kalsın" },
                        { value: "yes", label: "Görüntüleyebilsin" },
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
                      message: `Derslik davetiniz (7 gün geçerli): ${r.data.url}`,
                    });
                  },
                })
              }
            >
              Davet bağlantısı oluştur
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
                    {invite.emailed
                      ? "Davet gönderildi"
                      : "Davet bağlantısı hazır"}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  {invite.emailed
                    ? `Davet ${invite.email} adresine e-posta ile gönderildi. Ulaşmadıysa bağlantıyı kendiniz iletebilirsiniz.`
                    : "E-posta gönderimi kapalı; bağlantıyı kopyalayıp iletin."}
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
                    {copied ? "Kopyalandı" : "Kopyala"}
                  </Button>
                  <Button
                    secondary
                    size="sm"
                    icon="share-outline"
                    onPress={() =>
                      void Share.share({
                        message: `Derslik davetiniz (7 gün geçerli): ${invite.url}`,
                      })
                    }
                  >
                    Gönder
                  </Button>
                </View>
              </Card>
            )}
            {!!links && !links.data?.length && !links.invitations?.length && (
              <EmptyState
                icon="person-add-outline"
                title="Henüz davet yok"
                description="Öğrenci veya veliyi davet ettiğinizde burada görünür."
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
                          ? "Öğrenci erişimi"
                          : "Veli erişimi"}
                      </Text>
                      <Badge tone={l.revokedAt ? "neutral" : "success"} dot>
                        {l.revokedAt ? "Kaldırıldı" : "Etkin"}
                      </Badge>
                    </View>
                    {!l.revokedAt && (
                      <Button
                        variant="danger"
                        size="sm"
                        onPress={() =>
                          confirmAction(
                            "Erişimi kaldır",
                            "Bu hesap öğrenci bilgilerini artık göremeyecek.",
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
                        Kaldır
                      </Button>
                    )}
                  </ListRow>
                ))}
                {links?.invitations?.map((inv: any, i: number) => {
                  const expired = new Date(inv.expiresAt) < new Date();
                  const [tone, state]: [BadgeTone, string] = inv.acceptedAt
                    ? ["success", "Kabul edildi"]
                    : inv.revokedAt
                      ? ["neutral", "İptal edildi"]
                      : expired
                        ? ["neutral", "Süresi doldu"]
                        : ["warning", "Davet bekliyor"];
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
                          İptal et
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
          <Inbox workspaceId={owner ? access.id : undefined} />
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
                accessibilityLabel="Kapat"
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

type Notice = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

/** Bildirim başlıkları sunucuda sabit metinler; simge başlıktan seçiliyor
 *  (web ile aynı eşleme). */
function noticeIcon(title: string): IconName {
  const t = title.toLocaleLowerCase("tr");
  if (t.includes("soru")) return "chatbubble-outline";
  if (t.includes("video")) return "videocam-outline";
  if (t.includes("özet")) return "sparkles-outline";
  if (t.includes("ödev")) return "clipboard-outline";
  return "notifications-outline";
}

function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "Az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Dün";
  if (days < 7) return `${days} gün önce`;
  return dayLabel(iso);
}

/** Bildirimler ve (öğretmende) plan kullanımı: web'deki bildirim penceresinin
 *  mobil karşılığı. */
export function Inbox({
  workspaceId,
  onUnread,
}: {
  workspaceId?: string;
  onUnread?: (count: number) => void;
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
          title="Son bildirimler"
          description={
            unread.length ? `${unread.length} okunmamış` : "Hepsi okundu"
          }
          action={
            unread.length ? (
              <Button
                variant="ghost"
                size="sm"
                icon="checkmark-done"
                onPress={() => void markRead(unread.map((n) => n.id))}
              >
                Tümü okundu
              </Button>
            ) : undefined
          }
        />
      )}
      {rows && !rows.length && (
        <EmptyState
          icon="notifications-off-outline"
          title="Yeni bildirim yok"
          description="Teslimler, yeni videolar ve geri bildirimler burada görünecek."
        />
      )}
      {!!rows?.length && (
        <List>
          {rows.map((n, i) => (
            <View
              key={n.id}
              style={[
                section.notice,
                i > 0 && { borderTopWidth: 1, borderTopColor: colors.line },
                !n.readAt && { backgroundColor: colors.infoSoft },
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
                  name={noticeIcon(n.title)}
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
                    {n.title}
                  </Text>
                  {!n.readAt && (
                    <View
                      accessibilityLabel="Okunmadı"
                      style={section.unreadDot}
                    />
                  )}
                </View>
                <Text style={styles.muted}>{n.body}</Text>
                <View style={[styles.row, { gap: 14, marginTop: 4 }]}>
                  <Text style={styles.caption}>{ago(n.createdAt, now)}</Text>
                  {!n.readAt && (
                    <TextLink onPress={() => void markRead([n.id])}>
                      Okundu say
                    </TextLink>
                  )}
                </View>
              </View>
            </View>
          ))}
        </List>
      )}
      {limits && (
        <>
          <SectionHeading
            title="Kullanım ve plan"
            description="Plan sınırlarına göre kullanımınız."
            action={
              <Badge tone="info">
                {limits.limits.plan === "PRO" ? "Pro plan" : "Pilot plan"}
              </Badge>
            }
          />
          <Card style={{ gap: 18 }}>
            <Meter
              label="Aktif öğrenci"
              used={Number(limits.used.students)}
              limit={Number(limits.limits.studentLimit)}
            />
            <Meter
              label="Video"
              used={Math.ceil(Number(limits.used.videoSeconds) / 60)}
              limit={Math.floor(Number(limits.limits.videoSeconds) / 60)}
              unit="dk"
            />
            <Meter
              label="Dosya alanı"
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
