"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ApiError, eventConcerns } from "@derslik/api-client";
import { useMessageEvents, useSocketLive } from "@/lib/message-socket";
import {
  MESSAGE_MAX,
  addDays,
  cleanMessage,
  dateKey,
  dayLabel,
  intlLocale,
  lower,
  messageLength,
  senderLabel,
  t,
  threadTitle,
  threadWithMessage,
  threadsWithMessage,
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
import { getChatDraft, setChatDraft } from "@/lib/chat-drafts";
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
// aynı bileşeni kullanır. Yeni mesaj soketle içeriğiyle anında gelir; ekrana
// ve listeye REST'e gidilmeden eklenir. İçeriksiz olayda (okundu, yeniden
// bağlanma) REST'ten yenilenir. Soket bağlıyken yoklama yoktur: kopan soket
// yeniden bağlanınca `resync` gelir, aradaki değişiklikler bir kez alınır.
// Soket kuruluyken ya da kopukken yoklama sürer (açık yazışma 15 sn, liste ve
// sayaçlar 60 sn), yalnızca sekme görünürken. Sekmeye dönünce her durumda bir
// kez yenilenir. Telefon numarası hiçbir yerde gösterilmez.

const LIST_POLL = 60_000,
  THREAD_POLL = 15_000,
  // Art arda gelen olaylar tek isteğe toplanır.
  EVENT_DELAY = 250,
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

/** Sekme görünürken `run`'ı aralıkla çalıştırır (`every` null ise aralık
 *  yoktur); sekmeye dönünce ve pencere odak alınca da hemen (ikisi art arda
 *  gelirse bir kez) çalıştırır. */
function useVisiblePoll(
  run: () => void,
  every: number | null,
  enabled = true,
) {
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
    const id = every === null ? null : setInterval(() => tick(true), every);
    const back = () => tick(false);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      if (id !== null) clearInterval(id);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [every, enabled]);
}

/** `run`'ı kısa bir gecikmeyle bir kez çalıştırır; gecikme içinde gelen
 *  çağrılar birleşir. */
