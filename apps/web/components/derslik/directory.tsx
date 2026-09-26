"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Clock3,
  GraduationCap,
  Languages,
  MapPin,
  MonitorPlay,
  Search,
  Send,
  SlidersHorizontal,
  Star,
  UserRoundSearch,
  X,
} from "lucide-react";
import {
  intlLocale,
  lessonModes,
  t,
  teacherLevels,
  teacherSorts,
  teacherSubjects,
  type LessonRequestInput,
  type MessageKey,
  type MyLessonRequest,
  type PublicReview,
  type PublicTeacher,
  type RequestStatus,
  type TeacherFilter,
  type TeacherRelation,
  REQUEST_EXPIRY_DAYS,
} from "@derslik/contracts";
import { teacherQuery, type TeacherPage } from "@derslik/api-client";
import { backend, webRequest } from "@/lib/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
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
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess, ToneBadge, type Tone } from "./feedback";
import { Spinner } from "./loading";

// --- Küçük parçalar (web vitrini, öğrenci ve öğretmen ekranları ortak) ------

const ANY = "__any";
const tint = ["sage", "peach", "lavender", "blue"];

/** Öğretmen fotoğrafı; yoksa adın baş harfleri (öğrenci avatarıyla aynı renk
 *  kuralı). */
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
  const style = { width: size, height: size, fontSize: Math.round(size / 2.8) };
  if (version)
    return (
      // Fotoğraf API'den BFF üzerinden gelir; next/image optimizasyonu gerekmez.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/public/teachers/${id}/photo?v=${version}`}
        alt=""
        className="teacher-photo"
        style={style}
        loading="lazy"
      />
    );
  const idx =
    Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  return (
    <span className={`avatar ${tint[idx]}`} style={style} aria-hidden="true">
      {name
        .split(" ")
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toLocaleUpperCase(intlLocale())}
    </span>
  );
}

export function Stars({
  value,
  size = 14,
}: {
  value: number | null;
  size?: number;
}) {
  const rounded = Math.round(value ?? 0);
  return (
    <span
      className="stars"
      role="img"
      aria-label={t("dir.stars", { count: value ?? 0 })}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          aria-hidden="true"
          className={i <= rounded ? "star-on" : "star-off"}
        />
      ))}
    </span>
  );
}

function Rating({ teacher }: { teacher: PublicTeacher }) {
  if (!teacher.ratingCount)
    return (
      <ToneBadge tone="info" className="w-fit">
        {t("dir.newTeacher")}
      </ToneBadge>
    );
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
      <Stars value={teacher.ratingAverage} />
      <strong className="tabular-nums">
        {teacher.ratingAverage?.toLocaleString(intlLocale(), {
          minimumFractionDigits: 1,
        })}
      </strong>
      <span className="text-muted-foreground whitespace-nowrap">
        ({t("dir.reviewCount", { count: teacher.ratingCount })})
      </span>
    </span>
  );
}

export function priceText(p: { hourlyPrice: number | null; currency: string }) {
  if (p.hourlyPrice === null) return null;
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: p.currency,
    maximumFractionDigits: 0,
  }).format(p.hourlyPrice);
}

function Price({
  teacher,
  large,
}: {
  teacher: PublicTeacher;
  large?: boolean;
}) {
  const price = priceText(teacher);
  if (!price)
    return (
      <span className="text-muted-foreground text-sm">
        {t("dir.priceOnRequest")}
      </span>
    );
  return (
    <span className="whitespace-nowrap">
      <strong
        className={
          "font-display tabular-nums " + (large ? "text-3xl" : "text-xl")
        }
      >
        {price}
      </strong>{" "}
      <span className="text-muted-foreground text-sm">{t("dir.perHour")}</span>
    </span>
  );
}

const subjectName = (s: string) => t(`dir.subject.${s}` as MessageKey);
const levelName = (s: string) => t(`dir.level.${s}` as MessageKey);
const modeName = (s: string) => t(`dir.mode.${s}` as MessageKey);
const langName = (s: string) => t(`dir.lang.${s}` as MessageKey);

