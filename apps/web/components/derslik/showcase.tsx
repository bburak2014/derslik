"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ExternalLink,
  Inbox,
  Mail,
  Phone,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  PHOTO_MAX_BYTES,
  PHOTO_SIZE,
  lessonModes,
  priceCurrencies,
  t,
  teacherLevels,
  teacherSubjects,
  teachingLanguages,
  type LessonRequest,
  type PublicTeacher,
  type Showcase,
  type TeacherProfileInput,
  DECISION_NOTE_MAX,
} from "@derslik/contracts";
import { backend, webRequest } from "@/lib/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FormError, FormSuccess, ToneBadge } from "./feedback";
import { Spinner } from "./loading";
import {
  RequestStatusBadge,
  ReviewList,
  Stars,
  TeacherCard,
  TeacherPhoto,
  langName,
  levelName,
  modeName,
  shortDate,
  subjectName,
} from "./directory";

type Tab = "requests" | "profile" | "reviews";

/** Seçilen fotoğraf kare olarak kırpılır, küçültülür ve JPEG'e çevrilir;
 *  sunucuya giden dosya birkaç on KB olur. */
async function squarePhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    PHOTO_SIZE,
    PHOTO_SIZE,
  );
  bitmap.close();
  for (const quality of [0.86, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= PHOTO_MAX_BYTES) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }
  }
  throw new Error(t("api.photoTooLarge"));
}

function emptyProfile(fallbackName: string): TeacherProfileInput {
  return {
    displayName: fallbackName,
    headline: "",
    bio: "",
    subjects: [],
    levels: [],
    lessonModes: ["ONLINE"],
    city: "",
    hourlyPrice: null,
    currency: "TRY",
    languages: ["tr"],
    experienceYears: null,
    // Yeni profil ilk kayıtta yayına girer (kullanıcı kararı: öğretmen
    // açınca hemen yayında). Gizlemek isteyen anahtarı kapatır.
    published: true,
  };
}

