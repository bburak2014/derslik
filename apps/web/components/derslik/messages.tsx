"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ApiError } from "@derslik/api-client";
import {
  MESSAGE_MAX,
  addDays,
  cleanMessage,
  dateKey,
  dayLabel,
  intlLocale,
  lower,
  senderLabel,
  t,
  threadTitle,
  timeAgo,
  timeLabel,
  unreadBadge,
  type ChatMessage,
  type MessageThread,
} from "@derslik/contracts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Eye,
  Lock,
  MessageCircle,
  Search,
  SendHorizontal,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "cn";
import { backend } from "@/lib/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { FormError } from "./feedback";
import { Skeleton, Spinner } from "./loading";

// Uygulama içi mesajlaşma: öğretmen çalışma alanı ve öğrenci/veli portalı
// aynı bileşeni kullanır. Websocket yok; açık yazışma 15 sn'de, liste ve
// sayaçlar 60 sn'de bir, yalnızca sekme görünürken yenilenir. Telefon numarası
// hiçbir yerde gösterilmez.

const LIST_POLL = 60_000,
  THREAD_POLL = 15_000,
  PAGE = 50,
  // Karakter sayacı sınıra yaklaşınca görünür.
  COUNT_FROM = MESSAGE_MAX - 200;

/** Listeden açılan yazışmanın history kaydı: "Yazışmalar" düğmesi yeni kayıt
 *  eklemek yerine tarayıcının geri adımıyla listeye döner. */
export const CHAT_FROM_LIST = { chatList: true };

/** Mesajlar görünümünün adresi: `?view=messages&thread=…&student=…`. */
export function chatSearch(
  thread: string | null,
  student: string | null = null,
) {
  const params = new URLSearchParams({ view: "messages" });
  if (thread) params.set("thread", thread);
  if (student) params.set("student", student);
  return "?" + params.toString();
}

const uuidLike =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Adresteki açık yazışma ve öğrenci süzgeci; kimlik biçiminde değilse yok sayılır. */
export function chatFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const id = (key: string) => {
    const value = params.get(key);
    return value && uuidLike.test(value) ? value : null;
  };
  return params.get("view") === "messages"
    ? { thread: id("thread"), student: id("student") }
    : { thread: null, student: null };
}

/** Yazışma değişince ya da görünüm kapanınca yarım kalan metin kaybolmasın. */
const drafts = new Map<string, string>();

/** Sekme görünürken `run`'ı aralıkla çalıştırır; sekmeye dönünce ve pencere
 *  odak alınca da hemen (ikisi art arda gelirse bir kez) çalıştırır. */
function useVisiblePoll(run: () => void, every: number, enabled = true) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    const tick = (force: boolean) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - last < 5000) return;
      last = Date.now();
      latest.current();
    };
    const id = setInterval(() => tick(true), every);
    const back = () => tick(false);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [every, enabled]);
}

/** Son mesajın zamanı; mesajı olmayan yazışma en sona. */
const lastTime = (x: MessageThread) =>
  x.lastAt ? Date.parse(x.lastAt) : -Infinity;

const isThread = (x: Partial<MessageThread>): x is MessageThread =>
  !!x.linkId && !!x.viewer;

/** Yazışma listesi ve okunmamış sayacı. Kenar çubuğundaki rozet ile mesajlar
 *  görünümü aynı listeyi kullanır; böylece tek istek iki yeri günceller.
 *  `path` boşsa (ör. portalda mesaj izni yoksa) hiç istek gitmez. */
export function useMessageThreads(path: string | null) {
  const [threads, setThreads] = useState<MessageThread[] | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!path) return null;
    try {
      const r = await backend<{ data: MessageThread[] }>(path);
      // Değişiklik yoksa eski dizi kalır; çalışma alanı boşuna yeniden çizilmez.
      setThreads((old) =>
        JSON.stringify(old) === JSON.stringify(r.data) ? old : r.data,
      );
      setError("");
      return r.data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [path]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- yükleyici durumu yalnızca istek bitince yazar.
    void reload();
  }, [reload]);
  useVisiblePoll(() => void reload(), LIST_POLL, !!path);
  /** Açık yazışmanın satırını günceller (okundu, son mesaj); listede yoksa
   *  (ör. bildirimden yeni açılan yazışma) başa ekler. */
  const upsert = useCallback(
    (linkId: string, change: Partial<MessageThread>) =>
      setThreads((old) => {
        if (!old) return old;
        const row = old.find((x) => x.linkId === linkId);
        if (!row) return isThread(change) ? [change, ...old] : old;
        const keys = Object.keys(change) as (keyof MessageThread)[];
        if (keys.every((k) => row[k] === change[k])) return old;
        return old.map((x) => (x === row ? { ...x, ...change } : x));
      }),
    [],
  );
  return {
    threads,
    error,
    reload,
    upsert,
    unread: threads ? unreadBadge(threads) : 0,
  };
}
export type ThreadStore = ReturnType<typeof useMessageThreads>;

