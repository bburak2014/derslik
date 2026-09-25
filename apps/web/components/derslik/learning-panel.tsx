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
  canEditSubmission,
  noticeTarget,
  noticeText,
  intlLocale,
  t,
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
          <DialogDescription>{t("learn.formHint")}</DialogDescription>
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
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? t("learn.savingEllipsis") : t("common.save")}
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
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
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
      setError(t("learn.uploadUnavailable"));
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
          throw new Error(t("learn.uploadFailed"));
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
      title: t("learn.inviteTitle"),
      fields: [
        { name: "email", label: t("learn.inviteEmail"), type: "email" },
        {
          name: "role",
          label: t("learn.accountType"),
          value: "STUDENT",
          options: [
            { value: "STUDENT", label: t("roles.STUDENT") },
            { value: "GUARDIAN", label: t("roles.GUARDIAN") },
          ],
        },
        {
          name: "payments",
          label: t("learn.paymentInfo"),
          value: "no",
          options: [
            { value: "no", label: t("learn.paymentHidden") },
            { value: "yes", label: t("learn.paymentVisible") },
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
      title: t("learn.deleteFileTitle"),
      description: t("learn.deleteFileBody", { name: file.name }),
      action: t("common.delete"),
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
              title: t("nav.lessons"),
              permission: "lessons",
            },
          ]),
      {
        id: "assignments",
        title: t("nav.assignments"),
        permission: "assignments",
      },
      { id: "files", title: t("nav.files"), permission: "assignments" },
      { id: "videos", title: t("learn.tabVideos"), permission: "videos" },
      { id: "notes", title: t("nav.notes"), permission: "notes" },
      ...(owner
        ? [
            {
              id: "access" as const,
              title: t("learn.tabAccess"),
              permission: "lessons",
            },
          ]
        : [
            {
              id: "payments" as const,
              title: t("nav.balance"),
              permission: "payments",
            },
          ]),
    ];
    return all.filter((x) => allowed.includes(x.permission));
  }, [owner, permissionKey]);
  useEffect(() => {
    if (tabs.length && !tabs.some((x) => x.id === tab)) setTab(tabs[0].id);
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
      label={t("learn.refresh")}
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
              aria-label={t("learn.studentContent")}
            >
              {tabs.map((x) => (
                <TabsTrigger key={x.id} value={x.id} className="flex-none">
                  {x.title}
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
                ? t("learn.videoUploadNotReady")
                : t("learn.fileUploadNotReady")}
            </AlertTitle>
            <AlertDescription>
              <p>{t("learn.uploadServiceDown")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void reload()}
              >
                <RefreshCw /> {t("learn.checkAgain")}
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
            title={t("learn.assignmentsTitle")}
            description={t("learn.assignmentsText")}
          >
            {view && refresh}
            {owner && (
              <Button
                type="button"
                onClick={() =>
                  simple(
                    t("notice.assignmentNew"),
                    [
                      { name: "title", label: t("learn.title") },
                      {
                        name: "instructions",
                        label: t("learn.instructions"),
                        type: "textarea",
                        required: false,
                      },
                      {
                        name: "dueOn",
                        label: t("learn.dueOn"),
                        required: false,
                        type: "date",
                        value: dateKey(),
                      },
                    ],
                    (v) => ({ action: "assignment.create", ...v }),
                  )
                }
              >
                <Plus /> {t("learn.assign")}
              </Button>
            )}
          </SectionHeading>
          <ItemGroup className="gap-3">
            {!data.assignments.length && (
              <EmptyNote icon={ClipboardList} title={t("learn.noAssignments")}>
                {t("learn.noAssignmentsHint")}
              </EmptyNote>
            )}
            {data.assignments.map((a) => {
              const sub = data.submissions.find(
                (s) => s.assignment_id === a.id,
              );
              const state: [Tone, string] =
                a.status === "CANCELLED"
                  ? ["muted", t("lesson.cancelled")]
                  : a.status === "COMPLETED"
                    ? ["ok", t("lesson.completed")]
                    : sub
                      ? sub.status === "REVIEWED"
                        ? ["ok", t("learn.reviewed")]
                        : ["info", t("learn.submitted")]
                      : a.due_on && a.due_on < today
                        ? ["danger", t("learn.late")]
                        : ["warn", t("learn.awaiting")];
              const files = data.materials.filter(
                (m) => m.assignment_id === a.id,
              );
              const editable = canEditSubmission(a, !!sub, today);
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
                        ? t("learn.dueDate", {
                            date: dayLabel(a.due_on + "T12:00:00+03:00"),
                          })
                        : t("learn.noDueDate")}
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
                              {t("learn.studentSubmission")}
                            </span>
                            <p className="leading-relaxed whitespace-pre-line">
                              {sub.body}
                            </p>
                          </div>
                          {sub.feedback && (
                            <div className="grid gap-1 border-t pt-3">
                              <span className="text-muted-foreground text-xs font-medium">
                                {t("learn.teacherFeedback")}
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
                                  ? t("learn.uploadPending")
                                  : m.purpose === "SUBMISSION"
                                    ? t("learn.fileSubmission")
                                    : t("learn.fileResource")}
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
                            t("learn.editAssignment"),
                            [
                              {
                                name: "title",
                                label: t("learn.title"),
                                value: a.title,
                              },
                              {
                                name: "instructions",
                                label: t("learn.instructions"),
                                type: "textarea",
                                value: a.instructions,
                                required: false,
                              },
                              {
                                name: "dueOn",
                                label: t("learn.dueOn"),
                                type: "date",
                                value: a.due_on || "",
                                required: false,
                              },
                              {
                                name: "status",
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
                        <Pencil /> {t("common.edit")}
                      </Button>
                    )}
                    {student && editable && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          simple(
                            sub
                              ? t("learn.editSubmission")
                              : t("learn.submitTitle"),
                            [
                              {
                                name: "body",
                                label: t("learn.yourAnswer"),
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
                        <Send />{" "}
                        {sub ? t("learn.editSubmission") : t("learn.submit")}
                      </Button>
                    )}
                    {owner && sub && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          simple(
                            t("learn.reviewTitle"),
                            [
                              {
                                name: "feedback",
                                label: t("learn.feedback"),
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
                        <MessageSquare /> {t("learn.writeFeedback")}
                      </Button>
                    )}
                    {student &&
                      sub &&
                      a.status === "OPEN" &&
                      (editable ? (
                        a.due_on && (
                          <span className="text-muted-foreground text-xs">
                            {t("learn.editableUntil", {
                              date: dayLabel(a.due_on + "T12:00:00+03:00"),
                            })}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {t("learn.locked")}
                        </span>
                      ))}
                    {(owner || (student && editable)) && (
                      <FilePicker
                        busy={busy}
                        disabled={busy || !capabilities?.files}
                        onPick={(file) => void attach(a.id, file)}
                      />
                    )}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {t("learn.fileLimits")}
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
            title={t("nav.files")}
            description={t("learn.filesText")}
          >
            {view && refresh}
          </SectionHeading>
          {owner && (
            <div className="upload-layout">
              <Card className="gap-5">
                <CardHeader>
                  <CardTitle>{t("learn.uploadFile")}</CardTitle>
                  <CardDescription>{t("learn.uploadFileHint")}</CardDescription>
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
                      <Label htmlFor="material-assignment">
                        {t("learn.linkedAssignment")}
                      </Label>
                      <Select name="assignmentId" defaultValue={GENERAL}>
                        <SelectTrigger
                          id="material-assignment"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GENERAL}>
                            {t("learn.generalMaterial")}
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
                      <Label htmlFor="material-file">
                        {t("learn.pdfOrImage")}
                      </Label>
                      <Input
                        id="material-file"
                        name="file"
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        required
                        disabled={busy || !capabilities?.files}
                      />
                      <p className="text-muted-foreground text-xs">
                        {t("learn.fileLimits")}
                      </p>
                    </div>
                    <Button
                      type="submit"
                      className="justify-self-start"
                      disabled={busy || !capabilities?.files}
                    >
                      {busy ? <Spinner /> : <Upload />}
                      {busy ? t("learn.uploading") : t("learn.uploadFile")}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <UploadAside kind="files" />
            </div>
          )}
          <ItemGroup className="gap-3">
            {!data.materials.length && (
              <EmptyNote icon={FileText} title={t("learn.noFiles")}>
                {t("learn.noFilesHint")}
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
                      : t("learn.generalMaterial")}{" "}
                    · {Math.ceil(Number(file.size_bytes) / 1024)} KB
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto gap-1">
                  {file.status === "READY" && !file.delete_requested ? (
                    <>
                      <IconAction
                        label={t("learn.preview")}
                        icon={<Eye />}
                        disabled={busy}
                        onClick={() => void openPreview(file)}
                      />
                      <IconAction
                        label={t("learn.download")}
                        icon={<Download />}
                        onClick={() => void download(file)}
                      />
                    </>
                  ) : (
                    <ToneBadge tone="warn" className="mr-1">
                      {file.delete_requested
                        ? t("learn.deletePending")
                        : t("learn.uploadIncomplete")}
                    </ToneBadge>
                  )}
                  {owner && (
                    <IconAction
                      danger
                      label={
                        file.delete_requested
                          ? t("learn.retryDelete")
                          : t("common.delete")
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
            title={t("learn.videosTitle")}
            description={t("learn.videosText")}
          >
            {view && refresh}
          </SectionHeading>
          {owner && (
            <div className="upload-layout">
              <Card className="gap-5">
                <CardHeader>
                  <CardTitle>{t("learn.uploadVideo")}</CardTitle>
                  <CardDescription>
                    {t("learn.uploadVideoHint")}
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
                      <Label htmlFor="video-lesson">{t("learn.lesson")}</Label>
                      <Select name="lessonId" defaultValue={GENERAL}>
                        <SelectTrigger id="video-lesson" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GENERAL}>
                            {t("learn.generalVideo")}
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
                        <Label htmlFor="video-title">
                          {t("learn.videoTitle")}
                        </Label>
                        <Input
                          id="video-title"
                          name="title"
                          required
                          maxLength={150}
                          placeholder={t("learn.videoTitlePlaceholder")}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="video-duration">
                          {t("learn.maxDuration")}
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
                      <Label htmlFor="video-file">{t("learn.videoFile")}</Label>
                      <Input
                        id="video-file"
                        name="file"
                        type="file"
                        accept="video/*"
                        disabled={busy || !capabilities?.videos}
                        required
                      />
                      <p className="text-muted-foreground text-xs">
                        {t("learn.videoLimits")}
                      </p>
                    </div>
                    {progress !== null && (
                      <Progress
                        value={Math.round(progress * 100)}
                        aria-label={t("learn.uploadProgress")}
                      />
                    )}
                    <Button
                      type="submit"
                      className="justify-self-start"
                      disabled={busy || !capabilities?.videos}
                    >
                      {busy ? <Spinner /> : <Upload />}
                      {busy
                        ? t("learn.uploadingPercent", {
                            percent: Math.round((progress || 0) * 100),
                          })
                        : t("learn.uploadVideoSubmit")}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <UploadAside kind="videos" />
            </div>
          )}
          <ItemGroup className="gap-3">
            {!data.videos.length && (
              <EmptyNote icon={VideoIcon} title={t("learn.noVideos")}>
                {t("learn.noVideosHint")}
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
                        ? t("learn.minutes", {
                            count: Math.ceil((v.duration_seconds || 0) / 60),
                          })
                        : t("learn.videoProcessing")}
                      {questions.length > 0 &&
                        " · " +
                          t("learn.questionCount", { count: questions.length })}
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
                          ? t("learn.deletePending")
                          : v.status === "FAILED"
                            ? t("learn.videoFailed")
                            : t("learn.videoPreparing")}
                      </ToneBadge>
                    )}
                    {v.status === "READY" && !v.delete_requested && (
                      <IconAction
                        label={t("learn.openVideo")}
                        icon={<Play />}
                        onClick={() => setActiveVideo(v)}
                      />
                    )}
                    {owner && (
                      <>
                        <IconAction
                          label={t("sub.refresh")}
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
                          label={t("common.delete")}
                          icon={<Trash2 />}
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              title: t("learn.deleteVideoTitle"),
                              description: t("learn.deleteVideoBody"),
                              action: t("common.delete"),
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
                            <span className="font-medium">
                              {t("learn.studentQuestion")}
                            </span>
                            {q.resolved && (
                              <ToneBadge tone="ok">
                                {t("learn.answered")}
                              </ToneBadge>
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
                                  t("learn.answerTitle"),
                                  [
                                    {
                                      name: "answer",
                                      label: t("learn.yourReply"),
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
                              {q.answer
                                ? t("learn.editAnswer")
                                : t("learn.reply")}
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
            title={t("learn.notesTitle")}
            description={t("learn.notesText")}
          >
            {view && refresh}
            {owner && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    simple(
                      t("learn.summaryTitle"),
                      [
                        {
                          name: "weekOn",
                          label: t("learn.weekStart"),
                          type: "date",
                          value: dateKey(),
                        },
                      ],
                      (v) => ({ action: "summary.draft", weekOn: v.weekOn }),
                    )
                  }
                >
                  <Sparkles /> {t("learn.draftSummary")}
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    simple(
                      t("learn.shareNote"),
                      [
                        {
                          name: "body",
                          label: t("learn.yourNote"),
                          type: "textarea",
                        },
                        {
                          name: "audience",
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
                  <Plus /> {t("learn.shareNote")}
                </Button>
              </>
            )}
          </SectionHeading>
          <ItemGroup className="gap-3">
            {!data.notes.length && !data.summaries.length && (
              <EmptyNote icon={NotebookPen} title={t("learn.noNotes")}>
                {t("learn.noNotesHint")}
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
                    {t("learn.weekOf", {
                      date: dayLabel(s.week_on + "T12:00:00+03:00"),
                    })}
                  </ItemTitle>
                  <ItemDescription>{t("learn.weeklySummary")}</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone={s.status === "DRAFT" ? "warn" : "ok"}>
                    {s.status === "DRAFT"
                      ? t("learn.draft")
                      : t("learn.shared")}
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
                          t("learn.reviewSummary"),
                          [
                            {
                              name: "body",
                              label: t("learn.summary"),
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
                        ? t("learn.editApprove")
                        : t("learn.updateSummary")}
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
                  <ItemTitle>{t("learn.teacherNote")}</ItemTitle>
                  <ItemDescription>{dayLabel(n.created_at)}</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone="muted">
                    {n.audience === "BOTH"
                      ? t("learn.audienceBoth")
                      : t("roles.STUDENT")}
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
            title={t("learn.paymentsTitle")}
            description={t("portal.balanceGuardian")}
          >
            {view && refresh}
          </SectionHeading>
          <ItemGroup className="gap-3">
            <Card className="gap-1 py-5">
              <CardHeader className="px-5">
                <CardDescription>{t("students.openBalance")}</CardDescription>
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
                {t("learn.balanceBasis")}
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
                    {t("learn.creditsOf", {
                      remaining: p.remaining,
                      count: p.granted,
                    })}{" "}
                    · {money(p.price_minor)}
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
                    {p.voided_at ? t("lesson.cancelled") : t("learn.paid")}
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
            title={t("learn.accessTitle")}
            description={t("learn.accessText")}
          >
            <Button type="button" onClick={() => setForm(inviteSpec())}>
              <UserPlus /> {t("learn.createInvite")}
            </Button>
          </SectionHeading>
          {invite && (
            <Card className="gap-4 py-5">
              <CardContent className="grid gap-4 px-5">
                <FormSuccess>
                  {invite.emailed
                    ? t("learn.inviteEmailed", { email: invite.email })
                    : t("learn.inviteNoEmail")}
                </FormSuccess>
                <div className="grid gap-2">
                  <Label htmlFor="invite-url">{t("learn.inviteLink")}</Label>
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
                          setError(t("learn.copyManually"));
                        }
                      }}
                    >
                      <Copy /> {t("learn.copy")}
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
                      <WhatsappIcon /> {t("learn.sendWhatsapp")}
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
          <ItemGroup className="gap-3">
            {access && !access.data?.length && !access.invitations?.length && (
              <EmptyNote icon={UserPlus} title={t("learn.noInvites")}>
                {t("learn.noInvitesHint")}
              </EmptyNote>
            )}
            {access?.data?.map((a: any) => (
              <Item variant="outline" className="bg-card" key={a.id}>
                <ItemMedia variant="icon">
                  <UserCheck />
                </ItemMedia>
                <ItemContent className="min-w-36">
                  <ItemTitle>
                    {a.role === "STUDENT"
                      ? t("learn.studentAccess")
                      : t("learn.guardianAccess")}
                  </ItemTitle>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <ToneBadge tone={a.revokedAt ? "muted" : "ok"}>
                    {a.revokedAt ? t("learn.removed") : t("sub.status.active")}
                  </ToneBadge>
                  {!a.revokedAt && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setConfirmation({
                          title: t("learn.revokeTitle"),
                          description: t("learn.revokeBody"),
                          action: t("learn.remove"),
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
                      {t("learn.revokeAccess")}
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
                      {a.role === "GUARDIAN"
                        ? t("learn.guardianInvite")
                        : t("learn.studentInvite")}
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
                        ? t("learn.accepted")
                        : a.revokedAt
                          ? t("lesson.cancelled")
                          : expired
                            ? t("learn.expired")
                            : t("learn.invitePending")}
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
                        {t("learn.cancelInvite")}
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
            <DialogDescription>{t("learn.previewHint")}</DialogDescription>
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
              <Download size={16} /> {t("learn.download")}
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
            <DialogDescription>{t("learn.videoDialogHint")}</DialogDescription>
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
                  t("video.askHere"),
                  [
                    {
                      name: "body",
                      label: t("learn.questionAt", {
                        time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
                      }),
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
      ? t("common.today")
      : key === tomorrow
        ? t("common.tomorrow")
        : dayLabel(iso, { weekday: "long" });
  };
  if (!lessons.length)
    return (
      <>
        <SectionHeading
          title={t("learn.scheduleTitle")}
          description={t("learn.scheduleText")}
        >
          {children}
        </SectionHeading>
        <EmptyNote icon={CalendarDays} title={t("learn.noLessons")}>
          {t("learn.noLessonsHint")}
        </EmptyNote>
      </>
    );
  return (
    <>
      <SectionHeading
        title={t("learn.upcoming")}
        description={t("learn.upcomingText")}
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
                    ? t("lesson.now")
                    : t("learn.next")
              }
            />
          ))
        ) : (
          <EmptyNote icon={CalendarDays} title={t("learn.noUpcoming")}>
            {t("learn.noUpcomingHint")}
          </EmptyNote>
        )}
      </ItemGroup>
      {past.length > 0 && (
        <>
          <SectionHeading
            title={t("learn.past")}
            description={t("learn.pastText")}
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
          {l.location || t("lesson.noLocation")}
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
                ? t("lesson.scheduled")
                : l.status === "COMPLETED"
                  ? t("lesson.completed")
                  : t("lesson.cancelled")}
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
        {busy ? t("learn.uploading") : t("learn.addFile")}
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
    (name ? t("learn.whatsappHelloName", { name }) : t("learn.whatsappHello")) +
    " " +
    t("learn.whatsappBody") +
    `\n\n${invite}`;
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
    ? [t("learn.videoStep1"), t("learn.videoStep2"), t("learn.videoStep3")]
    : [t("learn.fileStep1"), t("learn.fileStep2"), t("learn.fileStep3")];
  const rules = video
    ? [t("learn.videoRule1"), t("learn.videoRule2"), t("learn.videoRule3")]
    : ["PDF, JPG, PNG, WebP", t("learn.fileRule2"), t("learn.fileRule3")];
  return (
    <Card className="bg-muted/40 gap-5 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {video ? (
            <VideoIcon className="text-muted-foreground size-4" />
          ) : (
            <FileText className="text-muted-foreground size-4" />
          )}
          {video ? t("learn.videoHow") : t("learn.fileHow")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <ol className="grid gap-3">
          {steps.map((step, i) => (
            <li className="flex items-start gap-3" key={step}>
              <span className="bg-background flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums">
                {i + 1}
              </span>
              <span className="text-muted-foreground pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <Separator />
        <div className="grid gap-2">
          <p className="text-muted-foreground text-xs font-medium">
            {t("learn.accepts")}
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
          {video ? t("learn.videoStay") : t("learn.fileScope")}
        </p>
      </CardContent>
    </Card>
  );
}

/** Simge bildirimin türünden seçilir; türü yazılmamış eski bildirimlerde
 *  sunucunun sabit Türkçe başlığından. */
function noticeIcon(n: Notice) {
  if (n.kind === "QUESTION" || n.kind === "ANSWER") return <MessageSquare />;
  if (n.kind === "VIDEO") return <VideoIcon />;
  if (n.kind === "SUMMARY") return <Sparkles />;
  if (n.kind) return <ClipboardList />;
  const title = n.title.toLocaleLowerCase("tr");
  if (title.includes("soru")) return <MessageSquare />;
  if (title.includes("video")) return <VideoIcon />;
  if (title.includes("özet")) return <Sparkles />;
  if (title.includes("ödev")) return <ClipboardList />;
  return <Bell />;
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
          {used.toLocaleString(intlLocale())} /{" "}
          {limit.toLocaleString(intlLocale())}
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
              {noticeIcon(n)}
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
                      {noticeText(n.title)}
                    </button>
                  ) : (
                    noticeText(n.title)
                  )}
                </p>
                {!n.readAt && (
                  <span
                    className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                    aria-label={t("inbox.unread")}
                  />
                )}
              </div>
              <p className="text-muted-foreground text-sm leading-snug">
                {noticeText(n.body)}
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
                    {t("inbox.markRead")}
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
        <EmptyTitle className="text-base">{t("inbox.empty")}</EmptyTitle>
        <EmptyDescription>{t("inbox.emptyHint")}</EmptyDescription>
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
            <CardTitle>{t("inbox.usageTitle")}</CardTitle>
            <CardDescription>{t("inbox.usageText")}</CardDescription>
            <CardAction>
              <Badge variant="secondary">
                {limits.limits.plan === "PRO"
                  ? t("inbox.planPro")
                  : t("inbox.planPilot")}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 px-5">
            <UsageMeter
              label={t("overview.figureActive")}
              used={Number(limits.used.students)}
              limit={Number(limits.limits.studentLimit)}
            />
            <UsageMeter
              label={t("inbox.video")}
              used={Math.ceil(Number(limits.used.videoSeconds) / 60)}
              limit={Math.floor(Number(limits.limits.videoSeconds) / 60)}
              unit={t("inbox.minutesUnit")}
            />
            <UsageMeter
              label={t("inbox.storage")}
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
                unread
                  ? t("inbox.titleUnread", { count: unread })
                  : t("inbox.title")
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
            {workspaceId ? t("inbox.tooltipOwner") : t("inbox.title")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{t("inbox.title")}</SheetTitle>
            <SheetDescription>
              {unread
                ? t("inbox.unreadCount", { count: unread })
                : t("inbox.allRead")}
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
                    {t("inbox.tabInbox")}
                    {unread > 0 && (
                      <Badge className="h-5 min-w-5 px-1.5 tabular-nums">
                        {unread}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="usage">{t("inbox.tabUsage")}</TabsTrigger>
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
                    <span className="max-sm:sr-only">{t("inbox.markAll")}</span>
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
                    <CheckCheck /> {t("inbox.markAll")}
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