function Chips<T extends string>({
  id,
  options,
  value,
  label,
  onChange,
  max,
}: {
  id: string;
  options: readonly T[];
  value: T[];
  label: (v: T) => string;
  onChange: (v: T[]) => void;
  max?: number;
}) {
  return (
    <ToggleGroup
      id={id}
      type="multiple"
      variant="outline"
      size="sm"
      spacing={2}
      className="w-full flex-wrap"
      value={value}
      onValueChange={(next) => {
        const list = next as T[];
        if (max && list.length > max) return;
        onChange(list);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="data-[state=on]:border-(--brand-line) data-[state=on]:bg-(--brand-soft) data-[state=on]:text-(--brand-hover)"
        >
          {value.includes(o) && <Check />}
          {label(o)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function RequestCard({
  request,
  busy,
  onDecide,
  onOpenStudent,
}: {
  request: LessonRequest;
  busy: boolean;
  onDecide: (decision: "accept" | "decline") => void;
  onOpenStudent: (id: string) => void;
}) {
  return (
    <Card
      data-notice-target={request.id}
      className="gap-3 p-5"
      data-highlight={undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-display text-lg">{request.studentName}</strong>
        <RequestStatusBadge status={request.status} />
      </div>
      <p className="text-muted-foreground text-sm">
        {subjectName(request.subject)}
        {request.level ? " · " + levelName(request.level) : ""} ·{" "}
        {t("dir.requestFrom", { date: shortDate(request.createdAt) })}
      </p>
      <p className="text-sm leading-relaxed whitespace-pre-line">
        {request.message || (
          <span className="text-muted-foreground">{t("dir.noMessage")}</span>
        )}
      </p>
      {(request.email || request.phone) && (
        <div className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {request.email && (
            <a
              href={`mailto:${request.email}`}
              className="flex items-center gap-1.5 hover:underline"
            >
              <Mail size={15} /> {request.email}
            </a>
          )}
          {request.phone && (
            <a
              href={`tel:${request.phone.replace(/\s/g, "")}`}
              className="flex items-center gap-1.5 hover:underline"
            >
              <Phone size={15} /> {request.phone}
            </a>
          )}
        </div>
      )}
      {request.status === "PENDING" && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onDecide("accept")}
          >
            <Check /> {t("dir.accept")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("decline")}
          >
            <X /> {t("dir.decline")}
          </Button>
        </div>
      )}
      {request.status === "DECLINED" && request.decisionNote && (
        <p className="text-muted-foreground text-sm whitespace-pre-line">
          <span className="font-medium">{t("dir.yourNote")}:</span>{" "}
          {request.decisionNote}
        </p>
      )}
      {request.status === "ACCEPTED" && request.studentId && (
        <div className="border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenStudent(request.studentId!)}
          >
            {t("dir.openStudent")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Öğretmenin vitrin sayfası: gelen istekler, profil düzenleme, yorumlar. */
export function ShowcaseView({
  workspaceId,
  fallbackName,
  focus,
  onPending,
  onAccepted,
  onOpenStudent,
}: {
  workspaceId: string;
  fallbackName: string;
  /** Bildirimden gelindiyse vurgulanacak istek. */
  focus?: { id: string | null; at: number } | null;
  /** Kenar çubuğundaki sayaç için bekleyen istek sayısı. */
  onPending?: (count: number) => void;
  /** Kabul edilen öğrenci öğrenci listesine eklendi; çalışma alanı yenilenir. */
  onAccepted?: () => void;
  onOpenStudent: (id: string) => void;
}) {
  const [data, setData] = useState<Showcase | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab | null>(null),
    [decision, setDecision] = useState<{
      request: LessonRequest;
      kind: "accept" | "decline";
    } | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [note, setNote] = useState("");
  const reload = useCallback(async () => {
    try {
      const r = await backend<{ data: Showcase }>(
        `/workspaces/${workspaceId}/showcase`,
      );
      setData(r.data);
      setError("");
      onPending?.(r.data.requests.filter((x) => x.status === "PENDING").length);
      return r.data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [workspaceId, onPending]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yükleyici durumu yalnızca istek bitince yazar.
    void reload();
  }, [reload]);
  // Bildirimden gelindiyse istekler sekmesi açılır ve istek işaretlenir.
  const [appliedFocus, setAppliedFocus] = useState(0);
  if (focus && focus.at !== appliedFocus) {
    setAppliedFocus(focus.at);
    setTab("requests");
  }
  useEffect(() => {
    if (!focus?.id || !data) return;
    const el = document.querySelector<HTMLElement>(
      `[data-notice-target="${CSS.escape(focus.id)}"]`,
    );
    if (!el) return;
    el.dataset.highlight = "true";
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const id = setTimeout(() => (el.dataset.highlight = "false"), 2400);
    return () => clearTimeout(id);
  }, [focus, data]);
  if (!data)
    return error ? (
      <FormError>{error}</FormError>
    ) : (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  const pending = data.requests.filter((r) => r.status === "PENDING"),
    earlier = data.requests.filter((r) => r.status !== "PENDING");
  const current: Tab = tab ?? (data.profile ? "requests" : "profile");
  async function decide() {
    if (!decision) return;
    setBusy(true);
    try {
      await backend(
        `/workspaces/${workspaceId}/requests/${decision.request.id}/${decision.kind}`,
        decision.kind === "decline" ? { note } : {},
      );
      setNotice(
        decision.kind === "accept"
          ? t("dir.accepted", { name: decision.request.studentName })
          : t("dir.declined"),
      );
      setDecision(null);
      await reload();
      if (decision.kind === "accept") onAccepted?.();
    } catch (e) {
      setError((e as Error).message);
      setDecision(null);
    } finally {
      setBusy(false);
    }
  }
  const requestCard = (r: LessonRequest) => (
    <RequestCard
      key={r.id}
      request={r}
      busy={busy}
      onDecide={(kind) => {
        setNotice("");
        setError("");
        setNote("");
        setDecision({ request: r, kind });
      }}
      onOpenStudent={onOpenStudent}
    />
  );
  return (
    <section className="grid grid-cols-1 gap-6">
      <Tabs value={current} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="requests">
            {t("dir.tabRequests")}
            {pending.length > 0 && (
              <span className="nav-count">{pending.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="profile">
            {t("dir.tabProfile")}
            {data.profile?.published ? (
              <span className="bg-(--ok) size-1.5 rounded-full" />
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="reviews">{t("dir.tabReviews")}</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4 grid gap-4">
          {notice && <FormSuccess>{notice}</FormSuccess>}
          {error && <FormError>{error}</FormError>}
          {!data.requests.length ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle className="text-base">
                  {t("dir.tabRequests")}
                </EmptyTitle>
                <EmptyDescription>
                  {t("dir.noRequestsTeacher")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {pending.length > 0 && (
                <div className="grid gap-3">{pending.map(requestCard)}</div>
              )}
              {earlier.length > 0 && (
                <div className="grid gap-3">
                  <h3 className="text-muted-foreground text-sm font-medium">
                    {t("dir.earlierRequests")}
                  </h3>
                  {earlier.map(requestCard)}
                </div>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <ProfileEditor
            key={data.profile ? "saved" : "new"}
            workspaceId={workspaceId}
            showcase={data}
            fallbackName={fallbackName}
            onSaved={reload}
          />
        </TabsContent>
        <TabsContent value="reviews" className="mt-4">
          <Card className="gap-5 p-6">
            {data.ratingCount ? (
              <div className="flex flex-wrap items-center gap-4">
                <strong className="font-display text-4xl tabular-nums">
                  {data.ratingAverage?.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                  })}
                </strong>
                <div className="grid gap-1">
                  <Stars value={data.ratingAverage} size={18} />
                  <span className="text-muted-foreground text-sm">
                    {t("dir.reviewCount", { count: data.ratingCount })}
                  </span>
                </div>
              </div>
            ) : null}
            {data.reviews.length ? (
              <ReviewList reviews={data.reviews} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Star />
                  </EmptyMedia>
                  <EmptyDescription>
                    {t("dir.noReviewsTeacher")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      <AlertDialog
        open={!!decision}
        onOpenChange={(open) => !open && !busy && setDecision(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decision?.kind === "accept"
                ? t("dir.acceptTitle", { name: decision.request.studentName })
                : t("dir.declineTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decision?.kind === "accept"
                ? t("dir.acceptBody")
                : t("dir.declineBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {decision?.kind === "decline" && (
            <div className="grid gap-2">
              <Label htmlFor="decline-note">{t("dir.declineNoteLabel")}</Label>
              <Textarea
                id="decline-note"
                value={note}
                maxLength={DECISION_NOTE_MAX}
                rows={3}
                placeholder={t("dir.declineNotePlaceholder")}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void decide();
              }}
            >
              {busy && <Spinner />}
              {decision?.kind === "accept" ? t("dir.accept") : t("dir.decline")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ProfileEditor({
  workspaceId,
  showcase,
  fallbackName,
  onSaved,
}: {
  workspaceId: string;
  showcase: Showcase;
  fallbackName: string;
  onSaved: () => Promise<Showcase | null>;
}) {
  const saved = showcase.profile;
  const [form, setForm] = useState<TeacherProfileInput>(() =>
      saved
        ? {
            displayName: saved.displayName,
            headline: saved.headline,
            bio: saved.bio,
            subjects: saved.subjects,
            levels: saved.levels,
            lessonModes: saved.lessonModes,
            city: saved.city,
            hourlyPrice: saved.hourlyPrice,
            currency: saved.currency,
            languages: saved.languages,
            experienceYears: saved.experienceYears,
            published: saved.published,
          }
        : emptyProfile(fallbackName),
    ),
    [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(""),
    file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<TeacherProfileInput>) => {
    setDone("");
    setForm((f) => ({ ...f, ...patch }));
  };
  const inPerson = form.lessonModes.includes("IN_PERSON");
  async function save(publish?: boolean) {
    setBusy(true);
    setError("");
    setDone("");
    const body = { ...form, published: publish ?? form.published };
    try {
      await webRequest(
        `/api/backend/workspaces/${workspaceId}/showcase`,
        body,
        "PUT",
      );
      setForm(body);
      await onSaved();
      setDone(t("dir.profileSaved"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadPhoto(chosen: File) {
    setPhotoBusy(true);
    setError("");
    setDone("");
    try {
      let data: string;
      try {
        data = await squarePhoto(chosen);
      } catch {
        throw new Error(t("dir.photoInvalid"));
      }
      await webRequest(
        `/api/backend/workspaces/${workspaceId}/showcase/photo`,
        { mimeType: "image/jpeg", data },
        "PUT",
      );
      await onSaved();
      setDone(t("dir.photoSaved"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  const preview: PublicTeacher = {
    id: workspaceId,
    displayName: form.displayName || fallbackName,
    headline: form.headline,
    bio: form.bio,
    subjects: form.subjects,
    levels: form.levels,
    lessonModes: form.lessonModes,
    city: form.city,
    hourlyPrice: form.hourlyPrice,
    currency: form.currency,
    languages: form.languages,
    experienceYears: form.experienceYears,
    photoVersion: saved?.photoVersion ?? null,
    ratingAverage: showcase.ratingAverage,
    ratingCount: showcase.ratingCount,
    publishedAt: saved?.publishedAt ?? "",
  };
  const field = (
    id: string,
    label: string,
    control: React.ReactNode,
    hint?: string,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        className="grid min-w-0 gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!saved && <Card className="p-5 text-sm">{t("dir.setupFirst")}</Card>}
        <Card className="gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="sc-published" className="text-base">
                {t("dir.published")}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t("dir.publishedHint")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <ToneBadge tone={form.published ? "ok" : "muted"}>
                {form.published ? t("dir.liveBadge") : t("dir.hiddenBadge")}
              </ToneBadge>
              <Switch
                id="sc-published"
                checked={form.published}
                disabled={busy}
                // Kayıtlı profilde anahtar hemen yayına alır ya da kaldırır.
                onCheckedChange={(checked) =>
                  saved ? void save(checked) : set({ published: checked })
                }
              />
            </div>
          </div>
        </Card>
        <Card className="gap-5 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <TeacherPhoto
              id={workspaceId}
              version={saved?.photoVersion ?? null}
              name={form.displayName || fallbackName}
              size={80}
            />
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t("dir.photo")}</span>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    if (chosen) void uploadPhoto(chosen);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!saved || photoBusy}
                  onClick={() => file.current?.click()}
                >
                  {photoBusy ? <Spinner /> : <Camera />}
                  {saved?.photoVersion
                    ? t("dir.changePhoto")
                    : t("dir.uploadPhoto")}
                </Button>
                {saved?.photoVersion && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={photoBusy}
                    onClick={async () => {
                      setPhotoBusy(true);
                      try {
                        await backend(
                          `/workspaces/${workspaceId}/showcase/photo/delete`,
                          {},
                        );
                        await onSaved();
                        setDone(t("dir.photoRemoved"));
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setPhotoBusy(false);
                      }
                    }}
                  >
                    <Trash2 /> {t("dir.removePhoto")}
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {saved ? t("dir.photoHint") : t("dir.photoAfterSave")}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "sc-name",
              t("dir.displayName"),
              <Input
                id="sc-name"
                required
                minLength={2}
                maxLength={80}
                value={form.displayName}
                onChange={(e) => set({ displayName: e.target.value })}
              />,
            )}
            {field(
              "sc-headline",
              t("dir.headline"),
              <Input
                id="sc-headline"
                maxLength={120}
                placeholder={t("dir.headlinePlaceholder")}
                value={form.headline}
                onChange={(e) => set({ headline: e.target.value })}
              />,
            )}
          </div>
          {field(
            "sc-bio",
            t("dir.bio"),
            <Textarea
              id="sc-bio"
              rows={6}
              maxLength={2000}
              placeholder={t("dir.bioPlaceholder")}
              value={form.bio}
              onChange={(e) => set({ bio: e.target.value })}
            />,
            `${form.bio.length} / 2000`,
          )}
        </Card>
        <Card className="gap-5 p-5">
          {field(
            "sc-subjects",
            t("dir.subjects"),
            <Chips
              id="sc-subjects"
              options={teacherSubjects}
              value={form.subjects}
              label={subjectName}
              max={6}
              onChange={(subjects) => set({ subjects })}
            />,
            t("dir.pickSubjects"),
          )}
          {field(
            "sc-levels",
            t("dir.levels"),
            <Chips
              id="sc-levels"
              options={teacherLevels}
              value={form.levels}
              label={levelName}
              onChange={(levels) => set({ levels })}
            />,
          )}
          {field(
            "sc-modes",
            t("dir.lessonModes"),
            <Chips
              id="sc-modes"
              options={lessonModes}
              value={form.lessonModes}
              label={modeName}
              onChange={(modes) => modes.length && set({ lessonModes: modes })}
            />,
          )}
          {inPerson &&
            field(
              "sc-city",
              t("dir.city"),
              <Input
                id="sc-city"
                required
                maxLength={60}
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
              />,
            )}
          {field(
            "sc-languages",
            t("dir.languages"),
            <Chips
              id="sc-languages"
              options={teachingLanguages}
              value={form.languages}
              label={langName}
              onChange={(languages) => set({ languages })}
            />,
          )}
        </Card>
        <Card className="gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {field(
              "sc-price",
              t("dir.hourlyPrice"),
              <Input
                id="sc-price"
                type="number"
                inputMode="numeric"
                min={0}
                max={1000000}
                value={form.hourlyPrice ?? ""}
                onChange={(e) =>
                  set({
                    hourlyPrice:
                      e.target.value === ""
                        ? null
                        : Math.max(0, Math.floor(Number(e.target.value))),
                  })
                }
              />,
            )}
            {field(
              "sc-currency",
              t("dir.currency"),
              <Select
                value={form.currency}
                onValueChange={(v) =>
                  set({ currency: v as TeacherProfileInput["currency"] })
                }
              >
                <SelectTrigger id="sc-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priceCurrencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
            )}
            {field(
              "sc-experience",
              t("dir.experienceYears"),
              <Input
                id="sc-experience"
                type="number"
                inputMode="numeric"
                min={0}
                max={80}
                value={form.experienceYears ?? ""}
                onChange={(e) =>
                  set({
                    experienceYears:
                      e.target.value === ""
                        ? null
                        : Math.min(
                            80,
                            Math.max(0, Math.floor(Number(e.target.value))),
                          ),
                  })
                }
              />,
            )}
          </div>
          <p className="text-muted-foreground text-xs">{t("dir.priceHint")}</p>
        </Card>
        {error && <FormError>{error}</FormError>}
        {done && !error && <FormSuccess>{done}</FormSuccess>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Spinner />}
            {t("dir.saveProfile")}
          </Button>
          {saved?.published && (
            <Button asChild variant="outline" size="lg">
              <a
                href={`/teachers/${workspaceId}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink /> {t("dir.viewPublic")}
              </a>
            </Button>
          )}
        </div>
      </form>
      <div className="grid gap-3 lg:sticky lg:top-6">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("dir.preview")}
        </p>
        <TeacherCard teacher={preview} />
        {form.subjects.length === 0 && (
          <Badge variant="outline" className="w-fit">
            {t("api.pickSubject")}
          </Badge>
        )}
      </div>
    </div>
  );
}