function useCoalesced(run: () => void) {
  const latest = useRef(run),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, EVENT_DELAY);
  }, []);
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
  // Listenin son alındığı an ve açık yazışmanın satırı son elden güncellediği an.
  const fetched = useRef(0),
    patched = useRef({ id: "", at: 0 });
  const reload = useCallback(async () => {
    if (!path) return null;
    try {
      const r = await backend<{ data: MessageThread[] }>(path);
      fetched.current = Date.now();
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
  // Yazışmanın kimliğinden başka bir şey bilinmiyorsa liste, sayaç ve zil
  // yenilenir.
  const reloadAll = () => {
    void reload();
    window.dispatchEvent(new Event("derslik:inbox"));
  };
  const reloadSoon = useCoalesced(reloadAll);
  // Okundu olayı okunmamışı düşürür. Satır zaten okunmuş görünüyorsa (bu
  // sekmenin kendi okumasının yankısı) yenilenecek bir şey yoktur; karar,
  // okundu isteğinin yanıtı gelmiş olsun diye olaylar toplandıktan sonra verilir.
  const reads = useRef(new Set<string>());
  const readSoon = useCoalesced(() => {
    const linkIds = [...reads.current];
    reads.current.clear();
    const unread = (id: string) =>
      threads?.find((x) => x.linkId === id)?.unread !== 0;
    if (linkIds.some(unread)) reloadAll();
  });
  useMessageEvents((event) => {
    if (!path || !eventConcerns(path, event)) return;
    if (event.type === "resync") return reloadSoon();
    if (event.type === "read") {
      reads.current.add(event.thread);
      return readSoon();
    }
    const { message } = event;
    if (!message || !threads?.some((x) => x.linkId === event.thread))
      return reloadSoon();
    // Mesaj soketle geldi: satır elden güncellenir, liste yeniden istenmez.
    setThreads(
      (old) => (old && threadsWithMessage(old, event.thread, message)) ?? old,
    );
    // Karşı taraftan gelen mesaj zile bildirim ekler; kişinin kendi mesajı eklemez.
    if (!message.mine) window.dispatchEvent(new Event("derslik:inbox"));
  }, !!path);
  // Liste az önce alındıysa ya da tek satırını açık yazışma zaten yokluyorsa
  // (ör. öğrencinin tek yazışması açık) bu tur atlanır; aynı veri iki kez
  // istenmez. Soket bağlıyken aralıkla yoklanmaz.
  const live = useSocketLive();
  useVisiblePoll(
    () => {
      const recent = (at: number) => Date.now() - at < LIST_POLL / 2;
      if (
        recent(fetched.current) ||
        (threads?.length === 1 &&
          threads[0].linkId === patched.current.id &&
          recent(patched.current.at))
      )
        return;
      void reload();
    },
    live ? null : LIST_POLL,
    !!path,
  );
  /** Açık yazışmanın satırını günceller (okundu, son mesaj); listede yoksa
   *  (ör. bildirimden yeni açılan yazışma) başa ekler. */
  const upsert = useCallback(
    (linkId: string, change: Partial<MessageThread>) => {
      // Tam satır açık yazışmanın yoklamasından gelir.
      if (isThread(change)) patched.current = { id: linkId, at: Date.now() };
      setThreads((old) => {
        if (!old) return old;
        const row = old.find((x) => x.linkId === linkId);
        if (!row) return isThread(change) ? [change, ...old] : old;
        const keys = Object.keys(change) as (keyof MessageThread)[];
        if (keys.every((k) => row[k] === change[k])) return old;
        return old.map((x) => (x === row ? { ...x, ...change } : x));
      });
    },
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
function ChatAvatar({ thread }: Readonly<{ thread: MessageThread }>) {
  // Öğretmen veli yazışmasını simgeyle, diğerlerini karşı tarafın baş
  // harfleriyle görür; renk adın kendisinden gelir (öğrenci listesindeki gibi).
  const name =
    thread.viewer === "SELF" ? thread.teacherName : thread.studentName;
  const tint =
    tints[
      Array.from(name).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) %
        4
    ];
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
}: Readonly<{
  thread: MessageThread;
  selected: boolean;
  teacher: boolean;
  now: number;
  onOpen: (linkId: string) => void;
}>) {
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
              data-thread-row={x.linkId}
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
            {threadPreview(x)}
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

function threadPreview(x: MessageThread) {
  if (!x.lastBody) return "\u00a0";
  if (x.lastMine)
    return t("chat.preview", { name: t("chat.you"), text: x.lastBody });
  return x.lastBody;
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

/** Hiç yazışma yokken: öğretmene ve öğrenciye göre açıklama. */
function EmptyThreads({ teacher }: Readonly<{ teacher: boolean }>) {
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
}

/** Yazışma listesinin gövdesi: açık yazışmalar, açılır "kapalı" bölümü ve
 *  sonuç yoksa not. */
function ThreadListBody({
  loading,
  open,
  closed,
  noMatches,
  noAccount,
  showClosed,
  onToggleClosed,
  row,
}: Readonly<{
  loading: boolean;
  open: MessageThread[];
  closed: MessageThread[];
  noMatches: boolean;
  noAccount: boolean;
  showClosed: boolean;
  onToggleClosed: () => void;
  row: (x: MessageThread) => React.ReactNode;
}>) {
  if (loading) return <ListSkeleton />;
  return (
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
            onClick={onToggleClosed}
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
      {noMatches && (
        <p className="text-muted-foreground p-6 text-center text-sm">
          {noAccount ? t("chat.noAccount") : t("chat.noResults")}
        </p>
      )}
    </>
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
}: Readonly<{
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
}>) {
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
  const root = useRef<HTMLElement>(null),
    shown = useRef(selected);
  // Yazışmadan listeye dönülünce (dar ekranda "Yazışmalar" ya da geri tuşu)
  // yazışma bölmesi kalkar ve odak sayfaya düşer; odak o yazışmanın satırına
  // geçer. Odak başka bir yerdeyse (ör. arama kutusu) yerinde kalır.
  useEffect(() => {
    const prev = shown.current;
    shown.current = selected;
    if (!prev || selected) return;
    if (document.activeElement && document.activeElement !== document.body)
      return;
    root.current
      ?.querySelector<HTMLElement>(`[data-thread-row="${prev}"]`)
      ?.focus();
  }, [selected]);
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
    return <EmptyThreads teacher={teacher} />;

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
    <section
      ref={root}
      className="@container grid grid-cols-[minmax(0,1fr)] gap-3"
    >
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
              <ThreadListBody
                loading={!threads}
                open={open}
                closed={closed}
                noMatches={!matches.length}
                noAccount={!!student && !sorted.length}
                showClosed={showClosed}
                onToggleClosed={() => setShowClosed(!showClosed)}
                row={row}
              />
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
          ) : (
            <PickPlaceholder loading={!threads} />
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

/** Yazışma seçilmediğinde: liste yüklenirken iskelet, yüklenince "seçin" notu. */
function PickPlaceholder({ loading }: Readonly<{ loading: boolean }>) {
  if (loading) return <ListSkeleton />;
  return (
    <Empty className="text-muted-foreground">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircle />
        </EmptyMedia>
        <EmptyDescription>{t("chat.pick")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
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

/** Son sayfayı eldeki mesajlarla birleştirir. Son sayfanın en eski mesajı
 *  elde değilse (ör. uzun aradan sonra) arada mesaj kalmış olabilir; o zaman
 *  liste bu sayfayla değişir (`gap`). */
function nextPage(old: Page | null, fetched: Page, known: ReadonlySet<string>) {
  const oldest = fetched.messages[0];
  const gap =
    !!old?.messages.length && fetched.more && !!oldest && !known.has(oldest.id);
  const next: Page =
    !old || gap
      ? fetched
      : {
          thread: fetched.thread,
          messages: merge(old.messages, fetched.messages),
          more: old.more,
        };
  return { gap, next };
}

/** Yeni sayfadan sonra kaydırma: ilk açılışta ya da aralık kapanınca en alta;
 *  yeni mesaj varsa ve okuyucu en altta (ya da mesaj kendisinin) ise en alta,
 *  değilse yerinde kalır (null). Değişiklik yoksa undefined. */
function scrollAfterLatest(
  initial: boolean,
  gap: boolean,
  fresh: ChatMessage[],
  atBottom: boolean,
): "bottom" | null | undefined {
  if (initial || gap) return "bottom";
  if (!fresh.length) return undefined;
  return atBottom || fresh.some((m) => m.mine) ? "bottom" : null;
}

/** Ekran okuyucuya okunacak, karşı taraftan gelen yeni mesajlar. */
const announcement = (incoming: ChatMessage[], thread: MessageThread) =>
  incoming
    .map((m) =>
      t("chat.preview", { name: senderLabel(m, thread), text: m.body }),
    )
    .join("\n");

/** Sunucu isteği reddetti (4xx); bağlantı ve sunucu hataları (5xx) bunun
 *  dışındadır. */
const rejectedByServer = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status < 500;

/** Yazışma kapandı ya da erişim kalktı. */
const accessLost = (e: unknown) =>
  e instanceof ApiError && (e.status === 403 || e.status === 404);

type SendAttempt = { text: string; key: string };
/** Aynı metnin yeniden denemesi aynı anahtarla, yeni metin yeni anahtarla. */
const sendAttempt = (previous: SendAttempt | null, text: string) =>
  previous?.text === text ? previous : { text, key: crypto.randomUUID() };

/** Sunucunun kaydettiği mesaj, gönderenin ekranında gösterilecek biçimde. */
const sentMessage = (
  saved: { id: string; createdAt: string },
  text: string,
  thread: MessageThread,
): ChatMessage => ({
  id: saved.id,
  createdAt: saved.createdAt,
  body: text,
  mine: true,
  senderRole: thread.viewer === "OWNER" ? "OWNER" : thread.role,
});

function Conversation({
  base,
  linkId,
  summary,
  store,
  teacher,
  onBack,
  refreshAt,
}: Readonly<{
  base: string;
  linkId: string;
  /** Listedeki satır: yazışma yüklenirken başlık hemen görünür. */
  summary: MessageThread | null;
  store: ThreadStore;
  teacher: boolean;
  onBack?: () => void;
  refreshAt: number;
}>) {
  const path = `${base}/${linkId}`;
  const { upsert } = store;
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [problem, setProblem] = useState(""),
    [older, setOlder] = useState(false),
    // Yarım kalan metin yazışmanın yoluna göre saklanır (oturum kapanınca silinir).
    [draft, setDraft] = useState(() => getChatDraft(path) ?? ""),
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
    seenRefresh = useRef(refreshAt),
    // Başka yazışma açılınca bu bileşen kalkar; geç gelen yanıt okundu
    // göndermez, durumu değiştirmez.
    alive = useRef(true),
    // Gönderimin tekrar anahtarı: aynı metnin yeniden denemesi aynı anahtarla
    // gider (sunucu ikinci kez kaydetmez). Gönderilince ya da metin değişince
    // bırakılır; aynı metin sonradan ayrı bir mesaj olarak gönderilebilir.
    sendKey = useRef<SendAttempt | null>(null),
    // Aynı anda tek okundu isteği gider; sürerken yeni mesaj gösterildiyse
    // ardından o sayfayla bir kez daha gider.
    reading = useRef(false),
    readNext = useRef<Page | null>(null);
  const countId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    current.current = page;
  }, [page]);
  // Listeden açıldıysa odak yazışma başlığına geçer; dar ekranda liste
  // gizlendiğinde odak kaybolmaz, ekran okuyucu hangi yazışmada olduğunu söyler.
  useEffect(() => {
    if (document.activeElement?.closest("[data-chat-list]"))
      heading.current?.focus({ preventScroll: true });
  }, []);
  /** Yazışmayı ekranda gösterilen en yeni mesaja (`upTo`, sunucunun verdiği
   *  zaman olduğu gibi) kadar okundu sayar: arada gelen ama henüz
   *  gösterilmeyen mesaj okunmamış kalır. */
  const read = useCallback(
    async (shown: Page) => {
      if (!alive.current) return;
      if (reading.current) {
        readNext.current = shown;
        return;
      }
      reading.current = true;
      let next: Page | null = shown;
      try {
        while (next && alive.current) {
          readNext.current = null;
          const upTo = next.messages.at(-1)?.createdAt;
          // eslint-disable-next-line no-await-in-loop -- okundu istekleri sırayla gider: sonraki tur, bu istek sürerken ekrana gelen mesajla yeniden okur; aynı anda iki istek eskisinin yanıtıyla sayacı geri yazabilir.
          await backend(path + "/read", upTo ? { upTo } : {});
          upsert(linkId, { ...next.thread, unread: 0 });
          // Zildeki bildirim de okundu sayılmış olabilir; sayaç yenilensin.
          window.dispatchEvent(new Event("derslik:inbox"));
          next = readNext.current;
        }
      } catch {
        // Yazışma okunmamış kalır; sonraki yoklama yeniden dener.
      } finally {
        reading.current = false;
        readNext.current = null;
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
        if (!alive.current) return;
        const old = current.current;
        // Elde hiç mesaj yokken (ilk açılış ya da ilk açılış hata verdiyse
        // sonraki ilk yoklama) geçmişin tamamı "yeni" sayılmaz: ekran
        // okuyucuya okunmaz, en alta inilir, yazışma okundu sayılır.
        const initial = first || !old;
        const known = new Set(old?.messages.map((m) => m.id));
        const fresh = r.data.messages.filter((m) => !known.has(m.id));
        const { gap, next } = nextPage(old, r.data, known);
        const scrolled = scrollAfterLatest(
          initial,
          gap,
          fresh,
          atBottom.current,
        );
        if (scrolled !== undefined) scroll.current = scrolled;
        current.current = next;
        setPage(next);
        setClock(Date.now());
        setError("");
        const incoming = fresh.filter((m) => !m.mine);
        if (!initial && incoming.length)
          setAnnounce(announcement(incoming, r.data.thread));
        // Okundu isteği gitmediyse ya da sonradan mesaj geldiyse yazışma
        // okunmamış kalır; her yoklamada yeniden denenir.
        if (initial || incoming.length || r.data.thread.unread > 0)
          await read(next);
        else upsert(linkId, r.data.thread);
      } catch (e) {
        if (!alive.current) return;
        // Yoklama hatası (bağlantı) eldeki mesajları silmez; yazışma
        // kapandıysa ya da erişim kalktıysa gösterilir.
        if (first || !current.current || accessLost(e))
          setError((e as Error).message);
      }
    },
    [path, linkId, read, upsert],
  );
  useEffect(() => {
    void latest(true);
  }, [latest]);
  const live = useSocketLive();
  useVisiblePoll(() => void latest(false), live ? null : THREAD_POLL);
  // İçeriksiz olayda yazışma REST'ten yenilenir (okundu olayı listeyi
  // yeniler, yazışmayı değil).
  const latestSoon = useCoalesced(() => void latest(false));
  /** Soketten gelen yeni mesaj sayfaya eklenir; sayfa yeniden istenmez.
   *  Ekranda olan mesaj (bu sekme gönderdi) bir şey değiştirmez. */
  function receive(message: ChatMessage, old: Page) {
    if (old.messages.some((m) => m.id === message.id)) return;
    const next: Page = {
      ...old,
      thread: threadWithMessage(old.thread, message) ?? old.thread,
      messages: merge(old.messages, [message]),
    };
    const scrolled = scrollAfterLatest(
      false,
      false,
      [message],
      atBottom.current,
    );
    if (scrolled !== undefined) scroll.current = scrolled;
    current.current = next;
    setPage(next);
    setClock(Date.now());
    if (message.mine) return;
    setAnnounce(announcement([message], next.thread));
    void read(next);
  }
  useMessageEvents((event) => {
    if (event.type === "resync") return latestSoon();
    if (event.type !== "message" || event.thread !== linkId) return;
    // Sayfa henüz yüklenmediyse yükleme bu mesajı kaçırmış olabilir.
    if (event.message && current.current)
      receive(event.message, current.current);
    else latestSoon();
  });
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
      if (!alive.current) return;
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
      if (alive.current) setProblem((e as Error).message);
    } finally {
      if (alive.current) setOlder(false);
    }
  }
  function changeDraft(value: string) {
    setDraft(value);
    setChatDraft(path, value);
    // Metin değişti: bekleyen anahtar artık bu metne ait değil.
    if (sendKey.current && sendKey.current.text !== cleanMessage(value))
      sendKey.current = null;
  }
  // Karakterler veritabanı gibi sayılır: emoji tek karakter.
  const clean = cleanMessage(draft),
    length = messageLength(clean),
    over = length > MESSAGE_MAX;
  const info = page?.thread ?? summary;
  async function send() {
    const thread = page?.thread;
    if (sending || !clean || over || !thread?.canSend) return;
    const text = clean,
      typed = draft;
    // Aynı metnin yeniden denemesi aynı anahtarla, yeni metin yeni anahtarla.
    const attempt = sendAttempt(sendKey.current, text);
    sendKey.current = attempt;
    // Gönderilen metin taslaklardan çıkar: yanıt gelmeden başka yazışmaya
    // geçilip dönülürse kutuda yeniden görünüp ikinci kez gönderilmesin.
    setChatDraft(path, "");
    setSending(true);
    setProblem("");
    try {
      const r = await backend<{ data: { id: string; createdAt: string } }>(
        path,
        { body: text },
        attempt.key,
      );
      if (sendKey.current === attempt) sendKey.current = null;
      // Liste ortak: bu yazışmadan çıkılmış olsa da satırı güncellenir.
      upsert(linkId, {
        // Sunucunun listedeki önizlemesi gibi ilk 200 karakter.
        lastBody: Array.from(text).slice(0, 200).join(""),
        lastAt: r.data.createdAt,
        lastMine: true,
        unread: 0,
      });
      if (!alive.current) return;
      const mine = sentMessage(r.data, text, thread);
      scroll.current = "bottom";
      setPage((p) => (p ? { ...p, messages: merge(p.messages, [mine]) } : p));
      // Gönderim sürerken yeni bir şey yazıldıysa o kutuda kalır.
      if (getChatDraft(path) === undefined) setDraft("");
      input.current?.focus();
    } catch (e) {
      failSend(e, attempt, typed);
    } finally {
      if (alive.current) setSending(false);
    }
  }
  /** Gönderim hata verdi: anahtar ve taslak durumu düzeltilir, neden gösterilir. */
  function failSend(e: unknown, attempt: SendAttempt, typed: string) {
    // Sunucu metni geri çevirdi (4xx): sonraki deneme yeni anahtarla.
    // Bağlantı ya da sunucu hatasında anahtar korunur; metin belki kaydedildi.
    if (rejectedByServer(e) && sendKey.current === attempt)
      sendKey.current = null;
    // Metin taslaklara geri döner (bu arada yeni bir şey yazılmadıysa).
    if (getChatDraft(path) === undefined) setChatDraft(path, typed);
    if (!alive.current) return;
    // Metin kutuda kalır; kullanıcı yeniden gönderebilir. Sunucunun açık
    // nedeni (çok hızlı, kapalı yazışma) varsa o gösterilir.
    setProblem(rejectedByServer(e) ? e.message : t("chat.failed"));
    if (accessLost(e)) void latest(false);
  }

  const items = messageItems(page, info, clock);
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
      {readers && <ReadersNote readers={readers} />}
      <div
        ref={log}
        className="min-h-0 flex-1 overflow-y-auto bg-(--canvas) px-3 py-3 sm:px-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        <MessageThreadBody
          page={page}
          error={error}
          older={older}
          info={info}
          canWrite={canWrite}
          items={items}
          onRetry={() => void latest(true)}
          onLoadOlder={() => void loadOlder()}
        />
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
      {!info || !canWrite ? (
        <ComposerNote info={info} error={error} />
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
              onChange={(e) => changeDraft(e.target.value)}
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
              aria-describedby={length >= COUNT_FROM ? countId : undefined}
              aria-invalid={over || undefined}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none"
            />
            {/* Gönderim sürerken düğme yalnızca aria ile kapalı: disabled
                olsaydı odak düğmeden düşer, hata sonrası kaybolurdu. */}
            <Button
              type="submit"
              className="h-11 shrink-0"
              disabled={!clean || over || !page}
              aria-disabled={sending || undefined}
            >
              {sending ? <Spinner /> : <SendHorizontal />}
              <span className="max-sm:sr-only">{t("chat.send")}</span>
            </Button>
          </div>
          {length >= COUNT_FROM && (
            <CharacterCount id={countId} length={length} over={over} />
          )}
        </form>
      )}
    </>
  );
}

/** Gün ayraçları ve mesaj baloncukları; art arda aynı göndericinin
 *  mesajları tek başlıkla gruplanır. */
function messageItems(
  page: Page | null,
  info: MessageThread | null,
  clock: number,
) {
  const items: React.ReactNode[] = [];
  if (!page || !info) return items;
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
      <MessageBubble key={m.id} message={m} info={info} first={first} />,
    );
  }
  return items;
}

/** Tek mesaj; `first`, aynı göndericinin art arda mesajlarında ilkidir. */
function MessageBubble({
  message: m,
  info,
  first,
}: Readonly<{ message: ChatMessage; info: MessageThread; first: boolean }>) {
  return (
    <li
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
    </li>
  );
}

/** Yazışmayı kimlerin okuyabildiği (veli çocuğunun yazışmasını yalnızca okur). */
function ReadersNote({
  readers,
}: Readonly<{ readers: ReturnType<typeof readersText> }>) {
  return (
    <p className="text-muted-foreground bg-muted/40 flex items-start gap-2 border-b px-4 py-2 text-xs leading-relaxed">
      {readers.shared ? (
        <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      )}
      {readers.text}
    </p>
  );
}

/** Mesaj bölmesinin içeriği: yükleniyorsa iskelet ya da hata, yüklendiyse
 *  "öncekileri göster" düğmesi ve mesajlar. */
function MessageThreadBody({
  page,
  error,
  older,
  info,
  canWrite,
  items,
  onRetry,
  onLoadOlder,
}: Readonly<{
  page: Page | null;
  error: string;
  older: boolean;
  info: MessageThread | null;
  canWrite: boolean;
  items: React.ReactNode[];
  onRetry: () => void;
  onLoadOlder: () => void;
}>) {
  if (!page) return <PageFallback error={error} onRetry={onRetry} />;
  return (
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
            onClick={onLoadOlder}
          >
            {older ? <Spinner /> : <ChevronUp />}
            {t("chat.older")}
          </Button>
        </div>
      )}
      {page.messages.length ? (
        <ol aria-label={info ? threadTitle(info) : undefined} className="pb-1">
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
  );
}

/** Karakter sayacı; sınırı aşınca uyarı rengiyle. */
function CharacterCount({
  id,
  length,
  over,
}: Readonly<{ id: string; length: number; over: boolean }>) {
  return (
    <p
      id={id}
      className={cn(
        "text-right text-xs tabular-nums",
        over ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {t("chat.count", { count: length })}
    </p>
  );
}

/** Mesaj listesi gelene kadar: yükleme hatası (yeniden dene) ya da iskelet. */
function PageFallback({
  error,
  onRetry,
}: Readonly<{ error: string; onRetry: () => void }>) {
  if (error)
    return (
      <div className="grid justify-items-start gap-3 p-1">
        <FormError>{error}</FormError>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </div>
    );
  return (
    <div className="grid gap-3 p-1" aria-busy="true" aria-hidden="true">
      <Skeleton className="h-12 w-3/5 rounded-2xl" />
      <Skeleton className="h-16 w-2/3 justify-self-end rounded-2xl" />
      <Skeleton className="h-10 w-1/2 rounded-2xl" />
    </div>
  );
}

/** Yazma kutusunun yerine geçen not: tür bilinmiyorsa yer tutucu, veli
 *  yalnızca okuyabiliyorsa ya da yazışma kapalıysa açıklama. */
function ComposerNote({
  info,
  error,
}: Readonly<{ info: MessageThread | null; error: string }>) {
  if (!info) {
    // Yazışmanın türü henüz bilinmiyor (veli yalnızca okuyabilir, yazışma
    // kapalı olabilir): yazma kutusu yerine yer tutucu.
    if (error) return null;
    return (
      <div className="border-t p-3" aria-hidden="true">
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    );
  }
  if (info.viewer === "GUARDIAN_READ")
    return (
      <p className="text-muted-foreground flex items-start gap-2 border-t px-4 py-3 text-sm">
        <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t("chat.readOnly")}
      </p>
    );
  return (
    <p className="text-muted-foreground flex items-start gap-2 border-t px-4 py-3 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t("chat.closed")}
    </p>
  );
}
