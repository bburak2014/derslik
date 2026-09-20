"use client";
import { Subscription } from "@/components/account/subscription";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  uploadTus,
  type Access,
  type LearningData,
  type PortalData,
  type Video,
  type Material,
} from "@derslik/api-client";
import { money, dayLabel, dateKey } from "@derslik/contracts";
import { backend } from "@/lib/client";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Copy,
  Download,
  Eye,
  FileText,
  Play,
  RefreshCw,
  Trash2,
  Video as VideoIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageLoader, Skeleton, Spinner } from "@/components/derslik/loading";
import { WhatsappIcon } from "@/components/account/provider-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoPlayer } from "./video-player";

type Field = {
  name: string;
  label: string;
  value?: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
type FormSpec = {
  title: string;
  fields: Field[];
  submit: (values: Record<string, string>) => Promise<void>;
};
function ActionForm({
  spec,
  onClose,
}: {
  spec: FormSpec | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open={!!spec}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="learning-dialog">
        <DialogHeader>
          <DialogTitle>{spec?.title}</DialogTitle>
          <DialogDescription>Bilgileri girip kaydedin.</DialogDescription>
        </DialogHeader>
        {spec && (
          <form
            key={spec.title}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await spec.submit(
                  Object.fromEntries(new FormData(e.currentTarget)) as Record<
                    string,
                    string
                  >,
                );
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {spec.fields.map((f) => (
              <div className="form-field" key={f.name}>
                <Label htmlFor={"field-" + f.name}>{f.label}</Label>
                {f.options ? (
                  // Radix Root, name verildiğinde form gönderimi için gizli bir
                  // yerel select basar; FormData okuması bozulmaz.
                  <Select name={f.name} defaultValue={f.value}>
                    <SelectTrigger id={"field-" + f.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.type === "textarea" ? (
                  <textarea
                    id={"field-" + f.name}
                    name={f.name}
                    defaultValue={f.value}
                    required={f.required !== false}
                    maxLength={5000}
                    rows={5}
                  />
                ) : (
                  <input
                    id={"field-" + f.name}
                    name={f.name}
                    type={f.type || "text"}
                    defaultValue={f.value}
                    required={f.required !== false}
                    maxLength={f.type === "email" ? 200 : 150}
                    min={f.type === "number" ? 0 : undefined}
                  />
                )}
              </div>
            ))}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy && <Spinner />}
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
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
type Confirmation = {
  title: string;
  description: string;
  action: string;
  perform: () => void | Promise<void>;
};

function ConfirmDialog({
  state,
  onClose,
}: {
  state: Confirmation | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          <AlertDialogDescription>{state?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void state?.perform();
              onClose();
            }}
          >
            {state?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LearningPanel({
  workspaceId,
  studentId,
  studentName,
  studentPhone,
  role = "OWNER",
  view,
  initialTab,
  autoInvite = false,
}: {
  workspaceId: string;
  studentId: string;
  studentName?: string;
  studentPhone?: string;
  role?: "OWNER" | "STUDENT" | "GUARDIAN";
  view?: "assignments" | "files" | "videos";
  /** Açılışta seçili gelecek sekme (öğrenci panelindeki kısayollar için). */
  initialTab?: string;
  /** Açılışta davet formu doğrudan açılsın mı. */
  autoInvite?: boolean;
}) {
  const owner = role === "OWNER",
    student = role === "STUDENT";
  const [capabilities, setCapabilities] = useState<{
    files: boolean;
    videos: boolean;
  } | null>(null);
  const [data, setData] = useState<LearningData | PortalData>(empty),
    [loading, setLoading] = useState(true),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState(initialTab ?? "assignments"),
    // Davet kısayolu formu ilk render'da açar; effect ile açmak fazladan bir
    // render turu ve yanıp sönme demek olurdu.
    [form, setForm] = useState<FormSpec | null>(() =>
      autoInvite ? inviteSpec() : null,
    ),
    [activeVideo, setActiveVideo] = useState<Video | null>(null),
    [filePreview, setFilePreview] = useState<{
      file: Material;
      url: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [access, setAccess] = useState<any>(null),
    // Davet sonucu: bağlantı + e-postanın gerçekten gidip gitmediği.
    [invite, setInvite] = useState<{
      url: string;
      email: string;
      emailed: boolean;
    } | null>(null);
  useEffect(() => {
    if (view) setTab(view);
  }, [view]);
  const uploadSession = useRef<{
    fingerprint: string;
    id: string;
    url: string;
  } | null>(null);
  const base = owner
      ? `/workspaces/${workspaceId}/students/${studentId}/learning`
      : `/portal/${workspaceId}/${studentId}`,
    media = `/media/${workspaceId}/${studentId}`;
  const reload = useCallback(async () => {
    try {
      const [result, status] = await Promise.all([
        backend(base),
        backend("/media/capabilities").catch(() => ({
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
    }
  }, [base]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const permissions = owner
    ? ["lessons", "assignments", "videos", "notes", "payments"]
    : (data as PortalData).permissions || [];
  async function action(command: unknown) {
    await backend(owner ? base : base + "/actions", command);
    await reload();
  }
  function simple(
    title: string,
    fields: Field[],
    convert: (v: Record<string, string>) => unknown,
  ) {
    setForm({
      title,
      fields,
      submit: async (v) => {
        await action(convert(v));
      },
    });
  }
  async function accessReload() {
    try {
      setAccess(
        await backend(
          `/workspaces/${workspaceId}/students/${studentId}/access`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function attach(assignmentId: string | null, file: File) {
    if (!capabilities?.files) {
      setError("Dosya yükleme şu anda kullanılamıyor.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data: r } = await backend(media + "/files", {
        assignmentId,
        purpose: owner
          ? assignmentId
            ? "ASSIGNMENT"
            : "RESOURCE"
          : "SUBMISSION",
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (r.uploadUrl) {
        const uploaded = await fetch(r.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type, "x-upsert": "false" },
          body: file,
        });
        if (!uploaded.ok && uploaded.status !== 409)
          throw new Error("Dosya yüklenemedi. Yeniden deneyin.");
      }
      await backend(media + `/files/${r.id}/finish`, {});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Davet formunun tanımı; hem sekmedeki düğme hem de öğrenci panelindeki
   *  kısayol aynı formu açsın diye tek yerde duruyor. */
  function inviteSpec(): FormSpec {
    return {
      title: "Davet bağlantısı oluştur",
      fields: [
        { name: "email", label: "Davet edilecek e-posta", type: "email" },
        {
          name: "role",
          label: "Hesap türü",
          value: "STUDENT",
          options: [
            { value: "STUDENT", label: "Öğrenci" },
            { value: "GUARDIAN", label: "Veli" },
          ],
        },
        {
          name: "payments",
          label: "Paket ve ödeme bilgisi",
          value: "no",
          options: [
            { value: "no", label: "Gizli kalsın" },
            { value: "yes", label: "Görüntüleyebilsin" },
          ],
        },
      ],
      submit: async (v) => {
        const r = await backend(
          `/workspaces/${workspaceId}/students/${studentId}/invitations`,
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
        setInvite({
          url: r.data.url,
          email: v.email,
          emailed: Boolean(r.data.emailed),
        });
        await accessReload();
      },
    };
  }
  async function openPreview(file: Material) {
    setBusy(true);
    try {
      // inline=1: imzalı bağlantı indirme yerine satır içi gösterim için gelsin.
      const r = await backend(media + `/files/${file.id}/download?inline=1`);
      setFilePreview({ file, url: r.data.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(file: Material) {
    try {
      const r = await backend(media + `/files/${file.id}/download`);
      window.location.assign(r.data.url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function remove(file: Material) {
    setConfirmation({
      title: "Dosya silinsin mi?",
      description: `“${file.name}” kalıcı olarak kaldırılacak. Öğrenci artık indiremeyecek.`,
      action: "Sil",
      perform: () => removeNow(file),
    });
  }
  async function removeNow(file: Material) {
    setBusy(true);
    try {
      await backend(media + `/files/${file.id}/delete`, {});
      await reload();
    } catch (e) {
      await reload();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    ...(owner
      ? []
      : [{ id: "lessons", title: "Dersler", permission: "lessons" }]),
    { id: "assignments", title: "Ödevler", permission: "assignments" },
    { id: "files", title: "PDF ve dosyalar", permission: "assignments" },
    { id: "videos", title: "Videolar", permission: "videos" },
    { id: "notes", title: "Paylaşımlar", permission: "notes" },
    ...(owner
      ? [{ id: "access", title: "Davetler", permission: "lessons" }]
      : [{ id: "payments", title: "Paket ve bakiye", permission: "payments" }]),
  ].filter((t) => permissions.includes(t.permission));
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [permissions.join(","), tab]);
  if (loading)
    return (
      <div className="learning-panel">
        <PageLoader compact />
      </div>
    );
  return (
    <section className="learning-panel">
      {!view && (
        <div
          className="learning-tabs"
          role="tablist"
          aria-label="Öğrenci içerikleri"
        >
          {tabs.map((t) => (
            <button
              role="tab"
              aria-selected={tab === t.id}
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "access") void accessReload();
              }}
            >
              {t.title}
            </button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            aria-label="İçerikleri yenile"
            onClick={() => void reload()}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
      )}
      {view && (
        <Button
          variant="outline"
          size="sm"
          className="mb-4"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} /> İçerikleri yenile
        </Button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {(owner || student) &&
        ((tab === "videos" && !capabilities?.videos) ||
          (["assignments", "files"].includes(tab) && !capabilities?.files)) && (
          <div className="media-notice" role="status">
            <div>
              <strong>
                {tab === "videos"
                  ? "Video yükleme kullanıma hazır değil"
                  : "Dosya yükleme kullanıma hazır değil"}
              </strong>
              <p>
                Yükleme hizmetine şu anda erişilemiyor. Hizmet
                etkinleştirildikten sonra tekrar kontrol edebilirsiniz.
              </p>
            </div>
            <button type="button" onClick={() => void reload()}>
              Tekrar kontrol et
            </button>
          </div>
        )}
      {tab === "lessons" && "lessons" in data && (
        <div className="learning-list">
          {data.lessons.length ? (
            data.lessons.map((l) => (
              <article key={l.id}>
                <span className="eyebrow">
                  {l.status === "SCHEDULED"
                    ? "PLANLANDI"
                    : l.status === "COMPLETED"
                      ? "TAMAMLANDI"
                      : "İPTAL"}
                </span>
                <h3>{l.topic}</h3>
                <p>
                  {dayLabel(l.starts_at, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {l.location || "Konum belirtilmedi"}
                </p>
              </article>
            ))
          ) : (
            <p>Henüz ders planlanmamış.</p>
          )}
        </div>
      )}
      {tab === "assignments" && (
        <>
          <div className="learning-heading">
            <div>
              <h2>Bir sonraki adıma hazırlık</h2>
              <p>Ödevler, teslimler ve geri bildirimler.</p>
            </div>
            {owner && (
              <button
                className="primary-button"
                onClick={() =>
                  simple(
                    "Yeni ödev",
                    [
                      { name: "title", label: "Başlık" },
                      {
                        name: "instructions",
                        label: "Yönerge",
                        type: "textarea",
                        required: false,
                      },
                      {
                        name: "dueOn",
                        label: "Son teslim",
                        required: false,
                        type: "date",
                        value: dateKey(),
                      },
                    ],
                    (v) => ({ action: "assignment.create", ...v }),
                  )
                }
              >
                Ödev ver
              </button>
            )}
          </div>
          <div className="learning-list">
            {!data.assignments.length && (
              <p className="learning-empty">
                Henüz ödev yok. Yeni ödevler burada görünecek.
              </p>
            )}
            {data.assignments.map((a) => {
              const sub = data.submissions.find(
                (s) => s.assignment_id === a.id,
              );
              return (
                <article key={a.id}>
                  <div className="learning-card-heading">
                    <span className="eyebrow">
                      {a.status === "CANCELLED"
                        ? "İPTAL EDİLDİ"
                        : a.status === "COMPLETED"
                          ? "TAMAMLANDI"
                          : sub
                            ? sub.status === "REVIEWED"
                              ? "DEĞERLENDİRİLDİ"
                              : "TESLİM EDİLDİ"
                            : "TESLİM BEKLENİYOR"}
                    </span>
                    <small>
                      {a.due_on
                        ? dayLabel(a.due_on + "T12:00:00+03:00")
                        : "Son teslim tarihi yok"}
                    </small>
                  </div>
                  <h3>{a.title}</h3>
                  <p className="preserve-lines">{a.instructions}</p>
                  {sub && (
                    <div className="feedback">
                      <strong>Öğrenci teslimi</strong>
                      <p className="preserve-lines">{sub.body}</p>
                      {sub.feedback && (
                        <>
                          <strong>Öğretmen geri bildirimi</strong>
                          <p className="preserve-lines">{sub.feedback}</p>
                        </>
                      )}
                    </div>
                  )}
                  <div className="material-list">
                    {data.materials
                      .filter((m) => m.assignment_id === a.id)
                      .map((m) => (
                        <button
                          key={m.id}
                          disabled={m.status !== "READY" || m.delete_requested}
                          onClick={async () => {
                            try {
                              const r = await backend(
                                media + `/files/${m.id}/download`,
                              );
                              window.location.assign(r.data.url);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          ↗ {m.name} ·{" "}
                          {m.purpose === "SUBMISSION" ? "Teslim" : "Kaynak"}
                          {m.status !== "READY" ? " (Yükleme bekliyor)" : ""}
                        </button>
                      ))}
                  </div>
                  <div className="learning-actions">
                    {owner && (
                      <button
                        className="secondary-button"
                        onClick={() =>
                          simple(
                            "Ödevi düzenle",
                            [
                              {
                                name: "title",
                                label: "Başlık",
                                value: a.title,
                              },
                              {
                                name: "instructions",
                                label: "Yönerge",
                                type: "textarea",
                                value: a.instructions,
                                required: false,
                              },
                              {
                                name: "dueOn",
                                label: "Son teslim",
                                type: "date",
                                value: a.due_on || "",
                                required: false,
                              },
                              {
                                name: "status",
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
                      </button>
                    )}
                    {student &&
                      a.status === "OPEN" &&
                      sub?.status !== "REVIEWED" && (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            simple(
                              "Ödevi teslim et",
                              [
                                {
                                  name: "body",
                                  label: "Çözümünüz / açıklamanız",
                                  type: "textarea",
                                  value: sub?.body || "",
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
                        </button>
                      )}
                    {owner && sub && (
                      <button
                        className="secondary-button"
                        onClick={() =>
                          simple(
                            "Ödevi değerlendir",
                            [
                              {
                                name: "feedback",
                                label: "Geri bildirim",
                                type: "textarea",
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
                      </button>
                    )}
                    {(owner || (student && a.status === "OPEN")) && (
                      <label className="file-button">
                        {busy && <Spinner />}
                        {busy ? "Yükleniyor…" : "Dosya ekle"}
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp"
                          disabled={busy || !capabilities?.files}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void attach(a.id, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <small>
                    Dosyalar: PDF, JPG, PNG veya WebP · en fazla 10 MB.
                  </small>
                </article>
              );
            })}
          </div>
        </>
      )}
      {tab === "files" && (
        <>
          <div className="learning-heading">
            <div>
              <h2>PDF ve dosyalar</h2>
              <p>
                Ödev ekleri, çözümler ve öğrenciye paylaşılan ders materyalleri.
              </p>
            </div>
          </div>
          {owner && (
            <div className="upload-layout">
            <form
              className="video-upload"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const values = new FormData(form),
                  file = values.get("file") as File;
                if (file?.size)
                  await attach(
                    String(values.get("assignmentId") || "") || null,
                    file,
                  );
              }}
            >
              <div className="form-field">
                <Label htmlFor="material-assignment">Bağlı ödev</Label>
                <Select name="assignmentId" defaultValue="">
                  <SelectTrigger id="material-assignment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Genel ders materyali</SelectItem>
                    {data.assignments.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label>
                PDF veya görsel
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  required
                  disabled={busy || !capabilities?.files}
                />
              </label>
              <small>PDF, JPG, PNG veya WebP · en fazla 10 MB.</small>
              <button
                className="primary-button"
                disabled={busy || !capabilities?.files}
              >
                {busy && <Spinner />}
                {busy ? "Yükleniyor…" : "Dosya yükle"}
              </button>
            </form>
            <UploadAside kind="files" />
            </div>
          )}
          <div className="learning-list">
            {!data.materials.length && (
              <p className="learning-empty">
                Henüz dosya yok. Eklenen PDF ve materyaller burada görünecek.
              </p>
            )}
            {data.materials.map((file) => (
              <article key={file.id}>
                <div className="learning-row">
                  <div className="learning-row-main">
                    <h3>{file.name}</h3>
                    <p>
                      {file.assignment_id
                        ? data.assignments.find(
                            (a) => a.id === file.assignment_id,
                          )?.title
                        : "Genel ders materyali"}{" "}
                      · {Math.ceil(Number(file.size_bytes) / 1024)} KB
                    </p>
                  </div>
                <div className="learning-actions learning-actions-aligned">
                  {file.status === "READY" && !file.delete_requested ? (
                    <>
                      <IconAction
                        label="Önizle"
                        icon={<Eye size={16} />}
                        disabled={busy}
                        onClick={() => void openPreview(file)}
                      />
                      <IconAction
                        label="Dosyayı indir"
                        icon={<Download size={16} />}
                        onClick={() => void download(file)}
                      />
                    </>
                  ) : (
                    <span className="learning-state">
                      {file.delete_requested
                        ? "Silme bekliyor"
                        : "Yükleme tamamlanmadı"}
                    </span>
                  )}
                  {owner && (
                    <IconAction
                      danger
                      label={
                        file.delete_requested ? "Silmeyi yeniden dene" : "Sil"
                      }
                      icon={<Trash2 size={16} />}
                      disabled={busy}
                      onClick={() => void remove(file)}
                    />
                  )}
                </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "videos" && (
        <>
          <div className="learning-heading">
            <div>
              <h2>Dersi yeniden keşfedin</h2>
              <p>Videoyu izleyin; sorularınızı ilgili saniyeye ekleyin.</p>
            </div>
          </div>
          {owner && (
            <div className="upload-layout">
            <form
              className="video-upload"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!capabilities?.videos) return;
                const f = new FormData(e.currentTarget),
                  file = f.get("file") as File;
                if (!file?.size) return;
                setBusy(true);
                setError("");
                setProgress(0);
                try {
                  const fingerprint = [
                    file.name,
                    file.size,
                    file.lastModified,
                    f.get("title"),
                    f.get("duration"),
                    f.get("lessonId"),
                    studentId,
                  ].join(":");
                  let upload = uploadSession.current;
                  if (upload?.fingerprint !== fingerprint) {
                    const r = await backend(media + "/videos", {
                      title: f.get("title"),
                      lessonId: f.get("lessonId") || null,
                      sizeBytes: file.size,
                      maxDurationSeconds: Number(f.get("duration")) * 60,
                    });
                    upload = {
                      fingerprint,
                      id: r.data.id,
                      url: r.data.uploadUrl,
                    };
                    uploadSession.current = upload;
                  }
                  await uploadTus(
                    upload!.url,
                    { size: file.size, slice: (a, b) => file.slice(a, b) },
                    { onProgress: setProgress },
                  );
                  await backend(media + `/videos/${upload!.id}/refresh`, {});
                  uploadSession.current = null;
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                  await reload();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-field">
                <Label htmlFor="video-lesson">Ders</Label>
                <Select name="lessonId" defaultValue="">
                  <SelectTrigger id="video-lesson">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Genel ders videosu</SelectItem>
                    {data.lessons.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.topic} · {dayLabel(l.starts_at)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label>
                Video başlığı
                <input name="title" required maxLength={150} />
              </label>
              <label>
                En fazla süre (dakika)
                <input
                  name="duration"
                  type="number"
                  min={1}
                  max={120}
                  defaultValue={60}
                  required
                />
              </label>
              <label>
                Video dosyası
                <input
                  name="file"
                  type="file"
                  accept="video/*"
                  disabled={busy || !capabilities?.videos}
                  required
                />
              </label>
              <small>
                En fazla 2 GB. Yükleme kesilirse aynı dosya ile tekrar deneyin.
              </small>
              {progress !== null && (
                <progress
                  max={1}
                  value={progress}
                  aria-label="Video yükleme ilerlemesi"
                />
              )}
              <button
                className="primary-button"
                disabled={busy || !capabilities?.videos}
              >
                {busy && <Spinner />}
                {busy
                  ? `Yükleniyor · %${Math.round((progress || 0) * 100)}`
                  : "Videoyu yükle"}
              </button>
            </form>
            <UploadAside kind="videos" />
            </div>
          )}
          <div className="learning-list">
            {!data.videos.length && (
              <p className="learning-empty">
                Hazır olduğunda ders videoları burada görünecek.
              </p>
            )}
            {data.videos.map((v) => (
              <article key={v.id}>
                <div className="learning-row">
                  <div className="learning-row-main">
                    <div className="learning-card-heading">
                      <h3>{v.title}</h3>
                      <span className="eyebrow">
                        {v.delete_requested
                          ? "SİLME BEKLİYOR"
                          : v.status === "READY"
                            ? `${Math.ceil((v.duration_seconds || 0) / 60)} DK`
                            : v.status === "FAILED"
                              ? "YÜKLENEMEDİ"
                              : "HAZIRLANIYOR"}
                      </span>
                    </div>
                  </div>
                <div className="learning-actions learning-actions-aligned">
                  {v.status === "READY" && !v.delete_requested && (
                    <IconAction
                      label="Videoyu aç"
                      icon={<Play size={16} />}
                      onClick={() => setActiveVideo(v)}
                    />
                  )}
                  {owner && (
                    <>
                      <IconAction
                        label="Durumu yenile"
                        icon={<RefreshCw size={16} />}
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await backend(
                              media + `/videos/${v.id}/refresh`,
                              {},
                            );
                            await reload();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                      <IconAction
                        danger
                        label="Sil"
                        icon={<Trash2 size={16} />}
                        disabled={busy}
                        onClick={() =>
                          setConfirmation({
                            title: "Video silinsin mi?",
                            description:
                              "Kayıt kalıcı olarak kaldırılacak. Öğrenci artık izleyemeyecek.",
                            action: "Sil",
                            perform: async () => {
                              setBusy(true);
                              try {
                                await backend(
                                  media + `/videos/${v.id}/delete`,
                                  {},
                                );
                                await reload();
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            },
                          })
                        }
                      />
                    </>
                  )}
                </div>
                </div>
                {data.questions
                  .filter((q) => q.video_id === v.id)
                  .map((q) => (
                    <div className="video-question" key={q.id}>
                      <strong>
                        {Math.floor(q.at_seconds / 60)}:
                        {String(q.at_seconds % 60).padStart(2, "0")} · Soru
                      </strong>
                      <p>{q.body}</p>
                      {q.answer && (
                        <p className="feedback">
                          {q.answer} {q.resolved ? "✓" : ""}
                        </p>
                      )}
                      {owner && (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            simple(
                              "Video sorusunu yanıtla",
                              [
                                {
                                  name: "answer",
                                  label: "Yanıtınız",
                                  type: "textarea",
                                  value: q.answer,
                                },
                              ],
                              (val) => ({
                                action: "question.answer",
                                questionId: q.id,
                                answer: val.answer,
                                resolved: true,
                                version: q.version,
                              }),
                            )
                          }
                        >
                          Yanıtla
                        </button>
                      )}
                    </div>
                  ))}
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "notes" && (
        <>
          <div className="learning-heading">
            <div>
              <h2>Gelişim günlüğü</h2>
              <p>Paylaşılan notlar ve öğretmen onaylı haftalık özetler.</p>
            </div>
          </div>
          {owner && (
            <div className="learning-actions">
              <button
                className="primary-button"
                onClick={() =>
                  simple(
                    "Not paylaş",
                    [
                      { name: "body", label: "Notunuz", type: "textarea" },
                      {
                        name: "audience",
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
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  simple(
                    "Haftalık özet hazırla",
                    [
                      {
                        name: "weekOn",
                        label: "Hafta başlangıcı",
                        type: "date",
                        value: dateKey(),
                      },
                    ],
                    (v) => ({ action: "summary.draft", weekOn: v.weekOn }),
                  )
                }
              >
                Özet taslağı hazırla
              </button>
            </div>
          )}
          <div className="learning-list">
            {!data.notes.length && !data.summaries.length && (
              <p className="learning-empty">Paylaşılan bir not henüz yok.</p>
            )}
            {data.summaries.map((s) => (
              <article key={s.id}>
                <span className="eyebrow">
                  HAFTALIK ÖZET ·{" "}
                  {s.status === "DRAFT" ? "TASLAK" : "PAYLAŞILDI"}
                </span>
                <h3>{dayLabel(s.week_on + "T12:00:00+03:00")} haftası</h3>
                <p className="preserve-lines">{s.body}</p>
                {owner && (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      simple(
                        "Özeti incele ve paylaş",
                        [
                          {
                            name: "body",
                            label: "Özet",
                            type: "textarea",
                            value: s.body,
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
                  </button>
                )}
              </article>
            ))}
            {data.notes.map((n) => (
              <article key={n.id}>
                <span className="eyebrow">
                  {n.audience === "BOTH" ? "ÖĞRENCİ VE VELİ" : "ÖĞRENCİ"}
                </span>
                <p className="preserve-lines">{n.body}</p>
                <small>{dayLabel(n.created_at)}</small>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "payments" && "packages" in data && (
        <div className="learning-list">
          <article>
            <span className="eyebrow">AÇIK BAKİYE</span>
            <h2>
              {money(
                data.packages.reduce((n, p) => n + Number(p.price_minor), 0) -
                  data.payments
                    .filter((p) => !p.voided_at)
                    .reduce((n, p) => n + Number(p.amount_minor), 0),
              )}
            </h2>
            <p>Öğretmeninizin kaydettiği paket ve tahsilatlara göre.</p>
          </article>
          {data.packages.map((p) => (
            <article key={p.id}>
              <h3>{p.name}</h3>
              <p>
                {p.remaining} / {p.granted} ders hakkı · {money(p.price_minor)}
              </p>
            </article>
          ))}
          {data.payments.map((p) => (
            <article key={p.id}>
              <h3>{money(p.amount_minor)}</h3>
              <p>
                {dayLabel(p.received_on + "T12:00:00+03:00")} ·{" "}
                {p.voided_at ? "İptal edildi" : "Tahsil edildi"}
              </p>
            </article>
          ))}
        </div>
      )}
      {tab === "access" && owner && (
        <>
          <div className="learning-heading">
            <div>
              <h2>Öğrenci ve veli erişimi</h2>
              <p>
                Davet yalnızca belirtilen, doğrulanmış e-posta hesabıyla kabul
                edilir.
              </p>
            </div>
          </div>
          <button
            className="primary-button"
            onClick={() => setForm(inviteSpec())}
          >
            Davet oluştur
          </button>
          {invite && (
            <div className="invite-link">
              <p className="invite-state">
                {invite.emailed
                  ? `Davet ${invite.email} adresine e-posta ile gönderildi. Ulaşmadıysa aşağıdaki bağlantıyı kendiniz iletebilirsiniz.`
                  : "E-posta gönderimi kapalı; bağlantıyı aşağıdan kopyalayıp iletin."}
              </p>
              <label>
                Davet bağlantısı · 7 gün geçerli
                <input
                  readOnly
                  value={invite.url}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <div className="invite-actions">
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invite.url);
                    } catch {
                      setError("Bağlantıyı seçip kopyalayın.");
                    }
                  }}
                >
                  <Copy size={15} /> Kopyala
                </button>
                {whatsappNumber(studentPhone || "") && (
                  <a
                    className="secondary-button whatsapp-button"
                    href={whatsappInviteUrl(
                      studentPhone || "",
                      studentName || "",
                      invite.url,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <WhatsappIcon /> WhatsApp ile gönder
                  </a>
                )}
              </div>
            </div>
          )}
          <div className="learning-list">
            {access?.data?.map((a: any) => (
              <article key={a.id}>
                <h3>
                  {a.role === "STUDENT" ? "Öğrenci erişimi" : "Veli erişimi"}
                </h3>
                <p>{a.revokedAt ? "Kaldırıldı" : "Etkin"}</p>
                {!a.revokedAt && (
                  <button
                    className="text-danger"
                    onClick={() =>
                      setConfirmation({
                        title: "Erişim kaldırılsın mı?",
                        description:
                          "Bu hesap öğrencinin ödev, dosya ve videolarını artık göremeyecek.",
                        action: "Kaldır",
                        perform: async () => {
                          try {
                            await backend(
                              `/workspaces/${workspaceId}/students/${studentId}/access/revoke`,
                              { id: a.id, kind: "link" },
                            );
                            await accessReload();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        },
                      })
                    }
                  >
                    Erişimi kaldır
                  </button>
                )}
              </article>
            ))}
            {access?.invitations?.map((a: any) => (
              <article key={a.id}>
                <h3>{a.email}</h3>
                <p>
                  {a.acceptedAt
                    ? "Kabul edildi"
                    : a.revokedAt
                      ? "İptal edildi"
                      : new Date(a.expiresAt) < new Date()
                        ? "Süresi doldu"
                        : "Davet bekliyor"}
                </p>
                {!a.acceptedAt && !a.revokedAt && (
                  <button
                    className="text-danger"
                    onClick={async () => {
                      try {
                        await backend(
                          `/workspaces/${workspaceId}/students/${studentId}/access/revoke`,
                          { id: a.id, kind: "invitation" },
                        );
                        await accessReload();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Daveti iptal et
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      <ActionForm
        key={form?.title || "closed"}
        spec={form}
        onClose={() => setForm(null)}
      />
      <Dialog
        open={!!filePreview}
        onOpenChange={(open) => {
          if (!open) setFilePreview(null);
        }}
      >
        <DialogContent className="preview-dialog">
          <DialogHeader>
            <DialogTitle>{filePreview?.file.name}</DialogTitle>
            <DialogDescription>
              Önizleme · dosyayı indirmeden içeriğine göz atın.
            </DialogDescription>
          </DialogHeader>
          {filePreview &&
            (isImageName(filePreview.file.name) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="preview-frame"
                src={filePreview.url}
                alt={filePreview.file.name}
              />
            ) : (
              <iframe
                className="preview-frame"
                src={filePreview.url}
                title={filePreview.file.name}
              />
            ))}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void download(filePreview!.file)}
            >
              <Download size={16} /> Dosyayı indir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeVideo}
        onOpenChange={(open) => {
          if (!open) setActiveVideo(null);
        }}
      >
        <DialogContent className="video-dialog">
          <DialogHeader>
            <DialogTitle>{activeVideo?.title}</DialogTitle>
            <DialogDescription>
              Ders videosu ve zaman damgalı sorular.
            </DialogDescription>
          </DialogHeader>
          {activeVideo && (
            <VideoPlayer
              key={activeVideo.id}
              video={activeVideo}
              initialTime={
                data.progress.find((p) => p.video_id === activeVideo.id)
                  ?.seconds || 0
              }
              mediaPath={media}
              canAsk={student}
              onProgress={(seconds) =>
                action({
                  action: "video.progress",
                  videoId: activeVideo.id,
                  seconds,
                })
              }
              onAsk={(seconds) =>
                simple(
                  "Bu saniyeye soru ekle",
                  [
                    {
                      name: "body",
                      label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} için sorunuz`,
                      type: "textarea",
                    },
                  ],
                  (v) => ({
                    action: "question.create",
                    videoId: activeVideo.id,
                    atSeconds: seconds,
                    body: v.body,
                  }),
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        state={confirmation}
        onClose={() => setConfirmation(null)}
      />
    </section>
  );
}
export function Portal({
  access,
  switcher,
  onSignout,
}: {
  access: Access;
  switcher?: React.ReactNode;
  onSignout?: () => void;
}) {
  return (
    <main className="portal-page">
      <header className="portal-header">
        <div>
          <p className="eyebrow">
            {access.role === "STUDENT"
              ? "ÖĞRENCİ ÇALIŞMA ALANI"
              : "VELİ TAKİP ALANI"}
          </p>
          <h1>{access.studentName}</h1>
          <p>Her ders, yeni bir adım.</p>
        </div>
        <div className="portal-account">
          {switcher}
          <div className="portal-account-actions">
            <ThemeToggle />
            <AccountExtras />
            {onSignout && (
              <button className="secondary-button" onClick={onSignout}>
                Çıkış yap
              </button>
            )}
          </div>
        </div>
      </header>
      <LearningPanel
        workspaceId={access.id}
        studentId={access.studentId!}
        role={access.role as "STUDENT" | "GUARDIAN"}
      />
    </main>
  );
}
// Yükleme formu okunabilir genişlikte kalınca sağda geniş bir boşluk kalıyordu.
// Oraya dekor yerine işin kendisine ait bilgi konuyor: akışın adımları, kabul
// edilen dosya kuralları ve öğrencinin sonunda ne göreceği.
// Liste satırlarındaki eylemler metin yerine ikon düğmesi: satır daralıyor,
// adlar tooltip ve aria-label olarak kalıyor (yalnızca ikon erişilebilirliği
// kaybettirmesin diye).
function IconAction({
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className={"icon-action" + (danger ? " icon-action-danger" : "")}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Öğretmen telefonu serbest metin olarak giriyor ("0532 123 45 67",
 * "+90 532...", "532..."). wa.me yalnızca ülke koduyla ve yalnızca rakam
 * kabul eder. Türkiye cep numaraları 5 ile başladığı için baştaki "90" güvenle
 * ülke kodu sayılabilir; başka bir ülke kodu yazılmışsa dokunulmaz.
 */
function whatsappNumber(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("90")) return digits;
  if (digits.startsWith("0")) return "90" + digits.slice(1);
  if (digits.length === 10) return "90" + digits;
  return digits;
}

function whatsappInviteUrl(phone: string, name: string, invite: string) {
  const text =
    `Merhaba${name ? " " + name : ""}, Derslik'te size bir hesap tanımladım. ` +
    `Aşağıdaki bağlantıdan 7 gün içinde giriş yapabilirsiniz:\n\n${invite}`;
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`;
}

function isImageName(name: string) {
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(name);
}

function UploadAside({ kind }: { kind: "files" | "videos" }) {
  const video = kind === "videos";
  const steps = video
    ? ["Videonun ait olduğu dersi seçin.", "Dosyayı ekleyip süreyi doğrulayın.", "Yükleme bitince öğrenci izleyebilir."]
    : ["Ödevi ya da genel materyali seçin.", "PDF veya görseli ekleyin.", "Dosya öğrencinin paneline düşer."];
  const rules = video
    ? ["MP4 veya MOV", "En fazla 2 GB", "En fazla 120 dakika"]
    : ["PDF, JPG, PNG veya WebP", "En fazla 10 MB", "Ödeve ya da derse bağlanır"];
  return (
    <aside className="upload-aside">
      <span className="upload-aside-icon" aria-hidden="true">
        {video ? <VideoIcon size={20} /> : <FileText size={20} />}
      </span>
      <h3>{video ? "Video nasıl yayına girer" : "Dosya nasıl paylaşılır"}</h3>
      <ol className="upload-steps">
        {steps.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <dl className="upload-rules">
        <dt>Kabul edilen</dt>
        {rules.map((r) => (
          <dd key={r}>{r}</dd>
        ))}
      </dl>
      <p className="upload-aside-note">
        {video
          ? "Yükleme sürerken sayfadan ayrılmayın; bağlantı koparsa aynı dosyayla kaldığı yerden denenir."
          : "Öğrenciler yalnızca kendilerine bağlanmış dosyaları görür."}
      </p>
    </aside>
  );
}

export function AccountExtras({ workspaceId }: { workspaceId?: string }) {
  const [open, setOpen] = useState(false),
    [inbox, setInbox] = useState<any[]>([]),
    [limits, setLimits] = useState<any>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  // The two requests used to run one after the other while the dialog was
  // already on screen, so it opened empty and then grew twice. They now run in
  // parallel behind a skeleton that occupies the final layout.
  async function show() {
    setOpen(true);
    setError("");
    setLoading(true);
    try {
      const [inboxResult, limitsResult] = await Promise.all([
        backend("/inbox"),
        workspaceId
          ? backend(`/workspaces/${workspaceId}/settings/limits`)
          : Promise.resolve(null),
      ]);
      setInbox(inboxResult.data);
      if (limitsResult) setLimits(limitsResult.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        className="topbar-action"
        onClick={() => void show()}
        aria-label={"Bildirimler" + (workspaceId ? " ve kullanım" : "")}
      >
        <Bell size={16} />
        <span className="topbar-action-label">
          Bildirimler{workspaceId ? " ve kullanım" : ""}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="learning-dialog">
          <DialogHeader>
            <DialogTitle>Hesabınızdan haberler</DialogTitle>
            <DialogDescription>
              Bildirimler ve çalışma alanı kullanımı.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          {loading && (
            <div className="dialog-skeleton" aria-hidden="true">
              <Skeleton className="skeleton-card" />
              <Skeleton className="skeleton-card" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-line short" />
            </div>
          )}
          {!loading && limits && (
            <article className="usage-card">
              <h3>
                {limits.limits.plan === "PRO" ? "Pro plan" : "Pilot plan"}
              </h3>
              <p>
                {limits.used.students} / {limits.limits.studentLimit} aktif
                öğrenci
              </p>
              <p>
                {Math.ceil(Number(limits.used.videoSeconds) / 60)} /{" "}
                {Math.floor(limits.limits.videoSeconds / 60)} dakika video
              </p>
              <p>
                {(Number(limits.used.materialBytes) / 1024 ** 2).toFixed(1)} /{" "}
                {Math.floor(Number(limits.limits.materialBytes) / 1024 ** 2)} MB
                dosya
              </p>
            </article>
          )}
          {!loading && workspaceId && (
            <Subscription
              workspaceId={workspaceId}
              onUpdate={() => void show()}
            />
          )}
          <div className="learning-list" hidden={loading}>
            {!inbox.length && <p>Henüz bildirim yok.</p>}
            {inbox.map((n) => (
              <article key={n.id}>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
                {!n.readAt && (
                  <button
                    onClick={async () => {
                      try {
                        await backend(`/inbox/${n.id}/read`, {});
                        setInbox((old) =>
                          old.map((i) =>
                            i.id === n.id
                              ? { ...i, readAt: new Date().toISOString() }
                              : i,
                          ),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Okundu olarak işaretle
                  </button>
                )}
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