const statusTone: Record<RequestStatus, Tone> = {
  PENDING: "warn",
  ACCEPTED: "ok",
  DECLINED: "danger",
  CANCELLED: "muted",
  EXPIRED: "muted",
};
export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <ToneBadge tone={statusTone[status]}>
      {t(`dir.status.${status}` as MessageKey)}
    </ToneBadge>
  );
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// --- Liste ------------------------------------------------------------------

type Filters = Required<Pick<TeacherFilter, "sort">> &
  Omit<TeacherFilter, "sort" | "page">;

export function TeacherCard({
  teacher,
  onOpen,
  href,
  onRequest,
  requestHref,
}: {
  teacher: PublicTeacher;
  onOpen?: () => void;
  href?: string;
  /** Kartın altındaki "İstek gönder": profili istek penceresi açık açar. */
  onRequest?: () => void;
  requestHref?: string;
}) {
  return (
    <Card className="teacher-card relative gap-4 p-5">
      <div className="flex items-start gap-4">
        <TeacherPhoto
          id={teacher.id}
          version={teacher.photoVersion}
          name={teacher.displayName}
          size={64}
        />
        <div className="grid min-w-0 gap-1">
          <h3 className="font-display truncate text-lg leading-tight font-bold">
            {href ? (
              <a href={href} className="card-link">
                {teacher.displayName}
              </a>
            ) : (
              <button type="button" className="card-link" onClick={onOpen}>
                {teacher.displayName}
              </button>
            )}
          </h3>
          {teacher.headline && (
            <p className="text-muted-foreground line-clamp-2 text-sm">
              {teacher.headline}
            </p>
          )}
          <Rating teacher={teacher} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {teacher.subjects.slice(0, 4).map((s) => (
          <Badge key={s} variant="secondary">
            {subjectName(s)}
          </Badge>
        ))}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {teacher.lessonModes.includes("ONLINE") && (
          <span className="flex items-center gap-1.5">
            <MonitorPlay size={15} /> {modeName("ONLINE")}
          </span>
        )}
        {teacher.lessonModes.includes("IN_PERSON") && (
          <span className="flex items-center gap-1.5">
            <MapPin size={15} /> {teacher.city || modeName("IN_PERSON")}
          </span>
        )}
        {teacher.experienceYears !== null && teacher.experienceYears > 0 && (
          <span className="flex items-center gap-1.5">
            <GraduationCap size={15} />
            {t("dir.experience", { count: teacher.experienceYears })}
          </span>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
        <Price teacher={teacher} />
        {/* Kartın tamamı profile gider; düğme onun üstünde ayrı tıklanır. */}
        {requestHref ? (
          <Button asChild size="sm" className="relative z-10">
            <a href={requestHref}>
              <Send /> {t("dir.requestShort")}
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="relative z-10"
            onClick={onRequest ?? onOpen}
          >
            <Send /> {t("dir.requestShort")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function CardSkeletons() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="gap-4 p-5" aria-hidden="true">
          <div className="flex gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-8 w-full" />
        </Card>
      ))}
    </>
  );
}

/** Öğretmen listesi: arama, filtreler, sıralama ve "daha fazla göster". */
export function TeacherDirectory({
  onOpen,
  hrefFor,
}: {
  /** `request` doluysa profil, istek penceresi açık gelir. */
  onOpen?: (id: string, request?: boolean) => void;
  /** Herkese açık sayfada kartlar bağlantıdır (yeni sekmede açılabilir). */
  hrefFor?: (id: string, request?: boolean) => string;
}) {
  const [filters, setFilters] = useState<Filters>({ sort: "recommended" }),
    [search, setSearch] = useState(""),
    [page, setPage] = useState<TeacherPage | null>(null),
    [items, setItems] = useState<PublicTeacher[]>([]),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [showFilters, setShowFilters] = useState(false);
  // Arama kutusu yazarken her tuşta istek atmasın.
  useEffect(() => {
    const id = setTimeout(
      () =>
        setFilters((f) =>
          (f.q ?? "") === search.trim()
            ? f
            : { ...f, q: search.trim() || undefined },
        ),
      300,
    );
    return () => clearTimeout(id);
  }, [search]);
  const load = useCallback(
    async (pageNumber: number) => {
      const r = await webRequest<TeacherPage>(
        "/api/public/teachers" + teacherQuery({ ...filters, page: pageNumber }),
      );
      return r;
    },
    [filters],
  );
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yükleme göstergesi istekten önce açılır.
    setLoading(true);
    load(1)
      .then((r) => {
        if (!alive) return;
        setPage(r);
        setItems(r.data);
        setError("");
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);
  async function loadMore() {
    if (!page) return;
    setMore(true);
    try {
      const r = await load(page.page + 1);
      setPage(r);
      setItems((old) => [...old, ...r.data]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMore(false);
    }
  }
  const set = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const active =
    !!filters.subject ||
    !!filters.level ||
    !!filters.mode ||
    !!filters.city ||
    filters.maxPrice !== undefined;
  const select = (
    id: string,
    label: string,
    value: string | undefined,
    anyLabel: string,
    options: { value: string; label: string }[],
    onChange: (v: string | undefined) => void,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? ANY}
        onValueChange={(v) => onChange(v === ANY ? undefined : v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <section className="grid grid-cols-1 gap-6">
      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <InputGroup className="min-w-0 flex-1 basis-64">
            <InputGroupAddon>
              <Search size={17} />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t("dir.searchPlaceholder")}
              placeholder={t("dir.searchPlaceholder")}
              value={search}
              maxLength={80}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          <Select
            value={filters.sort}
            onValueChange={(v) => set({ sort: v as Filters["sort"] })}
          >
            <SelectTrigger
              className="w-auto min-w-44"
              aria-label={t("dir.sortLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teacherSorts.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`dir.sort.${s}` as MessageKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={showFilters || active ? "secondary" : "outline"}
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal /> {t("dir.filters")}
            {active && <span className="filter-dot" aria-hidden="true" />}
          </Button>
        </div>
        {showFilters && (
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-5">
            {select(
              "dir-subject",
              t("dir.subjectLabel"),
              filters.subject,
              t("dir.allSubjects"),
              teacherSubjects.map((s) => ({ value: s, label: subjectName(s) })),
              (v) => set({ subject: v as Filters["subject"] }),
            )}
            {select(
              "dir-level",
              t("dir.levelLabel"),
              filters.level,
              t("dir.allLevels"),
              teacherLevels.map((s) => ({ value: s, label: levelName(s) })),
              (v) => set({ level: v as Filters["level"] }),
            )}
            {select(
              "dir-mode",
              t("dir.lessonModes"),
              filters.mode,
              t("dir.anyMode"),
              lessonModes.map((s) => ({ value: s, label: modeName(s) })),
              (v) =>
                set({
                  mode: v as Filters["mode"],
                  city: v === "ONLINE" ? undefined : filters.city,
                }),
            )}
            {select(
              "dir-city",
              t("dir.city"),
              filters.city,
              t("dir.anyCity"),
              (page?.cities ?? []).map((c) => ({ value: c, label: c })),
              (v) => set({ city: v }),
            )}
            <div className="grid gap-2">
              <Label htmlFor="dir-price">{t("dir.maxPrice")}</Label>
              <Input
                id="dir-price"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={filters.maxPrice ?? ""}
                onChange={(e) =>
                  set({
                    maxPrice:
                      e.target.value === ""
                        ? undefined
                        : Math.max(0, Math.floor(Number(e.target.value))),
                  })
                }
              />
            </div>
            {active && (
              <Button
                type="button"
                variant="link"
                className="justify-start px-0 sm:col-span-2 lg:col-span-5"
                onClick={() =>
                  set({
                    subject: undefined,
                    level: undefined,
                    mode: undefined,
                    city: undefined,
                    maxPrice: undefined,
                  })
                }
              >
                <X /> {t("dir.clearFilters")}
              </Button>
            )}
          </div>
        )}
      </Card>
      {error && <FormError>{error}</FormError>}
      {page && (
        <p className="text-muted-foreground -mb-2 text-sm" aria-live="polite">
          {t("dir.resultCount", { count: page.total })}
        </p>
      )}
      {/* Arama ve filtre değişince eski sonuçlar yenileri gelene kadar yerinde
          kalır; iskelet yalnızca ilk yüklemede çizilir (kartlar gidip
          gelmesin). */}
      <div
        aria-busy={loading}
        className={
          "grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3" +
          (loading && page ? " opacity-60" : "")
        }
      >
        {loading && !page ? (
          <CardSkeletons />
        ) : (
          items.map((teacher) => (
            <TeacherCard
              key={teacher.id}
              teacher={teacher}
              href={hrefFor?.(teacher.id)}
              onOpen={() => onOpen?.(teacher.id)}
              requestHref={hrefFor?.(teacher.id, true)}
              onRequest={() => onOpen?.(teacher.id, true)}
            />
          ))
        )}
      </div>
      {page && !items.length && !error && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundSearch />
            </EmptyMedia>
            <EmptyTitle className="text-base">{t("dir.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("dir.emptyText")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {page && items.length < page.total && !loading && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-center"
          disabled={more}
          onClick={() => void loadMore()}
        >
          {more && <Spinner />} {t("dir.loadMore")}
        </Button>
      )}
    </section>
  );
}

// --- Profil -----------------------------------------------------------------

export function ReviewList({ reviews }: { reviews: PublicReview[] }) {
  if (!reviews.length)
    return (
      <p className="text-muted-foreground text-sm">{t("dir.noReviews")}</p>
    );
  return (
    <ul className="grid gap-4">
      {reviews.map((r) => (
        <li key={r.id} className="grid gap-1.5 border-b pb-4 last:border-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars value={r.rating} />
            <strong className="text-sm">{r.authorName}</strong>
            <span className="text-muted-foreground text-xs">
              {shortDate(r.updatedAt)}
            </span>
          </div>
          {r.comment && <p className="text-sm leading-relaxed">{r.comment}</p>}
        </li>
      ))}
    </ul>
  );
}

function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className="flex gap-1"
      role="radiogroup"
      aria-label={t("dir.ratingLabel")}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={t("dir.stars", { count: i })}
          className="star-pick"
          onClick={() => onChange(i)}
        >
          <Star size={26} className={i <= value ? "star-on" : "star-off"} />
        </button>
      ))}
    </div>
  );
}

function ReviewForm({
  teacherId,
  review,
  onSaved,
}: {
  teacherId: string;
  review: PublicReview | null;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState(review?.rating ?? 0),
    [comment, setComment] = useState(review?.comment ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  async function save(remove = false) {
    if (!remove && !rating) {
      setError(t("dir.pickRating"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await backend(`/teacher-relations/${teacherId}/review/delete`, {});
        setRating(0);
        setComment("");
      } else
        await webRequest(
          `/api/backend/teacher-relations/${teacherId}/review`,
          { rating, comment },
          "PUT",
        );
      setDone(remove ? t("dir.reviewDeleted") : t("dir.reviewSaved"));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-3 rounded-lg border bg-(--surface-sunken)/50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm font-medium">
        {review ? t("dir.yourReview") : t("dir.writeReview")}
      </p>
      <StarPicker value={rating} onChange={setRating} />
      <div className="grid gap-2">
        <Label htmlFor="review-comment">{t("dir.commentLabel")}</Label>
        <Textarea
          id="review-comment"
          maxLength={500}
          rows={3}
          value={comment}
          placeholder={t("dir.commentPlaceholder")}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && <FormError>{error}</FormError>}
      {done && !error && <FormSuccess>{done}</FormSuccess>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {t("dir.saveReview")}
        </Button>
        {review && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void save(true)}
          >
            {t("dir.deleteReview")}
          </Button>
        )}
      </div>
    </form>
  );
}

function RequestDialog({
  teacher,
  open,
  onOpenChange,
  onSent,
}: {
  teacher: PublicTeacher;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [form, setForm] = useState<LessonRequestInput>({
      studentName: "",
      subject: teacher.subjects[0] ?? "general",
      level: "",
      phone: "",
      message: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const levels = teacher.levels.length ? teacher.levels : teacherLevels;
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dir.requestTitle")}</DialogTitle>
          <DialogDescription>
            {t("dir.requestText", { name: teacher.displayName })}
          </DialogDescription>
        </DialogHeader>
        <form
          id="lesson-request"
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await backend(`/teacher-relations/${teacher.id}/requests`, form);
              onSent();
              onOpenChange(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="req-name">{t("dir.studentName")}</Label>
            <Input
              id="req-name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              value={form.studentName}
              onChange={(e) =>
                setForm({ ...form, studentName: e.target.value })
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="req-subject">{t("dir.subjectLabel")}</Label>
              <Select
                value={form.subject}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    subject: v as LessonRequestInput["subject"],
                  })
                }
              >
                <SelectTrigger id="req-subject" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teacher.subjects.map((s) => (
                    <SelectItem key={s} value={s}>
                      {subjectName(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="req-level">{t("dir.levelLabel")}</Label>
              <Select
                value={form.level || ANY}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    level: (v === ANY ? "" : v) as LessonRequestInput["level"],
                  })
                }
              >
                <SelectTrigger id="req-level" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("dir.noLevel")}</SelectItem>
                  {levels.map((s) => (
                    <SelectItem key={s} value={s}>
                      {levelName(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="req-phone">{t("dir.phone")}</Label>
            <Input
              id="req-phone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="req-message">{t("dir.message")}</Label>
            <Textarea
              id="req-message"
              rows={4}
              maxLength={1000}
              placeholder={t("dir.messagePlaceholder")}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </div>
          {error && <FormError>{error}</FormError>}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="lesson-request" disabled={busy}>
            {busy ? <Spinner /> : <Send />}
            {t("dir.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Öğretmenin reddederken yazdığı not; öğrencinin gördüğü haliyle. */
function TeacherNote({ note }: { note: string }) {
  return (
    <div className="bg-muted/60 grid gap-1 rounded-lg px-3 py-2.5 text-sm">
      <span className="text-muted-foreground text-xs font-medium">
        {t("dir.teacherNote")}
      </span>
      <p className="whitespace-pre-line">{note}</p>
    </div>
  );
}

function ActionPanel({
  teacher,
  relation,
  signedIn,
  onChanged,
  onOpenLessons,
  onEditProfile,
  signInHref,
  openRequest = false,
}: {
  teacher: PublicTeacher;
  relation: TeacherRelation | null;
  signedIn: boolean;
  onChanged: () => void;
  onOpenLessons?: (workspaceId: string) => void;
  onEditProfile?: () => void;
  signInHref: string;
  /** Karttaki "İstek gönder"den gelindi: istek gönderilebiliyorsa pencere açık başlar. */
  openRequest?: boolean;
}) {
  const [dialog, setDialog] = useState(openRequest),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const request = relation?.request;
  // İstek penceresi yalnızca istek gönderilebilecek durumda açılır.
  const canRequest =
    !!relation &&
    !relation.isOwn &&
    !relation.isStudent &&
    request?.status !== "PENDING" &&
    !relation.retryAfter;
  const note =
    request?.status === "DECLINED" && request.decisionNote ? (
      <TeacherNote note={request.decisionNote} />
    ) : null;
  let body: React.ReactNode;
  if (!signedIn)
    body = (
      <Button asChild size="lg" className="w-full">
        <a href={signInHref}>
          <Send /> {t("dir.signInToRequest")}
        </a>
      </Button>
    );
  else if (!relation) body = <Skeleton className="h-10 w-full" />;
  else if (relation.isOwn)
    body = (
      <>
        <p className="text-muted-foreground text-sm">{t("dir.ownProfile")}</p>
        {onEditProfile && (
          <Button type="button" variant="outline" onClick={onEditProfile}>
            {t("dir.editProfile")}
          </Button>
        )}
      </>
    );
  else if (relation.isStudent)
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium text-(--ok)">
          <BadgeCheck size={18} /> {t("dir.alreadyStudent")}
        </p>
        {onOpenLessons && (
          <Button type="button" onClick={() => onOpenLessons(teacher.id)}>
            {t("dir.openLessons")}
          </Button>
        )}
      </>
    );
  else if (request?.status === "PENDING")
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Clock3 size={17} className="text-(--warn)" />
          {t("dir.pendingState")}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("dir.expiryHint", { days: REQUEST_EXPIRY_DAYS })}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await backend(`/requests/${request.id}/cancel`, {});
              setNotice(t("dir.cancelled"));
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />} {t("dir.cancelRequest")}
        </Button>
      </>
    );
  else if (relation.retryAfter)
    body = (
      <>
        <p className="text-muted-foreground text-sm">
          {t("dir.declinedState", { date: shortDate(relation.retryAfter) })}
        </p>
        {note}
      </>
    );
  else
    body = (
      <>
        {request?.status === "EXPIRED" && (
          <p className="text-muted-foreground text-sm">
            {t("dir.expiredState", { days: REQUEST_EXPIRY_DAYS })}
          </p>
        )}
        {note}
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => {
            setNotice("");
            setDialog(true);
          }}
        >
          <Send /> {t("dir.sendRequest")}
        </Button>
      </>
    );
  return (
    <Card className="grid gap-4 p-5">
      <Price teacher={teacher} large />
      {body}
      {error && <FormError>{error}</FormError>}
      {notice && <FormSuccess>{notice}</FormSuccess>}
      {signedIn && relation && (
        <RequestDialog
          key={String(dialog)}
          teacher={teacher}
          open={dialog && canRequest}
          onOpenChange={setDialog}
          onSent={() => {
            setNotice(t("dir.sent"));
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function Facts({ teacher }: { teacher: PublicTeacher }) {
  const row = (
    icon: React.ReactNode,
    label: string,
    value: React.ReactNode,
  ) => (
    <div className="grid gap-1.5">
      <dt className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        {icon} {label}
      </dt>
      <dd className="flex flex-wrap gap-1.5">{value}</dd>
    </div>
  );
  return (
    <dl className="grid gap-5 sm:grid-cols-2">
      {row(
        <GraduationCap size={14} />,
        t("dir.subjects"),
        teacher.subjects.map((s) => (
          <Badge key={s} variant="secondary">
            {subjectName(s)}
          </Badge>
        )),
      )}
      {teacher.levels.length > 0 &&
        row(
          <BadgeCheck size={14} />,
          t("dir.levels"),
          teacher.levels.map((s) => (
            <Badge key={s} variant="outline">
              {levelName(s)}
            </Badge>
          )),
        )}
      {row(
        <MonitorPlay size={14} />,
        t("dir.lessonModes"),
        teacher.lessonModes.map((s) => (
          <Badge key={s} variant="outline">
            {s === "IN_PERSON" && teacher.city
              ? `${modeName(s)} · ${teacher.city}`
              : modeName(s)}
          </Badge>
        )),
      )}
      {teacher.languages.length > 0 &&
        row(
          <Languages size={14} />,
          t("dir.languages"),
          teacher.languages.map((s) => (
            <Badge key={s} variant="outline">
              {langName(s)}
            </Badge>
          )),
        )}
    </dl>
  );
}

/** Öğretmenin profil sayfası: tanıtım, bilgiler, yorumlar ve istek düğmesi. */
export function TeacherProfileView({
  id,
  signedIn,
  onBack,
  backHref,
  onOpenLessons,
  onEditProfile,
  openRequest,
}: {
  id: string;
  signedIn: boolean;
  onBack?: () => void;
  backHref?: string;
  onOpenLessons?: (workspaceId: string) => void;
  onEditProfile?: () => void;
  /** Karttaki "İstek gönder"den gelindiyse istek penceresi açık başlar. */
  openRequest?: boolean;
}) {
  const [teacher, setTeacher] = useState<PublicTeacher | null>(null),
    [reviews, setReviews] = useState<PublicReview[]>([]),
    [relation, setRelation] = useState<TeacherRelation | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const [detail, rel] = await Promise.all([
        webRequest<{ data: PublicTeacher; reviews: PublicReview[] }>(
          `/api/public/teachers/${id}`,
        ),
        signedIn
          ? backend<{ data: TeacherRelation }>(`/teacher-relations/${id}`)
          : Promise.resolve(null),
      ]);
      setTeacher(detail.data);
      setReviews(detail.reviews);
      setRelation(rel?.data ?? null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, signedIn]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yükleyici durumu yalnızca istek bitince yazar.
    void reload();
  }, [reload]);
  const back = backHref ? (
    <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
      <a href={backHref}>
        <ArrowLeft /> {t("dir.back")}
      </a>
    </Button>
  ) : onBack ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-fit -ml-2"
      onClick={onBack}
    >
      <ArrowLeft /> {t("dir.back")}
    </Button>
  ) : null;
  if (loading)
    return (
      <section className="grid gap-6">
        {back}
        <Card className="gap-4 p-6" aria-busy="true">
          <div className="flex gap-5">
            <Skeleton className="size-24 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-24 w-full" />
        </Card>
      </section>
    );
  if (!teacher)
    return (
      <section className="grid gap-6">
        {back}
        <FormError>{error || t("api.teacherNotFound")}</FormError>
      </section>
    );
  return (
    <section className="grid gap-6">
      {back}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          <Card className="gap-6 p-6">
            <div className="flex flex-wrap items-center gap-5">
              <TeacherPhoto
                id={teacher.id}
                version={teacher.photoVersion}
                name={teacher.displayName}
                size={104}
              />
              <div className="grid min-w-0 gap-1.5">
                <h2 className="font-display text-2xl leading-tight font-extrabold sm:text-3xl">
                  {teacher.displayName}
                </h2>
                {teacher.headline && (
                  <p className="text-muted-foreground">{teacher.headline}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Rating teacher={teacher} />
                  {teacher.experienceYears !== null &&
                    teacher.experienceYears > 0 && (
                      <span className="text-muted-foreground text-sm">
                        {t("dir.experience", {
                          count: teacher.experienceYears,
                        })}
                      </span>
                    )}
                </div>
              </div>
            </div>
            <Facts teacher={teacher} />
            {teacher.bio && (
              <div className="grid gap-2 border-t pt-5">
                <h3 className="font-display text-lg font-bold">
                  {t("dir.about")}
                </h3>
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {teacher.bio}
                </p>
              </div>
            )}
          </Card>
          <Card className="gap-4 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-bold">
                {t("dir.reviews")}
              </h3>
              {teacher.ratingCount > 0 && (
                <span className="text-muted-foreground text-sm">
                  {t("dir.reviewCount", { count: teacher.ratingCount })}
                </span>
              )}
            </div>
            {relation?.canReview && (
              <ReviewForm
                key={relation.review?.updatedAt ?? "new"}
                teacherId={teacher.id}
                review={relation.review}
                onSaved={() => void reload()}
              />
            )}
            <ReviewList reviews={reviews} />
          </Card>
        </div>
        {/* Dar ekranda fiyat ve istek düğmesi en üstte; uzun tanıtımın altında kaybolmaz. */}
        <div className="order-first lg:sticky lg:top-6 lg:order-none">
          <ActionPanel
            teacher={teacher}
            relation={relation}
            signedIn={signedIn}
            onChanged={() => void reload()}
            onOpenLessons={onOpenLessons}
            onEditProfile={onEditProfile}
            signInHref={`/?teacher=${teacher.id}`}
            openRequest={openRequest}
          />
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
    </section>
  );
}

// --- Öğrencinin istekleri -----------------------------------------------------

export function MyRequests({
  onOpenTeacher,
  onOpenLessons,
  onBrowse,
  focusId,
}: {
  onOpenTeacher: (id: string) => void;
  onOpenLessons?: (workspaceId: string) => void;
  onBrowse: () => void;
  /** Bildirimden gelindiyse vurgulanan istek. */
  focusId?: string | null;
}) {
  const [items, setItems] = useState<MyLessonRequest[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const reload = useCallback(async () => {
    try {
      setItems((await backend<{ data: MyLessonRequest[] }>("/requests")).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yükleyici durumu yalnızca istek bitince yazar.
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!focusId || !items) return;
    document
      .querySelector(`[data-notice-target="${CSS.escape(focusId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, items]);
  if (!items)
    return error ? (
      <FormError>{error}</FormError>
    ) : (
      <div className="grid gap-3" aria-busy="true">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  if (!items.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Send />
          </EmptyMedia>
          <EmptyTitle className="text-base">{t("dir.noRequests")}</EmptyTitle>
          <EmptyDescription>{t("dir.findSubtitle")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" onClick={onBrowse}>
            <UserRoundSearch /> {t("dir.browse")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  return (
    <section className="grid gap-3">
      {error && <FormError>{error}</FormError>}
      {items.map((r) => (
        <Card
          key={r.id}
          data-notice-target={r.id}
          data-highlight={focusId === r.id}
          className="gap-3 p-5"
        >
          <div className="flex flex-wrap items-start gap-4">
            <TeacherPhoto
              id={r.workspaceId}
              version={r.teacherPhotoVersion}
              name={r.teacherName}
              size={48}
            />
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-display text-base">
                  {r.teacherName}
                </strong>
                <RequestStatusBadge status={r.status} />
              </div>
              <p className="text-muted-foreground text-sm">
                {subjectName(r.subject)}
                {r.level ? " · " + levelName(r.level) : ""} ·{" "}
                {t("dir.sentOn", { date: shortDate(r.createdAt) })}
              </p>
              {r.message && <p className="line-clamp-2 text-sm">{r.message}</p>}
            </div>
          </div>
          {r.status === "DECLINED" && r.decisionNote && (
            <TeacherNote note={r.decisionNote} />
          )}
          {r.status === "PENDING" && (
            <p className="text-muted-foreground text-sm">
              {t("dir.expiryHint", { days: REQUEST_EXPIRY_DAYS })}
            </p>
          )}
          {r.status === "EXPIRED" && (
            <p className="text-muted-foreground text-sm">
              {t("dir.expiredState", { days: REQUEST_EXPIRY_DAYS })}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {r.status === "ACCEPTED" && onOpenLessons && (
              <Button
                type="button"
                size="sm"
                onClick={() => onOpenLessons(r.workspaceId)}
              >
                {t("dir.openLessons")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenTeacher(r.workspaceId)}
            >
              {t("dir.viewTeacher")}
            </Button>
            {r.status === "PENDING" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy === r.id}
                onClick={async () => {
                  setBusy(r.id);
                  try {
                    await backend(`/requests/${r.id}/cancel`, {});
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === r.id && <Spinner />} {t("dir.cancelRequest")}
              </Button>
            )}
          </div>
        </Card>
      ))}
    </section>
  );
}

export { subjectName, levelName, modeName, langName };
