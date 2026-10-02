"use client";
import { useEffect, useRef, useState } from "react";
import { type LearningData, type PortalData } from "@derslik/api-client";
import {
  dayLabel,
  dateKey,
  addDays,
  timeLabel,
  t,
  type NoticeTarget,
} from "@derslik/contracts";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  FileText,
  Paperclip,
  Video as VideoIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/derslik/loading";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
import { FormError, ToneBadge, type Tone } from "../feedback";

export type Field = {
  name: string;
  label: string;
  value?: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};

export type FormSpec = {
  title: string;
  fields: Field[];
  submit: (values: Record<string, string>) => Promise<void>;
};

export function ActionForm({
  spec,
  onClose,
}: Readonly<{
  spec: FormSpec | null;
  onClose: () => void;
}>) {
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
                <FieldInput f={f} />
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

function FieldInput({ f }: Readonly<{ f: Field }>) {
  if (f.options)
    return (
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
    );
  if (f.type === "textarea")
    return (
      <Textarea
        id={"field-" + f.name}
        name={f.name}
        defaultValue={f.value}
        required={f.required !== false}
        maxLength={5000}
        rows={5}
        className="min-h-28"
      />
    );
  return (
    <Input
      id={"field-" + f.name}
      name={f.name}
      type={f.type || "text"}
      defaultValue={f.value}
      required={f.required !== false}
      maxLength={f.type === "email" ? 200 : 150}
      min={f.type === "number" ? 0 : undefined}
    />
  );
}

export const empty: LearningData = {
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

export type Confirmation = {
  title: string;
  description: string;
  action: string;
  perform: () => void | Promise<void>;
};

export function ConfirmDialog({
  state,
  onClose,
}: Readonly<{
  state: Confirmation | null;
  onClose: () => void;
}>) {
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
  | "access"
  /** Öğretmenle yazışma; yalnızca öğrenci ve velide. */
  | "messages";

export type LearningTabInfo = { id: LearningTab; title: string };

/** Bildirimden açılan yer; `at` aynı bildirime yeniden tıklanınca değişir. */
export type NoticeFocus = NoticeTarget & { at: number };

/** İzinlerden sekme listesi. Portal da sol menüyü panel açık olmadan
 *  (ör. "Öğretmen bul" sayfasında) bununla kurar. */
export function learningTabs(
  permissions: string[],
  owner = false,
): LearningTabInfo[] {
  const all: (LearningTabInfo & { permission: string })[] = [
    ...(owner
      ? []
      : [
          {
            id: "lessons" as const,
            title: t("nav.lessons"),
            permission: "lessons",
          },
          // Mesaj rotaları portalda "lessons" iznini ister.
          {
            id: "messages" as const,
            title: t("nav.messages"),
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
  return all
    .filter((x) => permissions.includes(x.permission))
    .map(({ id, title }) => ({ id, title }));
}

/** Seçimsiz "genel" seçenek. Radix Select boş değeri "seçim yok" sayıp
 *  tetikleyiciyi boş bıraktığı için ayrı bir değerle temsil ediliyor. */
export const GENERAL = "general";

export function SectionHeading({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children?: React.ReactNode;
}>) {
  // Dar ekranda düğmeler başlığın altına iner; başlık birkaç harflik bir
  // sütuna sıkışmaz.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="grid min-w-0 flex-1 basis-56 gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

export type PortalLesson = PortalData["lessons"][number];

/** Öğrenci/veli ders planı. Önce yaklaşan dersler gelir, en yakını üstte ve
 *  fosforlu; sonra geçmiş dersler, en yenisi üstte. */
export function LessonSchedule({
  lessons,
  children,
  renderExtra,
}: Readonly<{
  lessons: PortalLesson[];
  /** Başlığın yanındaki düğmeler (yenile). */
  children?: React.ReactNode;
  /** Dersin yanındaki ek öğe (ayarlama etiketi, iptal). `now` bileşenin
   *  dakikada bir ilerleyen saatidir. */
  renderExtra?: (lesson: PortalLesson, now: number) => React.ReactNode;
}>) {
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
    if (key === today) return t("common.today");
    if (key === tomorrow) return t("common.tomorrow");
    return dayLabel(iso, { weekday: "long" });
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
              extra={renderExtra?.(l, clock)}
              chip={nextChip(l.starts_at, i, clock)}
            />
          ))
        ) : (
          <EmptyNote
            role="listitem"
            icon={CalendarDays}
            title={t("learn.noUpcoming")}
          >
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
              <LessonItem
                key={l.id}
                lesson={l}
                day={day(l.starts_at)}
                status
                extra={renderExtra?.(l, clock)}
              />
            ))}
          </ItemGroup>
        </>
      )}
    </>
  );
}