const tints = ["sage", "peach", "lavender", "blue"];
function ChatAvatar({ thread }: { thread: MessageThread }) {
  // Öğretmen veli yazışmasını simgeyle, diğerlerini karşı tarafın baş
  // harfleriyle görür; renk adın kendisinden gelir (öğrenci listesindeki gibi).
  const name =
    thread.viewer === "SELF" ? thread.teacherName : thread.studentName;
  const tint =
    tints[Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4];
  if (thread.viewer === "OWNER" && thread.role === "GUARDIAN")
    return (
      <span className="avatar lavender" aria-hidden="true">
        <UsersRound className="size-4" />
      </span>
    );
  return (
    <span className={`avatar ${tint}`} aria-hidden="true">
      {name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((x) => Array.from(x)[0])
        .join("")
        .toLocaleUpperCase(intlLocale())}
    </span>
  );
}

function ThreadRow({
  thread: x,
  selected,
  teacher,
  now,
  onOpen,
}: {
  thread: MessageThread;
  selected: boolean;
  teacher: boolean;
  now: number;
  onOpen: (linkId: string) => void;
}) {
  const meta = useId();
  return (
    <Item
      role="listitem"
      size="sm"
      data-active={selected || undefined}
      className={cn(
        "relative flex-nowrap items-start gap-3 rounded-none border-0 px-4 py-3",
        // Seçili satır: avatarın marka tonuyla karışmasın diye nötr zemin ve
        // solda marka şeridi.
        selected
          ? "bg-muted shadow-[inset_3px_0_0_var(--brand)]"
          : "hover:bg-muted/60",
      )}
    >
      <ItemMedia>
        <ChatAvatar thread={x} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <div className="flex items-baseline gap-2">
          <ItemTitle className="block w-auto min-w-0 flex-1">
            {/* Ad düğmesi tüm satırı kaplar (bildirim listesindeki gibi). */}
            <button
              type="button"
              aria-current={selected || undefined}
              aria-describedby={meta}
              onClick={() => onOpen(x.linkId)}
              className={cn(
                "block w-full truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset",
                x.unread > 0 && "font-semibold",
              )}
            >
              {threadTitle(x)}
            </button>
          </ItemTitle>
          {x.lastAt && (
            <time
              dateTime={x.lastAt}
              className="text-muted-foreground shrink-0 text-xs tabular-nums"
            >
              {timeAgo(x.lastAt, now)}
            </time>
          )}
        </div>
        {teacher && x.guardianEmail && (
          <ItemDescription className="line-clamp-1 text-xs break-all">
            {x.guardianEmail}
          </ItemDescription>
        )}
        <div id={meta} className="flex items-center gap-2">
          <ItemDescription
            className={cn(
              "line-clamp-1 min-w-0 flex-1 break-all text-pretty",
              x.unread > 0 && "text-foreground",
            )}
          >
            {x.lastBody
              ? (x.lastMine ? t("chat.you") + ": " : "") + x.lastBody
              : " "}
          </ItemDescription>
          {x.unread > 0 && (
            <Badge
              // Velinin yalnızca okuduğu yazışma sayaca girmez; rozeti sönük.
              variant={x.viewer === "GUARDIAN_READ" ? "secondary" : "default"}
              className="h-5 min-w-5 px-1.5 tabular-nums"
            >
              <span aria-hidden="true">{x.unread > 99 ? "99+" : x.unread}</span>
              <span className="sr-only">
                {t("chat.unread", { count: x.unread })}
              </span>
            </Badge>
          )}
        </div>
      </ItemContent>
    </Item>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-5 p-4" aria-busy="true" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div className="flex gap-3" key={i}>
          <Skeleton className="size-10 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mesajlar sayfası: solda yazışmalar, sağda açık yazışma. Dar alanda tek
 *  bölme görünür; yazışmadan "Yazışmalar" düğmesiyle ya da tarayıcının geri
 *  tuşuyla listeye dönülür. Tek yazışması olan öğrenci doğrudan yazışmayı
 *  görür. Açık yazışma ve süzgeç adres çubuğundadır; adresi üst bileşen yazar. */
export function MessagesView({
  store,
  base,
  teacher = false,
  thread,
  onOpen,
  student = null,
  studentName,
  onClearStudent,
  refreshAt = 0,
}: {
  store: ThreadStore;
  /** Yazışma rotalarının kökü (…/messages). */
  base: string;
  /** Öğretmen görünümü: arama, okunmamış süzgeci ve veli e-postası. */
  teacher?: boolean;
  /** Açık yazışma (adresteki ?thread=). */
  thread: string | null;
  /** Yazışma açar; null listeye döner. */
  onOpen: (linkId: string | null) => void;
  /** Öğrenci dosyasından gelindiyse yalnızca o öğrencinin yazışmaları. */
  student?: string | null;
  studentName?: string;
  onClearStudent?: () => void;
  /** Bildirime her dokunuşta değişir; liste ve açık yazışma yeniden alınır. */
  refreshAt?: number;
}) {
  const { threads, error, reload } = store;
  const [query, setQuery] = useState(""),
    [onlyUnread, setOnlyUnread] = useState(false),
    [showClosed, setShowClosed] = useState(false),
    // Göreli zamanlar ("5 dk önce") dakikada bir ilerleyen saate göre yazılır.
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (refreshAt) void reload();
  }, [refreshAt, reload]);

  const single = !teacher && threads?.length === 1 ? threads[0].linkId : null;
  const selected = thread ?? single;
  const summary = threads?.find((x) => x.linkId === selected) ?? null;
  // Portalda liste gelene kadar bölmeler kurulmaz; tek yazışmalı öğrencide
  // liste hiç görünmez.
  const listPane = teacher || (!!threads && threads.length > 1);

  if (!threads && error && !selected)
    return (
      <div className="grid justify-items-start gap-3">
        <FormError>{error}</FormError>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  if (threads && !threads.length && !selected)
    return (
      <Empty className="bg-card border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircle />
          </EmptyMedia>
          <EmptyTitle className="text-base">
            {teacher ? t("chat.emptyTeacherTitle") : t("chat.title")}
          </EmptyTitle>
          <EmptyDescription>
            {teacher ? t("chat.emptyTeacherText") : t("chat.emptyPortal")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  const sorted = [...(threads ?? [])]
    .filter((x) => !student || x.studentId === student)
    // Sunucu sırası (son mesaj, ad) korunur; yeni gönderilen mesaj satırı başa alır.
    .sort((a, b) => lastTime(b) - lastTime(a) || 0);
  const q = lower(query.trim());
  const matches = sorted.filter(
    (x) =>
      (!onlyUnread || x.unread > 0) &&
      (!q || lower(threadTitle(x) + " " + x.studentName).includes(q)),
  );
  const open = matches.filter((x) => x.active),
    closed = matches.filter((x) => !x.active);
  const unread = unreadBadge(sorted);
  const row = (x: MessageThread) => (
    <ThreadRow
      key={x.linkId}
      thread={x}
      selected={x.linkId === selected}
      teacher={teacher}
      now={now}
      onOpen={onOpen}
    />
  );
  const back = () => {
    // Listeden açıldıysa tarayıcının geri adımı; bildirimden ya da doğrudan
    // adresle açıldıysa liste adresi.
    if ((window.history.state as typeof CHAT_FROM_LIST | null)?.chatList)
      window.history.back();
    else onOpen(null);
  };
  return (
    <section className="@container grid grid-cols-[minmax(0,1fr)] gap-3">
      <div
        className={cn(
          "bg-card grid h-[calc(100dvh-17rem)] min-h-[26rem] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl border shadow-sm",
          listPane
            ? "grid-cols-[minmax(0,1fr)] @2xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        {listPane && (
          <div
            data-chat-list
            className={cn(
              "flex min-h-0 flex-col @2xl:border-r",
              selected && "@max-2xl:hidden",
            )}
          >
            {teacher && (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b p-3">
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    aria-label={t("chat.search")}
                    placeholder={t("chat.search")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </InputGroup>
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle
                    variant="outline"
                    size="sm"
                    pressed={onlyUnread}
                    onPressedChange={setOnlyUnread}
                    className="px-2.5 data-[state=on]:border-(--brand-line) data-[state=on]:bg-(--brand-soft) data-[state=on]:text-(--brand-hover)"
                  >
                    {t("chat.onlyUnread")}
                    {unread > 0 && (
                      <Badge className="h-5 min-w-5 px-1.5 tabular-nums">
                        {unread}
                      </Badge>
                    )}
                  </Toggle>
                  {student && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="max-w-full min-w-0"
                      onClick={onClearStudent}
                    >
                      <span className="truncate">
                        {studentName || sorted[0]?.studentName}
                      </span>
                      <X aria-hidden="true" />
                      <span className="sr-only">{t("dir.clearFilters")}</span>
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!threads ? (
                <ListSkeleton />
              ) : (
                <>
                  {open.length > 0 && (
                    <ItemGroup className="divide-y">{open.map(row)}</ItemGroup>
                  )}
                  {closed.length > 0 && (
                    <div className={cn(open.length > 0 && "border-t")}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground m-2"
                        aria-expanded={showClosed}
                        onClick={() => setShowClosed(!showClosed)}
                      >
                        {showClosed ? <ChevronUp /> : <ChevronDown />}
                        {showClosed
                          ? t("chat.hideClosed")
                          : t("chat.showClosed", { count: closed.length })}
                      </Button>
                      {showClosed && (
                        <ItemGroup className="divide-y border-t opacity-80">
                          {closed.map(row)}
                        </ItemGroup>
                      )}
                    </div>
                  )}
                  {!matches.length && (
                    <p className="text-muted-foreground p-6 text-center text-sm">
                      {student && !sorted.length
                        ? t("chat.noAccount")
                        : t("chat.noResults")}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <div
          className={cn(
            "flex min-h-0 flex-col",
            !selected && listPane && "@max-2xl:hidden",
          )}
        >
          {selected ? (
            <Conversation
              key={selected}
              base={base}
              linkId={selected}
              summary={summary}
              store={store}
              teacher={teacher}
              onBack={listPane ? back : undefined}
              refreshAt={refreshAt}
            />
          ) : !threads ? (
            <ListSkeleton />
          ) : (
            <Empty className="text-muted-foreground">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircle />
                </EmptyMedia>
                <EmptyDescription>{t("chat.pick")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
        {t("chat.privacy")}
      </p>
    </section>
  );
}

type Page = { thread: MessageThread; messages: ChatMessage[]; more: boolean };

/** Mesajları zamana (eşitse kimliğe) göre sıralı tek listede birleştirir. */
function merge(a: ChatMessage[], b: ChatMessage[]) {
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort(
    (x, y) =>
      Date.parse(x.createdAt) - Date.parse(y.createdAt) ||
      (x.id < y.id ? -1 : 1),
  );
}

/** Gün ayracı: Bugün, Dün, yoksa gün adıyla tarih (başka yılsa yılıyla). */
function dayName(iso: string, clock: number) {
  const key = dateKey(iso),
    today = dateKey(new Date(clock));
  if (key === today) return t("common.today");
  if (key === addDays(today, -1)) return t("time.yesterday");
  return dayLabel(iso, {
    weekday: "long",
    ...(key.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  });
}

/** Yazışmayı kimlerin okuyabildiği; veli çocuğunun yazışmasını yalnızca okur. */
function readersText(thread: MessageThread) {
  if (thread.role === "STUDENT" && thread.guardianReaders > 0)
    return {
      shared: true,
      text: t(
        thread.viewer === "OWNER"
          ? "chat.readersTeacher"
          : "chat.readersStudent",
        { count: thread.guardianReaders },
      ),
    };
  return { shared: false, text: t("chat.readersNone") };
}

function Conversation({
  base,
  linkId,
  summary,
  store,
  teacher,
  onBack,
  refreshAt,
}: {
  base: string;
  linkId: string;
  /** Listedeki satır: yazışma yüklenirken başlık hemen görünür. */
  summary: MessageThread | null;
  store: ThreadStore;
  teacher: boolean;
  onBack?: () => void;
  refreshAt: number;
}) {
  const path = `${base}/${linkId}`;
  const { upsert } = store;
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [problem, setProblem] = useState(""),
    [older, setOlder] = useState(false),
    [draft, setDraftState] = useState(() => drafts.get(linkId) ?? ""),
    [sending, setSending] = useState(false),
    // Ekran okuyucuya yalnızca yeni gelen mesajlar okunur.
    [announce, setAnnounce] = useState(""),
    [clock, setClock] = useState(() => Date.now());
  const log = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    current = useRef<Page | null>(null),
    // Liste değişince: en alta in, önceki mesajlar eklendiyse yerinde kal.
    scroll = useRef<"bottom" | { height: number; top: number } | null>(
      "bottom",
    ),
    atBottom = useRef(true),
    seenRefresh = useRef(refreshAt);
  const countId = useId();
  useEffect(() => {
    current.current = page;
  }, [page]);
  // Listeden açıldıysa odak yazışma başlığına geçer; dar ekranda liste
  // gizlendiğinde odak kaybolmaz, ekran okuyucu hangi yazışmada olduğunu söyler.
  useEffect(() => {
    if (document.activeElement?.closest("[data-chat-list]"))
      heading.current?.focus({ preventScroll: true });
  }, []);
  const read = useCallback(
    async (thread: MessageThread) => {
      try {
        await backend(path + "/read", {});
        upsert(linkId, { ...thread, unread: 0 });
        // Zildeki bildirim de okundu sayıldı; sayaç yenilensin.
        window.dispatchEvent(new Event("derslik:inbox"));
      } catch {
        // Okundu bilgisi bir sonraki açılışta ya da yoklamada yeniden gider.
      }
    },
    [path, linkId, upsert],
  );
  /** Son sayfayı alır ve eldekilerle birleştirir. Açılışta ve karşı taraftan
   *  yeni mesaj geldiğinde yazışma okundu sayılır. */
  const latest = useCallback(
    async (first: boolean) => {
      try {
        const r = await backend<{ data: Page }>(`${path}?limit=${PAGE}`);
        const old = current.current;
        const known = new Set(old?.messages.map((m) => m.id));
        const fresh = r.data.messages.filter((m) => !known.has(m.id));
        // Son sayfanın hiçbiri elde değilse arada mesaj kalmış olabilir;
        // o zaman eldekiler bırakılır.
        const gap =
          !!old?.messages.length &&
          r.data.more &&
          fresh.length === r.data.messages.length;
        const next: Page =
          !old || gap
            ? r.data
            : {
                thread: r.data.thread,
                messages: merge(old.messages, r.data.messages),
                more: old.more,
              };
        if (first || gap) scroll.current = "bottom";
        else if (fresh.length)
          scroll.current =
            atBottom.current || fresh.some((m) => m.mine) ? "bottom" : null;
        current.current = next;
        setPage(next);
        setClock(Date.now());
        setError("");
        const incoming = fresh.filter((m) => !m.mine);
        if (!first && incoming.length)
          setAnnounce(
            incoming
              .map((m) => senderLabel(m, r.data.thread) + ": " + m.body)
              .join("\n"),
          );
        if (first || incoming.length) await read(r.data.thread);
        else upsert(linkId, r.data.thread);
      } catch (e) {
        // Yoklama hatası (bağlantı) eldeki mesajları silmez; yazışma
        // kapandıysa ya da erişim kalktıysa gösterilir.
        if (
          first ||
          !current.current ||
          (e instanceof ApiError && (e.status === 403 || e.status === 404))
        )
          setError((e as Error).message);
      }
    },
    [path, linkId, read, upsert],
  );
  useEffect(() => {
    void latest(true);
  }, [latest]);
  useVisiblePoll(() => void latest(false), THREAD_POLL);
  useEffect(() => {
    if (!refreshAt || refreshAt === seenRefresh.current) return;
    seenRefresh.current = refreshAt;
    void latest(false);
  }, [refreshAt, latest]);
  useLayoutEffect(() => {
    const el = log.current,
      how = scroll.current;
    if (!el || !how || !page) return;
    scroll.current = null;
    el.scrollTop =
      how === "bottom"
        ? el.scrollHeight
        : el.scrollHeight - how.height + how.top;
  }, [page]);
  // field-sizing desteklemeyen tarayıcılarda metin alanı içeriğe göre uzar.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);

  async function loadOlder() {
    const now = current.current;
    if (!now?.messages.length || older) return;
    setOlder(true);
    setProblem("");
    try {
      const r = await backend<{ data: Page }>(
        `${path}?limit=${PAGE}&before=${encodeURIComponent(now.messages[0].createdAt)}`,
      );
      const el = log.current;
      scroll.current = el
        ? { height: el.scrollHeight, top: el.scrollTop }
        : null;
      setPage((p) =>
        p
          ? {
              thread: p.thread,
              messages: merge(r.data.messages, p.messages),
              more: r.data.more,
            }
          : p,
      );
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setOlder(false);
    }
  }
  function setDraft(value: string) {
    setDraftState(value);
    if (value) drafts.set(linkId, value);
    else drafts.delete(linkId);
  }
  const clean = cleanMessage(draft),
    over = clean.length > MESSAGE_MAX;
  const info = page?.thread ?? summary;
  async function send() {
    if (sending || !clean || over || !page?.thread.canSend) return;
    setSending(true);
    setProblem("");
    try {
      const r = await backend<{ data: { id: string; createdAt: string } }>(
        path,
        { body: clean },
      );
      const mine: ChatMessage = {
        id: r.data.id,
        createdAt: r.data.createdAt,
        body: clean,
        mine: true,
        senderRole: page.thread.viewer === "OWNER" ? "OWNER" : page.thread.role,
      };
      scroll.current = "bottom";
      setPage((p) => (p ? { ...p, messages: merge(p.messages, [mine]) } : p));
      setDraft("");
      upsert(linkId, {
        lastBody: clean.slice(0, 200),
        lastAt: r.data.createdAt,
        lastMine: true,
        unread: 0,
      });
      input.current?.focus();
    } catch (e) {
      // Metin kutuda kalır; kullanıcı yeniden gönderebilir. Sunucunun açık
      // nedeni (çok hızlı, kapalı yazışma) varsa o gösterilir.
      setProblem(
        e instanceof ApiError && e.status < 500 ? e.message : t("chat.failed"),
      );
      if (e instanceof ApiError && (e.status === 403 || e.status === 404))
        void latest(false);
    } finally {
      setSending(false);
    }
  }

  const items: React.ReactNode[] = [];
  if (page && info) {
    let day = "",
      who = "";
    for (const m of page.messages) {
      const key = dateKey(m.createdAt);
      if (key !== day) {
        day = key;
        who = "";
        items.push(
          <li
            key={"day-" + key}
            className="text-muted-foreground before:bg-border after:bg-border my-3 flex items-center gap-3 text-xs font-medium before:h-px before:flex-1 after:h-px after:flex-1"
          >
            {dayName(m.createdAt, clock)}
          </li>,
        );
      }
      const sender = m.mine ? "me" : m.senderRole;
      const first = sender !== who;
      who = sender;
      items.push(
        <li
          key={m.id}
          className={cn(
            "flex flex-col",
            m.mine ? "items-end" : "items-start",
            first ? "mt-3" : "mt-1",
          )}
        >
          <span
            className={cn(
              "text-muted-foreground px-1 pb-1 text-xs font-medium",
              (m.mine || !first) && "sr-only",
            )}
          >
            {senderLabel(m, info)}
          </span>
          <div
            className={cn(
              "max-w-[85%] rounded-2xl border px-3.5 pt-2 pb-1.5 text-sm leading-relaxed @lg:max-w-[75%]",
              m.mine
                ? "border-(--brand-line) bg-(--brand-soft) text-(--ink) rounded-br-md"
                : "bg-card text-card-foreground rounded-bl-md",
            )}
          >
            <p className="wrap-anywhere whitespace-pre-wrap">{m.body}</p>
            <time
              dateTime={m.createdAt}
              className="text-muted-foreground mt-0.5 block text-right text-[11px] tabular-nums"
            >
              {timeLabel(m.createdAt)}
            </time>
          </div>
        </li>,
      );
    }
  }
  const readers = info && info.viewer !== "GUARDIAN_READ" && readersText(info);
  const canWrite = !!info && info.viewer !== "GUARDIAN_READ" && info.canSend;
  return (
    <>
      <header className="flex min-h-16 items-center gap-3 border-b px-4 py-3">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 shrink-0 @2xl:hidden"
            onClick={onBack}
          >
            <ChevronLeft />
            {t("chat.back")}
          </Button>
        )}
        {/* Dar alanda geri düğmesi varken avatar gizlenir; ad iki satıra
            kadar sığar. */}
        {info && (
          <span className={cn("contents", onBack && "@max-2xl:hidden")}>
            <ChatAvatar thread={info} />
          </span>
        )}
        <div className="grid min-w-0 flex-1">
          <h2
            ref={heading}
            tabIndex={-1}
            className="line-clamp-2 text-base leading-snug font-semibold tracking-tight break-words outline-none"
          >
            {info ? threadTitle(info) : " "}
          </h2>
          {teacher && info?.guardianEmail && (
            <p className="text-muted-foreground truncate text-xs">
              {info.guardianEmail}
            </p>
          )}
        </div>
      </header>
      {readers && (
        <p className="text-muted-foreground bg-muted/40 flex items-start gap-2 border-b px-4 py-2 text-xs leading-relaxed">
          {readers.shared ? (
            <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          {readers.text}
        </p>
      )}
      <div
        ref={log}
        className="min-h-0 flex-1 overflow-y-auto bg-(--canvas) px-3 py-3 sm:px-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        {error && !page ? (
          <div className="grid justify-items-start gap-3 p-1">
            <FormError>{error}</FormError>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void latest(true)}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : !page ? (
          <div className="grid gap-3 p-1" aria-busy="true" aria-hidden="true">
            <Skeleton className="h-12 w-3/5 rounded-2xl" />
            <Skeleton className="h-16 w-2/3 justify-self-end rounded-2xl" />
            <Skeleton className="h-10 w-1/2 rounded-2xl" />
          </div>
        ) : (
          <>
            {error && <FormError>{error}</FormError>}
            {page.more && (
              <div className="flex justify-center pt-1 pb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-card"
                  disabled={older}
                  onClick={() => void loadOlder()}
                >
                  {older ? <Spinner /> : <ChevronUp />}
                  {t("chat.older")}
                </Button>
              </div>
            )}
            {page.messages.length ? (
              <ol
                aria-label={info ? threadTitle(info) : undefined}
                className="pb-1"
              >
                {items}
              </ol>
            ) : (
              canWrite && (
                <p className="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm">
                  {t("chat.emptyThread")}
                </p>
              )
            )}
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
      {info && info.viewer === "GUARDIAN_READ" ? (
        <p className="text-muted-foreground flex items-start gap-2 border-t px-4 py-3 text-sm">
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("chat.readOnly")}
        </p>
      ) : info && !info.canSend ? (
        <p className="text-muted-foreground flex items-start gap-2 border-t px-4 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("chat.closed")}
        </p>
      ) : (
        <form
          className="bg-card grid grid-cols-[minmax(0,1fr)] gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {problem && <FormError>{problem}</FormError>}
          <div className="flex items-end gap-2">
            <Textarea
              ref={input}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key !== "Enter" ||
                  e.shiftKey ||
                  e.nativeEvent.isComposing
                )
                  return;
                // Dokunmatik klavyede Enter satır başıdır; gönderme düğmeyle.
                if (window.matchMedia("(pointer: coarse)").matches) return;
                e.preventDefault();
                void send();
              }}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              aria-describedby={
                clean.length >= COUNT_FROM ? countId : undefined
              }
              aria-invalid={over || undefined}
              disabled={!info}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none"
            />
            <Button
              type="submit"
              className="h-11 shrink-0"
              disabled={sending || !clean || over || !page}
            >
              {sending ? <Spinner /> : <SendHorizontal />}
              <span className="max-sm:sr-only">{t("chat.send")}</span>
            </Button>
          </div>
          {clean.length >= COUNT_FROM && (
            <p
              id={countId}
              className={cn(
                "text-right text-xs tabular-nums",
                over ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {t("chat.count", { count: clean.length })}
            </p>
          )}
        </form>
      )}
    </>
  );
}
