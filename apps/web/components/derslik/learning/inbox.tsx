"use client";
import { Subscription } from "@/components/account/subscription";
import { useEffect, useState } from "react";
import {
  noticeIcon,
  timeAgo,
  type NoticeIcon,
  noticeBody,
  noticeTarget,
  noticeText,
  intlLocale,
  t,
  type Notice,
  type NoticeTarget,
  type WorkspaceLimits,
} from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Bell,
  BellOff,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  MessageCircle,
  MessageSquare,
  Sparkles,
  Video as VideoIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/derslik/loading";
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
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormError } from "../feedback";

const noticeIcons: Record<NoticeIcon, React.ReactNode> = {
  question: <MessageSquare />,
  video: <VideoIcon />,
  summary: <Sparkles />,
  assignment: <ClipboardList />,
  lesson: <CalendarDays />,
  message: <MessageCircle />,
  other: <Bell />,
};

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
    [limits, setLimits] = useState<WorkspaceLimits | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    // Göreli zamanlar ("5 dk önce") liste yüklendiği andaki saate göre yazılır.
    [now, setNow] = useState(0);
  const unread = inbox.filter((n) => !n.readAt).length;
  // Zildeki sayaç için liste sayfa açılışında bir kez sessizce alınır; hata
  // olursa zil sayaçsız kalır, panel açıldığında yeniden denenir.
  // Bir yazışma okununca mesajlar görünümü "derslik:inbox" olayı gönderir;
  // o yazışmanın bildirimi sunucuda okundu sayıldığı için sayaç yenilenir.
  useEffect(() => {
    let alive = true;
    const load = () =>
      backend<{ data: Notice[] }>("/inbox")
        .then((r) => {
          if (!alive) return;
          setInbox(r.data);
          setNow(Date.now());
        })
        .catch(() => {});
    void load();
    window.addEventListener("derslik:inbox", load);
    return () => {
      alive = false;
      window.removeEventListener("derslik:inbox", load);
    };
  }, []);
  // İki istek paralel çalışır; panel son düzeni tutan bir iskeletle açılır.
  async function show() {
    setOpen(true);
    setError("");
    setLoading(true);
    try {
      const [inboxResult, limitsResult] = await Promise.all([
        backend<{ data: Notice[] }>("/inbox"),
        workspaceId
          ? backend<{ data: WorkspaceLimits }>(
              `/workspaces/${workspaceId}/settings/limits`,
            )
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
              {noticeIcons[noticeIcon(n)]}
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
                {/* Mesaj bildiriminde "Gönderen: önizleme" ayracı okuyanın
                    dilinde yeniden kurulur. */}
                {noticeBody(n)}
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-muted-foreground text-xs">
                  {timeAgo(n.createdAt, now)}
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