function nextChip(startsAt: string, index: number, clock: number) {
  if (index > 0) return undefined;
  return Date.parse(startsAt) <= clock ? t("lesson.now") : t("learn.next");
}

export function LessonItem({
  lesson: l,
  day,
  chip,
  status = false,
  extra,
}: Readonly<{
  lesson: PortalLesson;
  day: string;
  /** Sıradaki ya da süren ders: kart fosforlu, yanında bu etiket. */
  chip?: string;
  /** Geçmiş derslerde durum rozeti; yaklaşanların hepsi zaten planlı. */
  status?: boolean;
  /** Satırın sağındaki ek öğe (ör. ayarlama etiketi ve iptal). */
  extra?: React.ReactNode;
}>) {
  return (
    <Item
      role="listitem"
      variant="outline"
      className={chip ? "border-(--marker) bg-(--marker-soft)" : "bg-card"}
      data-notice-target={l.id}
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
      {(chip || status || extra) && (
        <ItemActions className="ml-auto flex-wrap justify-end">
          {chip && <span className="now-chip">{chip}</span>}
          {status && (
            <ToneBadge tone={lessonTone(l.status)}>
              {/* Geçmişte kalıp hâlâ planlı görünen ders, öğretmenin
                  tamamlandı ya da iptal demesini bekliyor. */}
              {lessonStatusLabel(l.status)}
            </ToneBadge>
          )}
          {extra}
        </ItemActions>
      )}
    </Item>
  );
}

function lessonTone(status: PortalLesson["status"]): Tone {
  if (status === "SCHEDULED") return "warn";
  if (status === "COMPLETED") return "ok";
  return "muted";
}

function lessonStatusLabel(status: PortalLesson["status"]) {
  if (status === "SCHEDULED") return t("lesson.awaitingConfirmation");
  if (status === "COMPLETED") return t("lesson.completed");
  return t("lesson.cancelled");
}

export function EmptyNote({
  icon: Icon,
  title,
  children,
  role,
}: Readonly<{
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  /** Bir listenin (ItemGroup) içindeyse "listitem": ekran okuyucu ve
   *  otomatik denetim listenin yalnızca öğe içerdiğini görsün. */
  role?: "listitem";
}>) {
  return (
    <Empty role={role} className="border md:p-10">
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
export function FilePicker({
  busy,
  disabled,
  onPick,
}: Readonly<{
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
}>) {
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
export function IconAction({
  label,
  icon,
  onClick,
  disabled,
  danger,
  outline,
}: Readonly<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  outline?: boolean;
}>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={outline ? "icon" : "icon-sm"}
            variant={outline ? "outline" : "ghost"}
            className={iconActionClass(danger, outline)}
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

function iconActionClass(danger?: boolean, outline?: boolean) {
  if (danger)
    return "text-muted-foreground hover:bg-destructive/10 hover:text-destructive";
  return outline ? "" : "text-muted-foreground";
}

/**
 * Öğretmen telefonu serbest metin olarak giriyor ("0532 123 45 67",
 * "+90 532...", "532..."). wa.me yalnızca ülke koduyla ve yalnızca rakam
 * kabul eder. Türkiye cep numaraları 5 ile başladığı için baştaki "90" güvenle
 * ülke kodu sayılabilir; başka bir ülke kodu yazılmışsa dokunulmaz.
 */
export function whatsappNumber(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("90")) return digits;
  if (digits.startsWith("0")) return "90" + digits.slice(1);
  if (digits.length === 10) return "90" + digits;
  return digits;
}

export function whatsappInviteUrl(phone: string, name: string, invite: string) {
  const text =
    (name ? t("learn.whatsappHelloName", { name }) : t("learn.whatsappHello")) +
    " " +
    t("learn.whatsappBody") +
    `\n\n${invite}`;
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`;
}

// Yükleme formu okunabilir genişlikte kalınca sağda geniş bir boşluk kalıyordu.
// Oraya dekor yerine işin kendisine ait bilgi konuyor: akışın adımları, kabul
// edilen dosya kuralları ve öğrencinin sonunda ne göreceği.
export function UploadAside({ kind }: Readonly<{ kind: "files" | "videos" }>) {
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
