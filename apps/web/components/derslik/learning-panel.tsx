"use client";
import { Subscription } from "@/components/account/subscription";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  uploadTus,
  type LearningData,
  type PortalData,
  type Video,
  type Material,
} from "@derslik/api-client";
import {
  money,
  dayLabel,
  dateKey,
  addDays,
  timeLabel,
  noticeTarget,
  type Notice,
  type NoticeTarget,
} from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Bell,
  BellOff,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  NotebookPen,
  Package,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Video as VideoIcon,
  Wallet,
  type LucideIcon,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormError, FormSuccess, ToneBadge, type Tone } from "./feedback";
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{spec?.title}</DialogTitle>
          <DialogDescription>Bilgileri girip kaydedin.</DialogDescription>
        </DialogHeader>
        {spec && (
          <form
            key={spec.title}
            className="grid gap-4"
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
              <div className="grid gap-2" key={f.name}>
                <Label htmlFor={"field-" + f.name}>{f.label}</Label>
                {f.options ? (
                  // Radix Root, name verildiğinde form gönderimi için gizli bir
                  // yerel select basar; FormData okuması bozulmaz.
                  <Select name={f.name} defaultValue={f.value}>
                    <SelectTrigger id={"field-" + f.name} className="w-full">
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
                  <Textarea
                    id={"field-" + f.name}
                    name={f.name}
                    defaultValue={f.value}
                    required={f.required !== false}
                    maxLength={5000}
                    rows={5}
                    className="min-h-28"
                  />
                ) : (
                  <Input
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
            {error && <FormError>{error}</FormError>}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  Vazgeç
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </DialogFooter>
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

/** Panel sekmeleri. Öğretmen sayfaları ve öğrenci/veli portalı sekmeyi
 *  dışarıdan `view` ile seçer; o zaman panel kendi sekme şeridini çizmez. */
export type LearningTab =
  | "lessons"
  | "assignments"
  | "files"
  | "videos"
  | "notes"
  | "payments"
  | "access";
export type LearningTabInfo = { id: LearningTab; title: string };
/** Bildirimden açılan yer; `at` aynı bildirime yeniden tıklanınca değişir. */
export type NoticeFocus = NoticeTarget & { at: number };

export function LearningPanel({
  workspaceId,
  studentId,
  studentName,
  studentPhone,
  role = "OWNER",
  view,
  onTabs,
  initialTab,
  autoInvite = false,
  focus,
}: {
  workspaceId: string;
  studentId: string;
  studentName?: string;
  studentPhone?: string;
  role?: "OWNER" | "STUDENT" | "GUARDIAN";
  view?: LearningTab;
  /** İzin verilen sekmeler değiştikçe çağrılır; portalın sol menüsü bunları
   *  listeler. */
  onTabs?: (tabs: LearningTabInfo[]) => void;
  /** Açılışta seçili gelecek sekme (öğrenci panelindeki kısayollar için). */
  initialTab?: string;
  /** Açılışta davet formu doğrudan açılsın mı. */
  autoInvite?: boolean;
  /** Bildirimden gelinen kayıt: görünür olunca kaydırılıp kısa süre
   *  vurgulanır. `at` her tıklamada değişir. */
  focus?: { id: string | null; at: number };
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
  // Aynı bildirim ikinci kez kaydırmasın diye işlenen tıklamanın zamanı.
  const focused = useRef(0),
    focusId = focus?.id,
    focusAt = focus?.at ?? 0;
  useEffect(() => {
    if (loading || !focusId || focused.current === focusAt) return;
    const el = document.querySelector<HTMLElement>(
      `[data-notice-target="${CSS.escape(focusId)}"]`,
    );
    if (!el) return;
    focused.current = focusAt;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.dataset.highlight = "true";
    const timer = setTimeout(() => delete el.dataset.highlight, 2400);
    return () => clearTimeout(timer);
  }, [loading, focusId, focusAt, tab]);
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
  const permissionKey = permissions.join(",");
  const tabs = useMemo(() => {
    const allowed = permissionKey.split(",");
    const all: (LearningTabInfo & { permission: string })[] = [
      ...(owner
        ? []
        : [
            {
              id: "lessons" as const,
              title: "Dersler",
              permission: "lessons",
            },
          ]),
      { id: "assignments", title: "Ödevler", permission: "assignments" },
      { id: "files", title: "PDF ve dosyalar", permission: "assignments" },
      { id: "videos", title: "Videolar", permission: "videos" },
      { id: "notes", title: "Paylaşımlar", permission: "notes" },
      ...(owner
        ? [{ id: "access" as const, title: "Davetler", permission: "lessons" }]
        : [
            {
              id: "payments" as const,
              title: "Paket ve bakiye",
              permission: "payments",
            },
          ]),
    ];
    return all.filter((t) => allowed.includes(t.permission));
  }, [owner, permissionKey]);
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [tabs, tab]);
  useEffect(() => {
    onTabs?.(tabs.map(({ id, title }) => ({ id, title })));
  }, [onTabs, tabs]);
  if (loading)
    return (
      <div className="learning-panel">
        <PageLoader compact />
      </div>
    );
  const today = dateKey();
  const refresh = (
    <IconAction
      outline
      label="İçerikleri yenile"
      icon={<RefreshCw />}
      onClick={() => void reload()}
    />
  );
  return (
    <section className="learning-panel">
      {!view && (
        <div className="flex items-center justify-between gap-3">
          <Tabs
            className="min-w-0"
            value={tab}
            onValueChange={(next) => {
              setTab(next);
              if (next === "access") void accessReload();
            }}
          >
            <TabsList
              className="max-w-full justify-start overflow-x-auto"
              aria-label="Öğrenci içerikleri"
            >
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="flex-none">
                  {t.title}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {refresh}
        </div>
      )}
      {error && <FormError>{error}</FormError>}
      {(owner || student) &&
        ((tab === "videos" && !capabilities?.videos) ||
          (["assignments", "files"].includes(tab) && !capabilities?.files)) && (
          <Alert role="status">
            <CircleAlert />
            <AlertTitle>
              {tab === "videos"
                ? "Video yükleme kullanıma hazır değil"
                : "Dosya yükleme kullanıma hazır değil"}
            </AlertTitle>
            <AlertDescription>
              <p>
                Yükleme hizmetine şu anda erişilemiyor. Hizmet
                etkinleştirildikten sonra tekrar kontrol edebilirsiniz.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void reload()}
              >
                <RefreshCw /> Tekrar kontrol et
              </Button>
            </AlertDescription>
          </Alert>
        )}
      {tab === "lessons" && "lessons" in data && (
        <LessonSchedule lessons={data.lessons}>
          {view && refresh}
        </LessonSchedule>
      )}
      {tab === "assignments" && (
        <>
          <SectionHeading
            title="Bir sonraki adıma hazırlık"
            description="Ödevler, teslimler ve geri bildirimler."
          >
            {view && refresh}
            {owner && (
              <Button
                type="button"
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
                <Plus /> Ödev ver
              </Button>
            )}
          </SectionHeading>
          <ItemGroup className="gap-3">
            {!data.assignments.length && (
              <EmptyNote icon={ClipboardList} title="Henüz ödev yok">
                Verilen ödevler, teslimler ve geri bildirimler burada görünecek.
              </EmptyNote>
            )}
            {data.assignments.map((a) => {
              const sub = data.submissions.find(
                (s) => s.assignment_id === a.id,
              );
              const state: [Tone, string] =
                a.status === "CANCELLED"
                  ? ["muted", "İptal edildi"]
                  : a.status === "COMPLETED"
                    ? ["ok", "Tamamlandı"]
                    : sub
                      ? sub.status === "REVIEWED"
                        ? ["ok", "Değerlendirildi"]
                        : ["info", "Teslim edildi"]
                      : a.due_on && a.due_on < today
                        ? ["danger", "Gecikti"]
                        : ["warn", "Teslim bekleniyor"];
              const files = data.materials.filter(
                (m) => m.assignment_id === a.id,
              );
              return (
                <Item
                  variant="outline"
                  className="bg-card items-start"
                  key={a.id}
                  data-notice-target={a.id}
                >
                  <ItemMedia variant="icon">
                    <ClipboardList />
                  </ItemMedia>
                  <ItemContent className="min-w-36">
                    <ItemTitle>{a.title}</ItemTitle>
                    <ItemDescription>
                      {a.due_on
                        ? "Son teslim " + dayLabel(a.due_on + "T12:00:00+03:00")
                        : "Son teslim tarihi yok"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto">
                    <ToneBadge tone={state[0]}>{state[1]}</ToneBadge>
                  </ItemActions>
                  {(a.instructions || sub || files.length > 0) && (
                    <div className="grid basis-full gap-3 text-sm">
                      {a.instructions && (
                        <p className="leading-relaxed whitespace-pre-line">
                          {a.instructions}
                        </p>
                      )}
                      {sub && (
                        <div className="bg-muted/50 grid gap-3 rounded-md border p-3">
                          <div className="grid gap-1">
                            <span className="text-muted-foreground text-xs font-medium">
                              Öğrenci teslimi
                            </span>
                            <p className="leading-relaxed whitespace-pre-line">
                              {sub.body}
                            </p>
                          </div>
                          {sub.feedback && (
                            <div className="grid gap-1 border-t pt-3">
                              <span className="text-muted-foreground text-xs font-medium">
                                Öğretmen geri bildirimi
                              </span>
                              <p className="leading-relaxed whitespace-pre-line">
                                {sub.feedback}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {files.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {files.map((m) => (
                            <Button
                              key={m.id}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="max-w-full"
                              disabled={
                                m.status !== "READY" || m.delete_requested
                              }
                              onClick={() => void download(m)}
                            >
                              <Paperclip />
                              <span className="truncate">{m.name}</span>
                              <span className="text-muted-foreground font-normal">
                                {m.status !== "READY"
                                  ? "Yükleme bekliyor"
                                  : m.purpose === "SUBMISSION"
                                    ? "Teslim"
                                    : "Kaynak"}
                              </span>
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <ItemFooter className="flex-wrap justify-start border-t pt-4">
                    {owner && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
                        <Pencil /> Düzenle
                      </Button>
                    )}
                    {student &&
                      a.status === "OPEN" &&
                      sub?.status !== "REVIEWED" && (
                        <Button
                          type="button"
                          size="sm"
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
                          <Send /> {sub ? "Teslimi düzenle" : "Teslim et"}
                        </Button>
                      )}
                    {owner && sub && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
                        <MessageSquare /> Geri bildirim yaz
                      </Button>
                    )}
                    {(owner || (student && a.status === "OPEN")) && (
                      <FilePicker
                        busy={busy}
                        disabled={busy || !capabilities?.files}
                        onPick={(file) => void attach(a.id, file)}
                      />
                    )}
                    <span className="text-muted-foreground ml-auto text-xs">
                      PDF, JPG, PNG veya WebP · en fazla 10 MB
                    </span>
                  </ItemFooter>
                </Item>
              );
            })}
          </ItemGroup>
        </>
      )}
      {tab === "files" && (
        <>
          <SectionHeading
            title="PDF ve dosyalar"
            description="Ödev ekleri, çözümler ve öğrenciye paylaşılan ders materyalleri."
          >
            {view && refresh}
          </SectionHeading>
          {owner && (
            <div className="upload-layout">
              <Card className="gap-5">
                <CardHeader>
                  <CardTitle>Dosya yükle</CardTitle>
                  <CardDescription>
                    Bir ödeve bağlayın ya da genel ders materyali olarak
                    paylaşın.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="grid gap-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const values = new FormData(e.currentTarget),
                        file = values.get("file") as File,
                        target = String(values.get("assignmentId") || "");
                      if (file?.size)
                        await attach(
                          target === GENERAL ? null : target || null,
                          file,
                        );
                    }}
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="material-assignment">Bağlı ödev</Label>
                      <Select name="assignmentId" defaultValue={GENERAL}>
                        <SelectTrigger
                          id="material-assignment"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GENERAL}>
                            Genel ders materyali
                          </SelectItem>
                          {data.assignments.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="material-file">PDF veya görsel</Label>
                      <Input
                        id="material-file"
                        name="file"
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        required
                        disabled={busy || !capabilities?.files}
                      />
                      <p className="text-muted-foreground text-xs">
                        PDF, JPG, PNG veya WebP · en fazla 10 MB.
                      </p>
                    </div>
                    <Button
                      type="submit"
                      className="justify-self-start"
                      disabled={busy || !capabilities?.files}
                    >
                      {busy ? <Spinner /> : <Upload />}
                      {busy ? "Yükleniyor…" : "Dosya yükle"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <UploadAside kind="files" />
            </div>
          )}
          <ItemGroup className="gap-3">
            {!data.materials.length && (
              <EmptyNote icon={FileText} title="Henüz dosya yok">
                Eklenen PDF ve materyaller burada görünecek.
              </EmptyNote>
            )}
            {data.materials.map((file) => (
              <Item variant="outline" className="bg-card" key={file.id}>
                <ItemMedia variant="icon">
                  {isImageName(file.name) ? <ImageIcon /> : <FileText />}
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle className="max-w-full">
                    <span className="truncate">{file.name}</span>
                  </ItemTitle>
                  <ItemDescription>
                    {file.assignment_id
                      ? data.assignments.find(
                          (a) => a.id === file.assignment_id,
                        )?.title
                      : "Genel ders materyali"}{" "}
                    · {Math.ceil(Number(file.size_bytes) / 1024)} KB
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto gap-1">
                  {file.status === "READY" && !file.delete_requested ? (
                    <>
                      <IconAction
                        label="Önizle"
                        icon={<Eye />}
                        disabled={busy}
                        onClick={() => void openPreview(file)}
                      />
                      <IconAction
                        label="Dosyayı indir"
                        icon={<Download />}
                        onClick={() => void download(file)}
                      />
                    </>
                  ) : (
                    <ToneBadge tone="warn" className="mr-1">
                      {file.delete_requested
                        ? "Silme bekliyor"
                        : "Yükleme tamamlanmadı"}
                    </ToneBadge>
                  )}
                  {owner && (
                    <IconAction
                      danger
                      label={
                        file.delete_requested ? "Silmeyi yeniden dene" : "Sil"
                      }
                      icon={<Trash2 />}
                      disabled={busy}
                      onClick={() => void remove(file)}
                    />
                  )}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </>
      )}
      {tab === "videos" && (
        <>
          <SectionHeading
            title="Dersi yeniden keşfedin"
            description="Videoyu izleyin; sorularınızı ilgili saniyeye ekleyin."
          >
            {view && refresh}
          </SectionHeading>
          {owner && (
            <div className="upload-layout">
              <Card className="gap-5">
                <CardHeader>
                  <CardTitle>Video yükle</CardTitle>
                  <CardDescription>
                    Ders kaydını öğrencinin paneline ekleyin.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="grid gap-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!capabilities?.videos) return;
                      const f = new FormData(e.currentTarget),
                        file = f.get("file") as File,
                        lesson = String(f.get("lessonId") || "");
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
                          lesson,
                          studentId,
                        ].join(":");
                        let upload = uploadSession.current;
                        if (upload?.fingerprint !== fingerprint) {
                          const r = await backend(media + "/videos", {
                            title: f.get("title"),
                            lessonId:
                              lesson === GENERAL ? null : lesson || null,
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
                          {
                            size: file.size,
                            slice: (a, b) => file.slice(a, b),
                          },
                          { onProgress: setProgress },
                        );
                        await backend(
                          media + `/videos/${upload!.id}/refresh`,
                          {},
                        );
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
                    <div className="grid gap-2">
                      <Label htmlFor="video-lesson">Ders</Label>
                      <Select name="lessonId" defaultValue={GENERAL}>
                        <SelectTrigger id="video-lesson" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GENERAL}>
                            Genel ders videosu
                          </SelectItem>
                          {data.lessons.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.topic} · {dayLabel(l.starts_at)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                      <div className="grid gap-2">
                        <Label htmlFor="video-title">Video başlığı</Label>
                        <Input
                          id="video-title"
                          name="title"
                          required
                          maxLength={150}
                          placeholder="Örn. Denklemler · 1. ders"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="video-duration">
                          En fazla süre (dk)
                        </Label>
                        <Input
                          id="video-duration"
                          name="duration"
                          type="number"
                          min={1}
                          max={120}
                          defaultValue={60}
                          required
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="video-file">Video dosyası</Label>
                      <Input
                        id="video-file"
                        name="file"
                        type="file"
                        accept="video/*"
                        disabled={busy || !capabilities?.videos}
                        required
                      />
                      <p className="text-muted-foreground text-xs">
                        En fazla 2 GB. Yükleme kesilirse aynı dosya ile tekrar
                        deneyin.
                      </p>
                    </div>
                    {progress !== null && (
                      <Progress
                        value={Math.round(progress * 100)}
                        aria-label="Video yükleme ilerlemesi"
                      />
                    )}
                    <Button
                      type="submit"
                      className="justify-self-start"
                      disabled={busy || !capabilities?.videos}
                    >
                      {busy ? <Spinner /> : <Upload />}
                      {busy
                        ? `Yükleniyor · %${Math.round((progress || 0) * 100)}`
                        : "Videoyu yükle"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <UploadAside kind="videos" />
            </div>
          )}
          <ItemGroup className="gap-3">
            {!data.videos.length && (
              <EmptyNote icon={VideoIcon} title="Henüz video yok">
                Hazır olduğunda ders videoları burada görünecek.
              </EmptyNote>
            )}
            {data.videos.map((v) => {
              const questions = data.questions.filter(
                (q) => q.video_id === v.id,
              );
              return (
                <Item
                  variant="outline"
                  className="bg-card"
                  key={v.id}
                  data-notice-target={v.id}
                >
                  <ItemMedia variant="icon">
                    <VideoIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-36">
                    <ItemTitle>{v.title}</ItemTitle>
                    <ItemDescription>
                      {v.status === "READY"
                        ? `${Math.ceil((v.duration_seconds || 0) / 60)} dakika`
                        : "Video işleniyor"}
                      {questions.length > 0 && ` · ${questions.length} soru`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto gap-1">
                    {(v.delete_requested || v.status !== "READY") && (
                      <ToneBadge
                        className="mr-1"
                        tone={
                          v.delete_requested || v.status === "FAILED"
                            ? "danger"
                            : "warn"
                        }
                      >
                        {v.delete_requested
                          ? "Silme bekliyor"
                          : v.status === "FAILED"
                            ? "Yüklenemedi"
                            : "Hazırlanıyor"}
                      </ToneBadge>
                    )}
                    {v.status === "READY" && !v.delete_requested && (
                      <IconAction
                        label="Videoyu aç"
                        icon={<Play />}
                        onClick={() => setActiveVideo(v)}
                      />
                    )}
                    {owner && (
                      <>
                        <IconAction
                          label="Durumu yenile"
                          icon={<RefreshCw />}
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
                          icon={<Trash2 />}
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
                  </ItemActions>
                  {questions.length > 0 && (
                    <div className="grid basis-full gap-3 border-t pt-4">
                      {questions.map((q) => (
                        <div className="grid gap-2 text-sm" key={q.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="tabular-nums">
                              {Math.floor(q.at_seconds / 60)}:
                              {String(q.at_seconds % 60).padStart(2, "0")}
                            </Badge>
                            <span className="font-medium">Öğrenci sorusu</span>
                            {q.resolved && (
                              <ToneBadge tone="ok">Yanıtlandı</ToneBadge>
                            )}
                          </div>
                          <p className="leading-relaxed">{q.body}</p>
                          {q.answer && (
                            <p className="bg-muted/50 rounded-md border p-3 leading-relaxed">
                              {q.answer}
                            </p>
                          )}
                          {owner && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="justify-self-start"
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
                              <MessageSquare />
                              {q.answer ? "Yanıtı düzenle" : "Yanıtla"}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Item>
              );
            })}
          </ItemGroup>
        </>
      )}
      {tab === "notes" && (
        <>
          <SectionHeading
            title="Gelişim günlüğü"
            description="Paylaşılan notlar ve öğretmen onaylı haftalık özetler."
          >
            {view && refresh}
            {owner && (
              <>
                <Button
                  type="button"
                  variant="outline"
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
                  <Sparkles /> Özet taslağı hazırla
                </Button>
                <Button
                  type="button"
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
                  <Plus /> Not paylaş
                </Button>
              </>
            )}
          </SectionHeading>
          <ItemGroup className="gap-3">
            {!data.notes.length && !data.summaries.length && (
              <EmptyNote icon={NotebookPen} title="Henüz paylaşım yok">
                Paylaşılan notlar ve haftalık özetler burada görünecek.
              </EmptyNote>
            )}
            {data.summaries.map((s) => (
              <Item
                variant="outline"
                className="bg-card items-start"
                key={s.id}
                data-notice-target={s.id}
              >
                <ItemMedia variant="icon">
                  <Sparkles />
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle>
                    {dayLabel(s.week_on + "T12:00:00+03:00")} haftası
                  </ItemTitle>
                  <ItemDescription>Haftalık özet</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone={s.status === "DRAFT" ? "warn" : "ok"}>
                    {s.status === "DRAFT" ? "Taslak" : "Paylaşıldı"}
                  </ToneBadge>
                </ItemActions>
                <p className="basis-full text-sm leading-relaxed whitespace-pre-line">
                  {s.body}
                </p>
                {owner && (
                  <ItemFooter className="justify-start border-t pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
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
                      <Pencil />
                      {s.status === "DRAFT"
                        ? "Düzenle ve onayla"
                        : "Özeti güncelle"}
                    </Button>
                  </ItemFooter>
                )}
              </Item>
            ))}
            {data.notes.map((n) => (
              <Item
                variant="outline"
                className="bg-card items-start"
                key={n.id}
              >
                <ItemMedia variant="icon">
                  <NotebookPen />
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle>Öğretmen notu</ItemTitle>
                  <ItemDescription>{dayLabel(n.created_at)}</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone="muted">
                    {n.audience === "BOTH" ? "Öğrenci ve veli" : "Öğrenci"}
                  </ToneBadge>
                </ItemActions>
                <p className="basis-full text-sm leading-relaxed whitespace-pre-line">
                  {n.body}
                </p>
              </Item>
            ))}
          </ItemGroup>
        </>
      )}
      {tab === "payments" && "packages" in data && (
        <>
          <SectionHeading
            title="Paket ve ödemeler"
            description="Ders hakları, açık bakiye ve kayıtlı ödemeler."
          >
            {view && refresh}
          </SectionHeading>
          <ItemGroup className="gap-3">
            <Card className="gap-1 py-5">
              <CardHeader className="px-5">
                <CardDescription>Açık bakiye</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {money(
                    data.packages.reduce(
                      (n, p) => n + Number(p.price_minor),
                      0,
                    ) -
                      data.payments
                        .filter((p) => !p.voided_at)
                        .reduce((n, p) => n + Number(p.amount_minor), 0),
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground px-5 text-sm">
                Öğretmeninizin kaydettiği paket ve tahsilatlara göre.
              </CardContent>
            </Card>
            {data.packages.map((p) => (
              <Item variant="outline" className="bg-card" key={p.id}>
                <ItemMedia variant="icon">
                  <Package />
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle>{p.name}</ItemTitle>
                  <ItemDescription>
                    {p.remaining} / {p.granted} ders hakkı ·{" "}
                    {money(p.price_minor)}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
            {data.payments.map((p) => (
              <Item variant="outline" className="bg-card" key={p.id}>
                <ItemMedia variant="icon">
                  <Wallet />
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle className="tabular-nums">
                    {money(p.amount_minor)}
                  </ItemTitle>
                  <ItemDescription>
                    {dayLabel(p.received_on + "T12:00:00+03:00")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone={p.voided_at ? "muted" : "ok"}>
                    {p.voided_at ? "İptal edildi" : "Tahsil edildi"}
                  </ToneBadge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </>
      )}
      {tab === "access" && owner && (
        <>
          <SectionHeading
            title="Öğrenci ve veli erişimi"
            description="Davet yalnızca belirtilen, doğrulanmış e-posta hesabıyla kabul edilir."
          >
            <Button type="button" onClick={() => setForm(inviteSpec())}>
              <UserPlus /> Davet oluştur
            </Button>
          </SectionHeading>
          {invite && (
            <Card className="gap-4 py-5">
              <CardContent className="grid gap-4 px-5">
                <FormSuccess>
                  {invite.emailed
                    ? `Davet ${invite.email} adresine e-posta ile gönderildi. Ulaşmadıysa aşağıdaki bağlantıyı kendiniz iletebilirsiniz.`
                    : "E-posta gönderimi kapalı; bağlantıyı aşağıdan kopyalayıp iletin."}
                </FormSuccess>
                <div className="grid gap-2">
                  <Label htmlFor="invite-url">
                    Davet bağlantısı · 7 gün geçerli
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-url"
                      readOnly
                      value={invite.url}
                      className="text-ellipsis"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(invite.url);
                        } catch {
                          setError("Bağlantıyı seçip kopyalayın.");
                        }
                      }}
                    >
                      <Copy /> Kopyala
                    </Button>
                  </div>
                </div>
                {whatsappNumber(studentPhone || "") && (
                  <Button
                    variant="outline"
                    className="justify-self-start"
                    asChild
                  >
                    <a
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
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
          <ItemGroup className="gap-3">
            {access && !access.data?.length && !access.invitations?.length && (
              <EmptyNote icon={UserPlus} title="Henüz davet yok">
                Öğrenci veya veliyi davet ettiğinizde burada görünür.
              </EmptyNote>
            )}
            {access?.data?.map((a: any) => (
              <Item variant="outline" className="bg-card" key={a.id}>
                <ItemMedia variant="icon">
                  <UserCheck />
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle>
                    {a.role === "STUDENT" ? "Öğrenci erişimi" : "Veli erişimi"}
                  </ItemTitle>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone={a.revokedAt ? "muted" : "ok"}>
                    {a.revokedAt ? "Kaldırıldı" : "Etkin"}
                  </ToneBadge>
                  {!a.revokedAt && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                    </Button>
                  )}
                </ItemActions>
              </Item>
            ))}
            {access?.invitations?.map((a: any) => {
              const expired = a.expiresAt < new Date().toISOString();
              return (
                <Item variant="outline" className="bg-card" key={a.id}>
                  <ItemMedia variant="icon">
                    <Mail />
                  </ItemMedia>
                  <ItemContent className="min-w-36">
                    <ItemTitle className="max-w-full">
                      <span className="truncate">{a.email}</span>
                    </ItemTitle>
                    <ItemDescription>
                      {a.role === "GUARDIAN" ? "Veli daveti" : "Öğrenci daveti"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto">
                    <ToneBadge
                      tone={
                        a.acceptedAt
                          ? "ok"
                          : a.revokedAt || expired
                            ? "muted"
                            : "warn"
                      }
                    >
                      {a.acceptedAt
                        ? "Kabul edildi"
                        : a.revokedAt
                          ? "İptal edildi"
                          : expired
                            ? "Süresi doldu"
                            : "Davet bekliyor"}
                    </ToneBadge>
                    {!a.acceptedAt && !a.revokedAt && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
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
        <DialogContent className="sm:max-w-[900px]">
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
        <DialogContent className="sm:max-w-[850px]">
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
/** Seçimsiz "genel" seçenek. Radix Select boş değeri "seçim yok" sayıp
 *  tetikleyiciyi boş bıraktığı için ayrı bir değerle temsil ediliyor. */
const GENERAL = "general";

function SectionHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="grid min-w-0 gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}

type PortalLesson = PortalData["lessons"][number];

/** Öğrenci/veli ders planı. Önce yaklaşan dersler gelir, en yakını üstte ve
 *  fosforlu; sonra geçmiş dersler, en yenisi üstte. */
function LessonSchedule({
  lessons,
  children,
}: {
  lessons: PortalLesson[];
  /** Başlığın yanındaki düğmeler (yenile). */
  children?: React.ReactNode;
}) {
  // Süren dersi ve "bugün/yarın" etiketini güncel tutmak için dakikada bir
  // ilerleyen saat; öğretmen günlüğündeki ders satırlarıyla aynı yaklaşım.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const upcoming = lessons
    .filter((l) => l.status === "SCHEDULED" && Date.parse(l.ends_at) > clock)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past = lessons
    .filter((l) => !upcoming.includes(l))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  const today = dateKey(new Date(clock)),
    tomorrow = addDays(today, 1);
  const day = (iso: string) => {
    const key = dateKey(iso);
    return key === today
      ? "Bugün"
      : key === tomorrow
        ? "Yarın"
        : dayLabel(iso, { weekday: "long" });
  };
  if (!lessons.length)
    return (
      <>
        <SectionHeading
          title="Ders planı"
          description="Planlanan ve tamamlanan dersler burada listelenir."
        >
          {children}
        </SectionHeading>
        <EmptyNote icon={CalendarDays} title="Henüz ders yok">
          Planlanan dersler burada görünecek.
        </EmptyNote>
      </>
    );
  return (
    <>
      <SectionHeading
        title="Yaklaşan dersler"
        description="En yakın ders en üstte."
      >
        {children}
      </SectionHeading>
      <ItemGroup className="gap-3">
        {upcoming.length ? (
          upcoming.map((l, i) => (
            <LessonItem
              key={l.id}
              lesson={l}
              day={day(l.starts_at)}
              chip={
                i > 0
                  ? undefined
                  : Date.parse(l.starts_at) <= clock
                    ? "Şimdi"
                    : "Sıradaki"
              }
            />
          ))
        ) : (
          <EmptyNote icon={CalendarDays} title="Yaklaşan ders yok">
            Yeni bir ders planlandığında burada görünecek.
          </EmptyNote>
        )}
      </ItemGroup>
      {past.length > 0 && (
        <>
          <SectionHeading
            title="Geçmiş dersler"
            description="Tamamlanan ve iptal edilen dersler, en yenisi üstte."
          />
          <ItemGroup className="gap-3">
            {past.map((l) => (
              <LessonItem key={l.id} lesson={l} day={day(l.starts_at)} status />
            ))}
          </ItemGroup>
        </>
      )}
    </>
  );
}

function LessonItem({
  lesson: l,
  day,
  chip,
  status = false,
}: {
  lesson: PortalLesson;
  day: string;
  /** Sıradaki ya da süren ders: kart fosforlu, yanında bu etiket. */
  chip?: string;
  /** Geçmiş derslerde durum rozeti; yaklaşanların hepsi zaten planlı. */
  status?: boolean;
}) {
  return (
    <Item
      variant="outline"
      className={chip ? "border-(--marker) bg-(--marker-soft)" : "bg-card"}
    >
      <ItemMedia
        variant="icon"
        className={
          chip ? "border-(--marker) bg-(--marker) text-(--marker-ink)" : ""
        }
      >
        <CalendarDays />
      </ItemMedia>
      <ItemContent className="min-w-36">
        <ItemTitle>{l.topic}</ItemTitle>
        {/* Ayraç önceki parçaya bağlı kalsın; dar ekranda satır "·" ile
            başlamasın. */}
        <ItemDescription>
          {day}
          {"\u00a0· "}
          {timeLabel(l.starts_at)}–{timeLabel(l.ends_at)}
          {"\u00a0· "}
          {l.location || "Konum belirtilmedi"}
        </ItemDescription>
      </ItemContent>
      {(chip || status) && (
        <ItemActions className="ml-auto">
          {chip && <span className="now-chip">{chip}</span>}
          {status && (
            <ToneBadge
              tone={
                l.status === "SCHEDULED"
                  ? "info"
                  : l.status === "COMPLETED"
                    ? "ok"
                    : "muted"
              }
            >
              {l.status === "SCHEDULED"
                ? "Planlandı"
                : l.status === "COMPLETED"
                  ? "Tamamlandı"
                  : "İptal edildi"}
            </ToneBadge>
          )}
        </ItemActions>
      )}
    </Item>
  );
}

function EmptyNote({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Empty className="border md:p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Ödev satırındaki "Dosya ekle": gizli dosya girdisini açan sıradan bir
 *  shadcn düğmesi; seçilen dosya hemen yüklenir. */
function FilePicker({
  busy,
  disabled,
  onPick,
}: {
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {busy ? <Spinner /> : <Paperclip />}
        {busy ? "Yükleniyor…" : "Dosya ekle"}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </>
  );
}

// Liste satırlarındaki eylemler metin yerine ikon düğmesi: satır daralıyor,
// adlar tooltip ve aria-label olarak kalıyor (yalnızca ikon erişilebilirliği
// kaybettirmesin diye).
function IconAction({
  label,
  icon,
  onClick,
  disabled,
  danger,
  outline,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  outline?: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={outline ? "icon" : "icon-sm"}
            variant={outline ? "outline" : "ghost"}
            className={
              danger
                ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                : outline
                  ? ""
                  : "text-muted-foreground"
            }
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

// Yükleme formu okunabilir genişlikte kalınca sağda geniş bir boşluk kalıyordu.
// Oraya dekor yerine işin kendisine ait bilgi konuyor: akışın adımları, kabul
// edilen dosya kuralları ve öğrencinin sonunda ne göreceği.
function UploadAside({ kind }: { kind: "files" | "videos" }) {
  const video = kind === "videos";
  const steps = video
    ? [
        "Videonun ait olduğu dersi seçin.",
        "Dosyayı ekleyip süreyi doğrulayın.",
        "Yükleme bitince öğrenci izleyebilir.",
      ]
    : [
        "Ödevi ya da genel materyali seçin.",
        "PDF veya görseli ekleyin.",
        "Dosya öğrencinin paneline düşer.",
      ];
  const rules = video
    ? ["MP4 veya MOV", "En fazla 2 GB", "En fazla 120 dakika"]
    : ["PDF, JPG, PNG, WebP", "En fazla 10 MB", "Ödeve ya da derse bağlı"];
  return (
    <Card className="bg-muted/40 gap-5 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {video ? (
            <VideoIcon className="text-muted-foreground size-4" />
          ) : (
            <FileText className="text-muted-foreground size-4" />
          )}
          {video ? "Video nasıl yayına girer" : "Dosya nasıl paylaşılır"}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <ol className="grid gap-3">
          {steps.map((t, i) => (
            <li className="flex items-start gap-3" key={t}>
              <span className="bg-background flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums">
                {i + 1}
              </span>
              <span className="text-muted-foreground pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
        <Separator />
        <div className="grid gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            Kabul edilen
          </p>
          <div className="flex flex-wrap gap-1.5">
            {rules.map((r) => (
              <Badge variant="outline" className="bg-background" key={r}>
                {r}
              </Badge>
            ))}
          </div>
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {video
            ? "Yükleme sürerken sayfadan ayrılmayın; bağlantı koparsa aynı dosyayla kaldığı yerden denenir."
            : "Öğrenciler yalnızca kendilerine bağlanmış dosyaları görür."}
        </p>
      </CardContent>
    </Card>
  );
}

/** Bildirim başlıkları sunucuda sabit metinler; simge başlıktan seçiliyor. */
function noticeIcon(title: string) {
  const t = title.toLocaleLowerCase("tr");
  if (t.includes("soru")) return <MessageSquare />;
  if (t.includes("video")) return <VideoIcon />;
  if (t.includes("özet")) return <Sparkles />;
  if (t.includes("ödev")) return <ClipboardList />;
  return <Bell />;
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

function UsageMeter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used.toLocaleString("tr-TR")} / {limit.toLocaleString("tr-TR")}
          {unit ? " " + unit : ""}
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={label}
        className={
          percent >= 90
            ? "bg-destructive/15 *:data-[slot=progress-indicator]:bg-destructive"
            : undefined
        }
      />
    </div>
  );
}

export function AccountExtras({
  workspaceId,
  onOpen,
}: {
  workspaceId?: string;
  /** Bildirime tıklanınca ilgili sayfayı açar. */
  onOpen?: (target: NoticeTarget) => void;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("inbox"),
    [inbox, setInbox] = useState<Notice[]>([]),
    [limits, setLimits] = useState<any>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    // Göreli zamanlar ("5 dk önce") liste yüklendiği andaki saate göre yazılır.
    [now, setNow] = useState(0);
  const unread = inbox.filter((n) => !n.readAt).length;
  // Zildeki sayaç için liste sayfa açılışında bir kez sessizce alınır; hata
  // olursa zil sayaçsız kalır, panel açıldığında yeniden denenir.
  useEffect(() => {
    let alive = true;
    backend("/inbox")
      .then((r) => {
        if (!alive) return;
        setInbox(r.data);
        setNow(Date.now());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // İki istek paralel çalışır; panel son düzeni tutan bir iskeletle açılır.
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
      setNow(Date.now());
      if (limitsResult) setLimits(limitsResult.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function markRead(ids: string[]) {
    try {
      await Promise.all(ids.map((id) => backend(`/inbox/${id}/read`, {})));
      const at = new Date().toISOString();
      setInbox((old) =>
        old.map((n) => (ids.includes(n.id) ? { ...n, readAt: at } : n)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function openNotice(n: Notice, target: NoticeTarget) {
    if (!n.readAt) void markRead([n.id]);
    setOpen(false);
    onOpen?.(target);
  }
  const list = loading ? (
    <div className="grid gap-4 p-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="flex gap-3" key={i}>
          <Skeleton className="size-8 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  ) : inbox.length ? (
    <ul className="divide-y">
      {inbox.map((n) => {
        const target = onOpen ? noticeTarget(n) : null;
        return (
          <li
            key={n.id}
            className={
              "relative flex gap-3 px-4 py-3.5 " +
              (n.readAt ? "" : "bg-primary/[0.04] ") +
              (target ? "hover:bg-muted/60 transition-colors" : "")
            }
          >
            <span
              aria-hidden="true"
              className={
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4 " +
                (n.readAt
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/10 text-primary")
              }
            >
              {noticeIcon(n.title)}
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex items-start justify-between gap-3">
                <p
                  className={
                    "text-sm leading-snug " +
                    (n.readAt ? "text-foreground/80" : "font-medium")
                  }
                >
                  {target ? (
                    // Başlık düğmesi tüm satırı kaplar; "Okundu say" üstte kalır.
                    <button
                      type="button"
                      className="text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
                      onClick={() => openNotice(n, target)}
                    >
                      {n.title}
                    </button>
                  ) : (
                    n.title
                  )}
                </p>
                {!n.readAt && (
                  <span
                    className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                    aria-label="Okunmadı"
                  />
                )}
              </div>
              <p className="text-muted-foreground text-sm leading-snug">
                {n.body}
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-muted-foreground text-xs">
                  {ago(n.createdAt, now)}
                </span>
                {!n.readAt && (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="relative h-auto p-0 text-xs"
                    onClick={() => void markRead([n.id])}
                  >
                    Okundu say
                  </Button>
                )}
              </div>
            </div>
            {target && (
              <ChevronRight
                aria-hidden="true"
                className="text-muted-foreground mt-1.5 size-4 shrink-0"
              />
            )}
          </li>
        );
      })}
    </ul>
  ) : (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BellOff />
        </EmptyMedia>
        <EmptyTitle className="text-base">Yeni bildirim yok</EmptyTitle>
        <EmptyDescription>
          Teslimler, yeni videolar ve geri bildirimler burada görünecek.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
  const usage = (
    <div className="grid gap-4 p-4">
      {loading || !limits ? (
        <Card className="gap-4 py-5" aria-hidden="true">
          <CardContent className="grid gap-4 px-5">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-5 py-5">
          <CardHeader className="px-5">
            <CardTitle>Çalışma alanı kullanımı</CardTitle>
            <CardDescription>
              Plan sınırlarına göre kullanımınız.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">
                {limits.limits.plan === "PRO" ? "Pro plan" : "Pilot plan"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 px-5">
            <UsageMeter
              label="Aktif öğrenci"
              used={Number(limits.used.students)}
              limit={Number(limits.limits.studentLimit)}
            />
            <UsageMeter
              label="Video"
              used={Math.ceil(Number(limits.used.videoSeconds) / 60)}
              limit={Math.floor(Number(limits.limits.videoSeconds) / 60)}
              unit="dk"
            />
            <UsageMeter
              label="Dosya alanı"
              used={Math.round(Number(limits.used.materialBytes) / 1024 ** 2)}
              limit={Math.floor(
                Number(limits.limits.materialBytes) / 1024 ** 2,
              )}
              unit="MB"
            />
          </CardContent>
        </Card>
      )}
      {!loading && workspaceId && (
        <Subscription workspaceId={workspaceId} onUpdate={() => void show()} />
      )}
    </div>
  );
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative"
              onClick={() => void show()}
              aria-label={
                "Bildirimler" + (unread ? `, ${unread} okunmamış` : "")
              }
            >
              <Bell />
              {unread > 0 && (
                <span className="bg-(--marker) text-(--marker-ink) ring-background absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {workspaceId ? "Bildirimler ve kullanım" : "Bildirimler"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Bildirimler</SheetTitle>
            <SheetDescription>
              {unread
                ? `${unread} okunmamış bildiriminiz var.`
                : "Hepsini okudunuz."}
            </SheetDescription>
          </SheetHeader>
          {error && (
            <div className="px-4 pt-4">
              <FormError>{error}</FormError>
            </div>
          )}
          {workspaceId ? (
            <Tabs
              value={tab}
              onValueChange={setTab}
              className="min-h-0 flex-1 gap-0"
            >
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <TabsList>
                  <TabsTrigger value="inbox">
                    Gelen kutusu
                    {unread > 0 && (
                      <Badge className="h-5 min-w-5 px-1.5 tabular-nums">
                        {unread}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="usage">Kullanım ve plan</TabsTrigger>
                </TabsList>
                {tab === "inbox" && unread > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void markRead(
                        inbox.filter((n) => !n.readAt).map((n) => n.id),
                      )
                    }
                  >
                    <CheckCheck />
                    <span className="max-sm:sr-only">Tümü okundu</span>
                  </Button>
                )}
              </div>
              <TabsContent value="inbox" className="min-h-0 overflow-y-auto">
                {list}
              </TabsContent>
              <TabsContent value="usage" className="min-h-0 overflow-y-auto">
                {usage}
              </TabsContent>
            </Tabs>
          ) : (
            <>
              {unread > 0 && (
                <div className="flex justify-end border-b px-4 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void markRead(
                        inbox.filter((n) => !n.readAt).map((n) => n.id),
                      )
                    }
                  >
                    <CheckCheck /> Tümü okundu
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
