import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
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
import { dateKey, dayLabel, money } from "@derslik/contracts";
import { request } from "./core";
import {
  Badge,
  Button,
  Card,
  confirmAction,
  ErrorText,
  FormSheet,
  type FormSpec,
  type Palette,
  IconButton,
  Loading,
  radius,
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
  const { colors, styles } = useTheme();
  const pill = useMemo(() => makePill(colors), [colors]);
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
      const fingerprint = [assignmentId, asset.name, bytes.byteLength].join(":"),
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
  return (
    <SafeAreaView
      style={styles.screen}
      edges={view ? ["left", "right"] : ["top", "left", "right"]}
    >
      {!view && (
      <View style={styles.header}>
        {owner ? (
          <Button secondary size="sm" icon="chevron-back" onPress={onBack}>
            Geri
          </Button>
        ) : (
          <Text style={styles.brand}>
            derslik<Text style={{ color: colors.green }}>.</Text>
          </Text>
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingVertical: 12,
          gap: 8,
        }}
      >
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setTab(t.id);
                if (t.id === "access") void loadLinks();
              }}
              style={({ pressed }) => [
                pill.chip,
                on && pill.chipOn,
                pressed && !on && { backgroundColor: colors.subtle },
              ]}
            >
              <Text style={[pill.chipText, on && pill.chipTextOn]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
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
        <View style={{ gap: 4 }}>
          <Text style={styles.kicker}>
            {owner
              ? "Öğrenci dosyası"
              : student
                ? "Öğrenci çalışma alanı"
                : "Veli takip alanı"}
          </Text>
          <Text style={styles.title}>{studentName}</Text>
        </View>
        )}
        <ErrorText message={error} />
        {error && (
          <Button secondary onPress={() => void reload()}>
            Yenile
          </Button>
        )}
        {(owner || student) &&
          ((tab === "videos" && !capabilities?.videos) ||
            (["assignments", "files"].includes(tab) &&
              !capabilities?.files)) && (
            <Card tone="muted">
              <Text style={styles.h2}>
                {tab === "videos"
                  ? "Video yükleme hazır değil"
                  : "Dosya yükleme hazır değil"}
              </Text>
              <Text style={styles.muted}>
                Yükleme hizmetine şu anda erişilemiyor. Hizmet
                etkinleştirildiğinde tekrar kontrol edin.
              </Text>
              <Button secondary onPress={() => void reload()}>
                Tekrar kontrol et
              </Button>
            </Card>
          )}
        {tab === "lessons" && (
          <>
            {!data.lessons.length && (
              <Text style={styles.muted}>Henüz planlanmış ders yok.</Text>
            )}
            {data.lessons.map((l) => (
              <Card key={l.id}>
                <Text style={styles.kicker}>
                  {l.status === "COMPLETED"
                    ? "TAMAMLANDI"
                    : l.status === "CANCELLED"
                      ? "İPTAL"
                      : "PLANLANDI"}
                </Text>
                <Text style={styles.h2}>{l.topic}</Text>
                <Text style={styles.text}>
                  {dayLabel(l.starts_at, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Text style={styles.muted}>
                  {l.location || "Konum belirtilmedi"}
                </Text>
              </Card>
            ))}
          </>
        )}
        {tab === "assignments" && (
          <>
            {owner && (
              <Button
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
                + Ödev ver
              </Button>
            )}
            {!data.assignments.length && (
              <Text style={styles.muted}>Henüz ödev yok.</Text>
            )}
            {data.assignments.map((a) => {
              const sub = data.submissions.find(
                (s) => s.assignment_id === a.id,
              );
              return (
                <Card key={a.id}>
                  <Badge
                    tone={
                      a.status === "CANCELLED"
                        ? "danger"
                        : a.status === "COMPLETED" ||
                            sub?.status === "REVIEWED"
                          ? "success"
                          : sub
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {a.status === "CANCELLED"
                      ? "İptal edildi"
                      : a.status === "COMPLETED"
                        ? "Tamamlandı"
                        : sub
                          ? sub.status === "REVIEWED"
                            ? "Değerlendirildi"
                            : "Teslim edildi"
                          : "Teslim bekleniyor"}
                  </Badge>
                  <Text style={styles.h2}>{a.title}</Text>
                  <Text style={styles.muted}>
                    Son teslim: {a.due_on || "Belirtilmedi"}
                  </Text>
                  <Text style={styles.text}>{a.instructions}</Text>
                  {sub && (
                    <>
                      <View style={styles.divider} />
                      <Text style={styles.label}>Öğrenci teslimi</Text>
                      <Text style={styles.text}>{sub.body}</Text>
                      {!!sub.feedback && (
                        <>
                          <Text style={styles.label}>
                            Öğretmen geri bildirimi
                          </Text>
                          <Text style={styles.text}>{sub.feedback}</Text>
                        </>
                      )}
                    </>
                  )}
                  {data.materials
                    .filter((m) => m.assignment_id === a.id)
                    .map((m) => (
                      <Button
                        key={m.id}
                        secondary
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
                        ↗ {m.name}
                        {m.status !== "READY" ? " (yükleniyor)" : ""}
                      </Button>
                    ))}
                  {owner && (
                    <Button
                      secondary
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
                      Düzenle / durum
                    </Button>
                  )}
                  {student &&
                    a.status === "OPEN" &&
                    sub?.status !== "REVIEWED" && (
                      <Button
                        onPress={() =>
                          formAction(
                            "Ödevi teslim et",
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
                  {(owner || (student && a.status === "OPEN")) && (
                    <Button
                      secondary
                      disabled={busy || !capabilities?.files}
                      onPress={() => void attach(a.id)}
                    >
                      {busy ? "Yükleniyor…" : "Dosya ekle (PDF / fotoğraf)"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </>
        )}
        {tab === "files" && (
          <>
            {owner && (
              <Button
                disabled={busy || !capabilities?.files}
                onPress={() => void attach(null)}
              >
                {busy ? "Yükleniyor…" : "+ PDF / materyal yükle"}
              </Button>
            )}
            <Text style={styles.muted}>
              PDF, JPG, PNG veya WebP · en fazla 10 MB. Ödev ekleri de burada
              görünür.
            </Text>
            {!data.materials.length && (
              <Text style={styles.muted}>Henüz dosya yok.</Text>
            )}
            {data.materials.map((file) => (
              <Card key={file.id}>
                <Text style={styles.h2}>{file.name}</Text>
                <Text style={styles.muted}>
                  {file.assignment_id
                    ? data.assignments.find((a) => a.id === file.assignment_id)
                        ?.title
                    : "Genel ders materyali"}
                </Text>
                {file.status === "READY" && !file.delete_requested ? (
                  <View style={styles.row}>
                    <IconButton
                      icon="eye-outline"
                      label="Önizle"
                      onPress={async () => {
                        try {
                          // inline=1: bağlantı indirme yerine görüntülenmek
                          // üzere imzalanır.
                          const r = await request(
                            media + `/files/${file.id}/download?inline=1`,
                          );
                          // Görsel yerel olarak, PDF pdf.js ile çizilir;
                          // ikisi de uygulamadan çıkmadan açılır.
                          setPreview({
                            name: file.name,
                            url: r.data.url,
                            kind: isImageName(file.name) ? "image" : "pdf",
                          });
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
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
                    {owner && (
                      <IconButton
                        danger
                        icon="trash-outline"
                        label="Dosyayı sil"
                        disabled={busy}
                        onPress={() => removeFile(file)}
                      />
                    )}
                  </View>
                ) : (
                  <View style={styles.row}>
                    <Text style={[styles.caption, { flex: 1 }]}>
                      {file.delete_requested
                        ? "Silme bekliyor"
                        : "Yükleme tamamlanmadı"}
                    </Text>
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
                )}
              </Card>
            ))}
          </>
        )}
        {tab === "videos" && (
          <>
            {owner && (
              <Button
                disabled={busy || !capabilities?.videos}
                onPress={() => void chooseVideo()}
              >
                + Ders videosu yükle
              </Button>
            )}
            {progress !== null && (
              <Text accessibilityRole="alert" style={styles.muted}>
                Yükleme: %{Math.round(progress * 100)}
              </Text>
            )}
            {upload && !busy && (
              <Button secondary onPress={() => void sendVideo(upload)}>
                Yüklemeye devam et
              </Button>
            )}
            {!data.videos.length && (
              <Text style={styles.muted}>Henüz ders videosu yok.</Text>
            )}
            {data.videos.map((v) => (
              <Card key={v.id}>
                <Text style={styles.h2}>{v.title}</Text>
                <Badge
                  tone={
                    v.delete_requested || v.status === "FAILED"
                      ? "danger"
                      : v.status === "READY"
                        ? "success"
                        : "warning"
                  }
                >
                  {v.delete_requested
                    ? "Silme bekliyor"
                    : v.status === "READY"
                      ? `${Math.ceil((v.duration_seconds || 0) / 60)} dakika`
                      : v.status === "FAILED"
                        ? "Yüklenemedi"
                        : "Hazırlanıyor"}
                </Badge>
                <View style={styles.row}>
                  {v.status === "READY" && !v.delete_requested && (
                    <IconButton
                      icon="play-outline"
                      label="Videoyu izle"
                      onPress={() => setVideo(v)}
                    />
                  )}
                  {owner && (
                    <>
                      <IconButton
                        icon="refresh-outline"
                        label="Durumu yenile"
                        disabled={busy}
                        onPress={async () => {
                          try {
                            await request(media + `/videos/${v.id}/refresh`, {});
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
                    <View key={q.id} style={{ gap: 10, paddingTop: 16 }}>
                      <View style={styles.divider} />
                      <Text style={styles.label}>
                        {Math.floor(q.at_seconds / 60)}:
                        {String(q.at_seconds % 60).padStart(2, "0")} · Soru
                      </Text>
                      <Text style={styles.text}>{q.body}</Text>
                      {!!q.answer && (
                        <Text style={styles.text}>
                          Yanıt: {q.answer} {q.resolved ? "✓" : ""}
                        </Text>
                      )}
                      {owner && (
                        <Button
                          secondary
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
                        </Button>
                      )}
                    </View>
                  ))}
              </Card>
            ))}
          </>
        )}
        {tab === "notes" && (
          <>
            {owner && (
              <>
                <Button
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
                  Özet taslağı hazırla
                </Button>
              </>
            )}
            {data.summaries.map((s) => (
              <Card key={s.id}>
                <Text style={styles.kicker}>
                  HAFTALIK ÖZET ·{" "}
                  {s.status === "DRAFT" ? "TASLAK" : "PAYLAŞILDI"}
                </Text>
                <Text style={styles.h2}>{s.week_on} haftası</Text>
                <Text style={styles.text}>{s.body}</Text>
                {owner && (
                  <Button
                    secondary
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
                <Text style={styles.kicker}>
                  {n.audience === "BOTH" ? "ÖĞRENCİ VE VELİ" : "ÖĞRENCİ"}
                </Text>
                <Text style={styles.text}>{n.body}</Text>
                <Text style={styles.muted}>{dayLabel(n.created_at)}</Text>
              </Card>
            ))}
            {!data.notes.length && !data.summaries.length && (
              <Text style={styles.muted}>Henüz paylaşılmış not yok.</Text>
            )}
          </>
        )}
        {tab === "payments" && "packages" in data && (
          <>
            <Card>
              <Text style={styles.muted}>Açık bakiye</Text>
              <Text style={styles.title}>
                {money(
                  data.packages.reduce((n, p) => n + Number(p.price_minor), 0) -
                    data.payments
                      .filter((p) => !p.voided_at)
                      .reduce((n, p) => n + Number(p.amount_minor), 0),
                )}
              </Text>
              <Text style={styles.muted}>
                Öğretmenin kaydettiği paketler ve tahsilatlar.
              </Text>
            </Card>
            {data.packages.map((p) => (
              <Card key={p.id}>
                <Text style={styles.h2}>{p.name}</Text>
                <Text style={styles.text}>
                  {p.remaining} / {p.granted} hak · {money(p.price_minor)}
                </Text>
              </Card>
            ))}
            {data.payments.map((p) => (
              <Card key={p.id}>
                <Text style={styles.h2}>{money(p.amount_minor)}</Text>
                <Text style={styles.muted}>
                  {p.received_on} ·{" "}
                  {p.voided_at ? "İptal edildi" : "Tahsil edildi"}
                </Text>
              </Card>
            ))}
          </>
        )}
        {tab === "access" && owner && (
          <>
            <Text style={styles.muted}>
              Davet bağlantısını yalnızca belirtilen, doğrulanmış e-posta hesabı
              kabul edebilir.
            </Text>
            <Button
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
              <Card>
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
                    icon="copy-outline"
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
            {links?.data?.map((l: any) => (
              <Card key={l.id}>
                <Text style={styles.h2}>
                  {l.role === "STUDENT" ? "Öğrenci erişimi" : "Veli erişimi"}
                </Text>
                <Text style={styles.muted}>
                  {l.revokedAt ? "Kaldırıldı" : "Etkin"}
                </Text>
                {!l.revokedAt && (
                  <Button
                    secondary
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
                    Erişimi kaldır
                  </Button>
                )}
              </Card>
            ))}
            {links?.invitations?.map((i: any) => (
              <Card key={i.id}>
                <Text style={styles.h2}>{i.email}</Text>
                <Text style={styles.muted}>
                  {i.acceptedAt
                    ? "Kabul edildi"
                    : i.revokedAt
                      ? "İptal edildi"
                      : new Date(i.expiresAt) < new Date()
                        ? "Süresi doldu"
                        : "Davet bekliyor"}
                </Text>
                {!i.acceptedAt && !i.revokedAt && (
                  <Button
                    secondary
                    onPress={async () => {
                      try {
                        await request(
                          `/workspaces/${access.id}/students/${studentId}/access/revoke`,
                          { id: i.id, kind: "invitation" },
                        );
                        await loadLinks();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Daveti iptal et
                  </Button>
                )}
              </Card>
            ))}
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
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)" }}>
          <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: "#ffffff", fontSize: 14 }}
              >
                {preview?.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setPreview(null)}
                hitSlop={10}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="close" size={24} color="#ffffff" />
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
export function Inbox({ workspaceId }: { workspaceId?: string }) {
  const { styles } = useTheme();
  const [rows, setRows] = useState<any[]>([]),
    [limits, setLimits] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        setRows((await request("/inbox")).data);
        if (workspaceId)
          setLimits(
            (await request(`/workspaces/${workspaceId}/settings/limits`)).data,
          );
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [workspaceId]);
  return (
    <>
      <ErrorText message={error} />
      {limits && (
        <Card>
          <Text style={styles.h2}>
            {limits.limits.plan === "PRO" ? "Pro plan" : "Pilot plan"}
          </Text>
          <Text style={styles.text}>
            {limits.used.students} / {limits.limits.studentLimit} aktif öğrenci
          </Text>
          <Text style={styles.text}>
            {Math.ceil(Number(limits.used.videoSeconds) / 60)} /{" "}
            {Math.floor(limits.limits.videoSeconds / 60)} dakika video
          </Text>
          <Text style={styles.text}>
            {(Number(limits.used.materialBytes) / 1024 ** 2).toFixed(1)} /{" "}
            {Math.floor(Number(limits.limits.materialBytes) / 1024 ** 2)} MB
            dosya
          </Text>
        </Card>
      )}
      {!rows.length && <Text style={styles.muted}>Henüz bildirim yok.</Text>}
      {rows.map((n) => (
        <Card key={n.id}>
          <Text style={styles.h2}>{n.title}</Text>
          <Text style={styles.text}>{n.body}</Text>
          {!n.readAt && (
            <Button
              secondary
              onPress={async () => {
                try {
                  await request(`/inbox/${n.id}/read`, {});
                  setRows((old) =>
                    old.map((x) =>
                      x.id === n.id
                        ? { ...x, readAt: new Date().toISOString() }
                        : x,
                    ),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Okundu olarak işaretle
            </Button>
          )}
        </Card>
      ))}
    </>
  );
}

const makePill = (colors: Palette) =>
  StyleSheet.create({
  chip: {
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipOn: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.body },
  chipTextOn: { color: colors.white, fontWeight: "700" },
  });
