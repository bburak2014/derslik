import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@derslik/api-client";
import {
  addDays,
  cleanMessage,
  dateKey,
  dayLabel,
  lower,
  MESSAGE_MAX,
  senderLabel,
  t,
  threadTitle,
  timeAgo,
  timeLabel,
  unreadBadge,
  type ChatMessage,
  type MessageThread,
} from "@derslik/contracts";
import { request } from "./core";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorText,
  IconButton,
  Input,
  Kicker,
  List,
  ListRow,
  radius,
  ripple,
  SectionHeading,
  useTheme,
} from "./ui";

// Uygulama içi mesajlaşma: öğretmen ve portal (öğrenci, veli) aynı parçaları
// kullanır. Anlık bağlantı yok; açık yazışma 15 sn'de bir, liste ve sayaç
// dakikada bir yoklanır. Uygulama arka plandayken yoklama durur.

const THREAD_POLL = 15000,
  LIST_POLL = 60000;

type ThreadPage = {
  data: { thread: MessageThread; messages: ChatMessage[]; more: boolean };
};

/**
 * `task`'ı uygulama ön plandayken `ms` aralıkla çalıştırır. Uygulama arka
 * plana geçince zamanlayıcı durur, geri gelince görev hemen bir kez çalışır ve
 * zamanlayıcı yeniden kurulur. Görev her çizimde değişebilir; zamanlayıcı hep
 * son halini çağırır (eski kapanıştaki durumu okumaz).
 */
export function usePolling(task: () => unknown, ms: number, enabled = true) {
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void latest.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive"
    )
      start();
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") stop();
      else if (!timer) {
        void latest.current();
        start();
      }
    });
    return () => {
      stop();
      listener.remove();
    };
  }, [ms, enabled]);
}

/**
 * Yazışma listesi ve ekran durumu (açık yazışma, arama, okunmamış ve öğrenci
 * süzgeci). Liste sessizce yüklenir; ön plandayken dakikada bir ve uygulamaya
 * dönünce yenilenir. `badge` okunmamış mesaj sayacıdır (velinin yalnızca
 * okuduğu çocuk yazışması sayılmaz). `path` boşsa hiçbir şey yüklenmez.
 */
export function useMessages(path: string | null) {
  const [threads, setThreads] = useState<MessageThread[] | null>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(0),
    [open, setOpen] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [unreadOnly, setUnreadOnly] = useState(false),
    // Öğrenci dosyasından gelince yalnızca o öğrencinin (ve velilerinin)
    // yazışmaları; ada göre değil kimliğe göre süzülür.
    [studentFilter, setStudentFilter] = useState<{
      id: string;
      name: string;
    } | null>(null);
  // Üst üste binen isteklerde yalnızca en sonuncunun yanıtı yazılır.
  const seq = useRef(0),
    fetched = useRef(0),
    patched = useRef({ id: "", at: 0 });
  // Listeyi alır ve (en son istekse) yazar; hata fırlatır. Öğrenci dosyasındaki
  // düğme güncel listeyle karar verir.
  const reload = useCallback(async () => {
    if (!path) return [];
    const mine = ++seq.current;
    const r = await request<{ data: MessageThread[] }>(path);
    if (mine === seq.current) {
      fetched.current = Date.now();
      setThreads(r.data);
      setNow(fetched.current);
      setError("");
    }
    return r.data;
  }, [path]);
  // Sessiz yükleme: hata ekranda listenin üstünde görünür.
  const load = useCallback(async () => {
    const mine = seq.current + 1;
    try {
      await reload();
    } catch (e) {
      if (mine !== seq.current) return;
      setError((e as Error).message);
      setThreads((old) => old ?? []);
    }
  }, [reload]);
  useEffect(() => {
    void load();
  }, [load]);
  // Liste az önce (ör. aşağı çekip yenileyerek) alındıysa ya da tek satırını
  // açık yazışma zaten yokluyorsa (öğrencinin tek yazışması) bu tur atlanır.
  usePolling(
    () => {
      const recent = (at: number) => Date.now() - at < LIST_POLL / 2;
      if (
        recent(fetched.current) ||
        (threads?.length === 1 &&
          threads[0].linkId === patched.current.id &&
          recent(patched.current.at))
      )
        return;
      void load();
    },
    LIST_POLL,
    !!path,
  );
  // Açık yazışmanın yoklaması satırı elden günceller (son mesaj, okundu);
  // listeyi yeniden istemeye gerek kalmaz.
  const patch = useCallback((thread: MessageThread) => {
    patched.current = { id: thread.linkId, at: Date.now() };
    setThreads(
      (old) =>
        old?.map((x) => (x.linkId === thread.linkId ? thread : x)) ?? old,
    );
  }, []);
  return {
    path,
    threads,
    error,
    now,
    load,
    reload,
    patch,
    open,
    setOpen,
    search,
    setSearch,
    unreadOnly,
    setUnreadOnly,
    studentFilter,
    setStudentFilter,
    badge: unreadBadge(threads ?? []),
  };
}
export type MessagesState = ReturnType<typeof useMessages>;

/** Satır ve yazışma başlığındaki yuvarlak: öğrenci ya da öğretmen için baş
 *  harfler, veli yazışmasında veli simgesi (aynı öğrencinin satırları
 *  karışmasın diye). */
function ThreadAvatar({
  thread,
  size = 40,
}: {
  thread: MessageThread;
  size?: number;
}) {
  const { colors } = useTheme();
  if (thread.viewer === "OWNER" && thread.role === "GUARDIAN")
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.sunken,
        }}
      >
        <Ionicons
          name="people-outline"
          size={Math.round(size * 0.48)}
          color={colors.muted}
        />
      </View>
    );
  return (
    <Avatar
      name={thread.viewer === "SELF" ? thread.teacherName : thread.studentName}
      size={size}
    />
  );
}

/** Öğretmende veli yazışmasının e-posta adresi; aynı öğrencinin iki velisini
 *  ayırt etmeye yarar. Telefon numarası hiçbir yerde gösterilmez. */
const guardianEmail = (thread: MessageThread) =>
  thread.viewer === "OWNER" && thread.role === "GUARDIAN"
    ? thread.guardianEmail
    : null;

function ThreadRow({
  thread,
  now,
  divider,
  onPress,
}: {
  thread: MessageThread;
  now: number;
  divider: boolean;
  onPress: () => void;
}) {
  const { colors, styles } = useTheme();
  const title = threadTitle(thread),
    email = guardianEmail(thread),
    when = thread.lastAt ? timeAgo(thread.lastAt, now) : "",
    unread =
      thread.unread > 0 ? t("chat.unread", { count: thread.unread }) : "",
    preview = thread.lastBody
      ? (thread.lastMine ? t("chat.you") + ": " : "") +
        thread.lastBody.replace(/\s+/g, " ")
      : thread.canSend
        ? t("chat.emptyThread")
        : "";
  return (
    <ListRow
      divider={divider}
      onPress={onPress}
      accessibilityLabel={[title, email, unread, preview, when]
        .filter(Boolean)
        .join(", ")}
    >
      <ThreadAvatar thread={thread} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.h2, { flex: 1 }]} numberOfLines={1}>
            {title}
          </Text>
          {!!when && <Text style={styles.caption}>{when}</Text>}
        </View>
        {!!email && (
          <Text style={styles.caption} numberOfLines={1}>
            {email}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={[
              styles.muted,
              { flex: 1 },
              !!unread && { color: colors.text },
            ]}
            numberOfLines={1}
          >
            {preview}
          </Text>
          {!!unread && <Badge tone="info">{unread}</Badge>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.faint} />
    </ListRow>
  );
}

/** Okunmamış süzgeci: çip görünümünde onay kutusu. Görünen yükseklik 36 px,
 *  dokunma alanı hitSlop ile 44 px. */
function FilterChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors, section, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={{ top: 4, bottom: 4 }}
      android_ripple={ripple()}
      style={({ pressed }) => [
        section.pillTrigger,
        { alignSelf: "flex-start" },
        value && {
          borderColor: colors.brandLine,
          backgroundColor: colors.brandSoft,
        },
        pressed && !value && { backgroundColor: colors.sunken },
      ]}
    >
      <Ionicons
        name={value ? "checkmark" : "mail-unread-outline"}
        size={15}
        color={value ? colors.brand : colors.muted}
      />
      <Text
        style={[
          type.medium,
          section.pillText,
          { color: value ? colors.brand : colors.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Öğrenci süzgeci: öğrencinin adını taşıyan çip; dokununca süzgeç kalkar.
 *  Görünen yükseklik 36 px, dokunma alanı hitSlop ile 44 px. */
function StudentChip({ name, onClear }: { name: string; onClear: () => void }) {
  const { colors, section, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${t("dir.clearFilters")}`}
      onPress={onClear}
      hitSlop={{ top: 4, bottom: 4 }}
      android_ripple={ripple()}
      style={({ pressed }) => [
        section.pillTrigger,
        {
          alignSelf: "flex-start",
          maxWidth: "100%",
          borderColor: colors.brandLine,
          backgroundColor: pressed ? colors.sunken : colors.brandSoft,
        },
      ]}
    >
      <Ionicons name="person-outline" size={15} color={colors.brand} />
      <Text
        numberOfLines={1}
        style={[
          type.medium,
          section.pillText,
          { color: colors.brand, flexShrink: 1 },
        ]}
      >
        {name}
      </Text>
      <Ionicons name="close-circle" size={16} color={colors.brand} />
    </Pressable>
  );
}

/** "Telefon numaraları paylaşılmaz." notu. Metin `flex: 1` almaz: ortalanmış,
 *  içeriği kadar genişleyen kutuda sıfır genişliğe düşerdi. */
function PrivacyNote() {
  const { colors, styles } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Ionicons name="lock-closed-outline" size={14} color={colors.faint} />
      <Text style={[styles.caption, { flexShrink: 1 }]}>
        {t("chat.privacy")}
      </Text>
    </View>
  );
}

/**
 * Yazışma listesi. Öğretmende ada göre arama ve okunmamış süzgeci vardır;
 * erişimi kaldırılmış (kapalı) yazışmalar bir düğmenin arkasında toplanır.
 * Satıra dokununca `messages.setOpen` ile yazışma açılır.
 */
export function ThreadList({
  messages,
  viewer,
  kicker,
  inset = false,
}: {
  messages: MessagesState;
  viewer: "OWNER" | "STUDENT" | "GUARDIAN";
  /** Öğretmende başlığın üstündeki çalışma alanı adı. */
  kicker?: string;
  /** Altında sekme çubuğu yoksa alt güvenli alan kadar boşluk bırakılır. */
  inset?: boolean;
}) {
  const { colors, styles } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false),
    [showClosed, setShowClosed] = useState(false);
  const { threads, error, now, search, unreadOnly, studentFilter } = messages;
  const teacher = viewer === "OWNER";
  const needle = lower(search.trim());
  // Öğrenci süzgeci, arama ve okunmamış süzgeci birlikte uygulanır.
  const shown = (threads ?? []).filter(
    (x) =>
      (!studentFilter || x.studentId === studentFilter.id) &&
      (!needle ||
        lower(`${threadTitle(x)} ${x.studentName}`).includes(needle)) &&
      (!unreadOnly || x.unread > 0),
  );
  const open = shown.filter((x) => x.active),
    closed = shown.filter((x) => !x.active);
  const rows = (list: MessageThread[]) => (
    <List>
      {list.map((x, i) => (
        <ThreadRow
          key={x.linkId}
          thread={x}
          now={now}
          divider={i > 0}
          onPress={() => messages.setOpen(x.linkId)}
        />
      ))}
    </List>
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.brand}
          colors={[colors.brand]}
          onRefresh={() => {
            setRefreshing(true);
            void messages.load().finally(() => setRefreshing(false));
          }}
        />
      }
      contentContainerStyle={[
        styles.body,
        inset && { paddingBottom: 44 + insets.bottom },
      ]}
    >
      {teacher ? (
        <View style={{ gap: 6 }}>
          {!!kicker && <Kicker>{kicker}</Kicker>}
          <Text style={styles.title} accessibilityRole="header">
            {t("chat.title")}
          </Text>
          <Text style={styles.muted}>{t("chat.subtitleTeacher")}</Text>
        </View>
      ) : (
        <SectionHeading
          title={t("chat.title")}
          description={
            viewer === "STUDENT"
              ? t("chat.subtitleStudent")
              : t("chat.subtitleGuardian")
          }
        />
      )}
      <PrivacyNote />
      <ErrorText message={error} />
      {!threads ? (
        <ActivityIndicator
          color={colors.brand}
          accessibilityLabel={t("common.loading")}
          style={{ paddingVertical: 28 }}
        />
      ) : !threads.length ? (
        <EmptyState
          icon="chatbubbles-outline"
          title={teacher ? t("chat.emptyTeacherTitle") : t("chat.title")}
          description={
            teacher ? t("chat.emptyTeacherText") : t("chat.emptyPortal")
          }
        />
      ) : (
        <>
          {teacher && (
            <>
              {!!studentFilter && (
                <StudentChip
                  name={studentFilter.name}
                  onClear={() => messages.setStudentFilter(null)}
                />
              )}
              <Input
                icon="search"
                accessibilityLabel={t("chat.search")}
                placeholder={t("chat.search")}
                value={search}
                onChangeText={messages.setSearch}
                autoCorrect={false}
                returnKeyType="search"
              />
              <FilterChip
                label={t("chat.onlyUnread")}
                value={unreadOnly}
                onChange={messages.setUnreadOnly}
              />
            </>
          )}
          {!open.length && !closed.length && (
            <Text style={styles.muted}>{t("chat.noResults")}</Text>
          )}
          {!!open.length && rows(open)}
          {!!closed.length && (
            <Button
              variant="ghost"
              size="sm"
              icon={showClosed ? "chevron-up" : "chevron-down"}
              style={{ alignSelf: "flex-start", marginLeft: -10 }}
              onPress={() => setShowClosed((x) => !x)}
            >
              {showClosed
                ? t("chat.hideClosed")
                : t("chat.showClosed", { count: closed.length })}
            </Button>
          )}
          {showClosed && !!closed.length && rows(closed)}
        </>
      )}
    </ScrollView>
  );
}

/** Gün ayracı: Bugün, Dün, yoksa haftanın günüyle tarih (başka yılsa yıl da). */
function dayTitle(iso: string, now: number) {
  const day = dateKey(iso),
    today = dateKey(new Date(now));
  if (day === today) return t("common.today");
  if (day === addDays(today, -1)) return t("time.yesterday");
  return dayLabel(iso, {
    weekday: "long",
    year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  });
}

const byTime = (list: ChatMessage[]) =>
  [...list].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

/** Mesaj balonları ve gün ayraçları. Yazarken her tuşta yeniden çizilmesin
 *  diye ayrı ve memo'lu. */
const MessageItems = React.memo(function MessageItems({
  items,
  thread,
  now,
}: {
  items: ChatMessage[];
  thread: MessageThread;
  now: number;
}) {
  const { colors, styles } = useTheme();
  const list = items.map((m, i) => {
    const prev = items[i - 1],
      newDay = !prev || dateKey(prev.createdAt) !== dateKey(m.createdAt),
      // Aynı kişinin art arda mesajlarında ad bir kez yazılır.
      label =
        !m.mine && (newDay || prev.mine || prev.senderRole !== m.senderRole)
          ? senderLabel(m, thread)
          : "",
      time = timeLabel(m.createdAt);
    return (
      <React.Fragment key={m.id}>
        {newDay && (
          <Text
            accessibilityRole="header"
            style={[
              styles.caption,
              { alignSelf: "center", marginTop: i ? 10 : 0, marginBottom: 2 },
            ]}
          >
            {dayTitle(m.createdAt, now)}
          </Text>
        )}
        <View
          accessible
          accessibilityLabel={`${senderLabel(m, thread)}: ${m.body}, ${time}`}
          style={{
            alignSelf: m.mine ? "flex-end" : "flex-start",
            maxWidth: "86%",
            gap: 3,
            marginTop: label ? 6 : 0,
          }}
        >
          {!!label && (
            <Text style={[styles.caption, { marginLeft: 4 }]} numberOfLines={1}>
              {label}
            </Text>
          )}
          <View
            style={{
              paddingHorizontal: 12,
              paddingTop: 8,
              paddingBottom: 6,
              gap: 2,
              borderWidth: 1,
              borderRadius: radius.card,
              borderBottomRightRadius: m.mine ? 4 : radius.card,
              borderBottomLeftRadius: m.mine ? radius.card : 4,
              backgroundColor: m.mine ? colors.brandSoft : colors.surface,
              borderColor: m.mine ? colors.brandLine : colors.line,
            }}
          >
            <Text style={[styles.text, { color: colors.ink }]} selectable>
              {m.body}
            </Text>
            <Text style={[styles.caption, { alignSelf: "flex-end" }]}>
              {time}
            </Text>
          </View>
        </View>
      </React.Fragment>
    );
  });
  return <>{list}</>;
});

/** Kimlerin okuyabildiği: öğretmen ve öğrenci için öğrenci yazışmasını okuyan
 *  veli sayısı, yoksa "yalnızca ikiniz". */
function readersText(thread: MessageThread) {
  const count = thread.guardianReaders;
  if (thread.role === "STUDENT" && count > 0)
    return thread.viewer === "OWNER"
      ? t("chat.readersTeacher", { count })
      : t("chat.readersStudent", { count });
  return t("chat.readersNone");
}

/**
 * Bir yazışma: başlık, eskiden yeniye mesajlar, altta klavyenin üstünde
 * duran yazma alanı. Açılınca ve karşı taraftan yeni mesaj gelince okundu
 * bildirilir.
 *
 * Yerleşim: `KeyboardAvoidingView` klavyenin örttüğü payı kendi çerçevesine
 * göre hesaplar; çerçeve üst kenarı ekranın tepesinde olan bir kabın (ekranın
 * SafeAreaView'ı) doğrudan çocuğu olmalı. Alt güvenli alan kabın dışında,
 * klavyenin arkasında kalan ayrı bir boşluktur; böylece klavye açıkken yazma
 * alanının altında fazladan boşluk kalmaz.
 */
export function Conversation({
  path,
  linkId,
  initial,
  onBack,
  onUpdate,
  onRead,
}: {
  /** Liste adresi: `/workspaces/:ws/messages` ya da
   *  `/portal/:ws/:student/messages`. */
  path: string;
  linkId: string;
  /** Listeden gelen satır; başlık yüklemeyi beklemeden çizilir. */
  initial?: MessageThread;
  /** Verilmezse geri düğmesi çizilmez (öğrencinin tek yazışması). */
  onBack?: () => void;
  /** Her yoklamada yazışmanın güncel satırı (listeyi günceller). */
  onUpdate?: (thread: MessageThread) => void;
  /** Okundu bildirildikten sonra (zil sayacı yenilenir). */
  onRead?: () => void;
}) {
  const { colors, styles, section } = useTheme();
  const insets = useSafeAreaInsets();
  const url = `${path}/${linkId}`;
  const [thread, setThread] = useState<MessageThread | null>(initial ?? null),
    [items, setItems] = useState<ChatMessage[] | null>(null),
    [more, setMore] = useState(false),
    [olderBusy, setOlderBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(0),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [sendError, setSendError] = useState("");
  const callbacks = useRef({ onBack, onUpdate, onRead });
  useEffect(() => {
    callbacks.current = { onBack, onUpdate, onRead };
  });
  const known = useRef(new Set<string>()),
    loaded = useRef(false),
    seq = useRef(0),
    sendLock = useRef(false),
    olderLock = useRef(false),
    scroller = useRef<ScrollView>(null),
    // Kaydırma durumu: en altta mı, içerik ve görünür alan boyu, konum.
    atBottom = useRef(true),
    metrics = useRef({ content: 0, view: 0, y: 0 }),
    // Önceki mesajlar eklenince görünen mesaj yerinde kalsın diye eski içerik
    // boyu ve konum; yeni mesaj gelince yumuşak kaydırma isteği.
    keep = useRef<{ content: number; y: number } | null>(null),
    smooth = useRef(false);

  const markRead = useCallback(
    async (current: MessageThread) => {
      try {
        await request(url + "/read", {});
        callbacks.current.onUpdate?.({ ...current, unread: 0 });
        callbacks.current.onRead?.();
      } catch {
        // Okundu bilgisi bir sonraki açılışta yeniden gönderilir.
      }
    },
    [url],
  );

  // En yeni sayfayı alır ve elimizdekilerle birleştirir. Arada 50'den fazla
  // yeni mesaj varsa (uzun süre arka planda kalındıysa) liste yeni sayfayla
  // değişir, "Önceki mesajlar" düğmesi geri kalanı getirir.
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const page = (await request<ThreadPage>(url)).data;
      if (mine !== seq.current) return;
      setThread(page.thread);
      setNow(Date.now());
      setError("");
      callbacks.current.onUpdate?.(page.thread);
      const fresh = page.messages.filter((m) => !known.current.has(m.id));
      if (!loaded.current) {
        loaded.current = true;
        known.current = new Set(page.messages.map((m) => m.id));
        setItems(page.messages);
        setMore(page.more);
        void markRead(page.thread);
        return;
      }
      if (!fresh.length) return;
      if (page.more && fresh.length === page.messages.length) {
        known.current = new Set(page.messages.map((m) => m.id));
        setItems(page.messages);
        setMore(true);
      } else {
        for (const m of fresh) known.current.add(m.id);
        setItems((old) => byTime([...(old ?? []), ...fresh]));
      }
      if (atBottom.current) smooth.current = true;
      const incoming = fresh.filter((m) => !m.mine);
      if (incoming.length) {
        void markRead(page.thread);
        const last = incoming[incoming.length - 1];
        AccessibilityInfo.announceForAccessibility(
          incoming.length === 1
            ? `${senderLabel(last, page.thread)}: ${last.body}`
            : t("chat.unread", { count: incoming.length }),
        );
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
  }, [url, markRead]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void refresh();
  }, [refresh]);
  usePolling(refresh, THREAD_POLL);

  // Android geri tuşu yazışmadan listeye döner.
  const canGoBack = !!onBack;
  useEffect(() => {
    if (!canGoBack) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      callbacks.current.onBack?.();
      return true;
    });
    return () => listener.remove();
  }, [canGoBack]);

  async function loadOlder() {
    const oldest = items?.[0];
    if (!oldest || olderLock.current) return;
    olderLock.current = true;
    setOlderBusy(true);
    try {
      const page = (
        await request<ThreadPage>(
          `${url}?before=${encodeURIComponent(oldest.createdAt)}`,
        )
      ).data;
      const add = page.messages.filter((m) => !known.current.has(m.id));
      for (const m of add) known.current.add(m.id);
      setMore(page.more);
      if (add.length) {
        keep.current = {
          content: metrics.current.content,
          y: metrics.current.y,
        };
        setItems((old) => byTime([...add, ...(old ?? [])]));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      olderLock.current = false;
      setOlderBusy(false);
    }
  }

  const body = cleanMessage(draft),
    tooLong = body.length > MESSAGE_MAX;
  async function send() {
    const raw = draft;
    if (!thread?.canSend || !body || tooLong || sendLock.current) return;
    // Çift dokunuşta ikinci gönderim burada durur; düğme de kapanır.
    sendLock.current = true;
    setSending(true);
    setSendError("");
    try {
      const r = await request<{ data: { id: string; createdAt: string } }>(
        url,
        { body },
      );
      // Gönderim sürerken yazılan ek metin silinmez.
      setDraft((current) =>
        current.startsWith(raw)
          ? current.slice(raw.length).trimStart()
          : current,
      );
      if (!known.current.has(r.data.id)) {
        known.current.add(r.data.id);
        const own: ChatMessage = {
          id: r.data.id,
          senderRole: thread.viewer === "OWNER" ? "OWNER" : thread.role,
          mine: true,
          body,
          createdAt: r.data.createdAt,
        };
        setItems((old) => byTime([...(old ?? []), own]));
      }
      smooth.current = true;
      void refresh();
    } catch (e) {
      // Taslak yerinde kalır. Sunucunun açıkladığı hatalar (çok hızlı, kapalı
      // yazışma) olduğu gibi, bağlantı hataları genel metinle gösterilir.
      setSendError(
        e instanceof ApiError && e.status < 500 ? e.message : t("chat.failed"),
      );
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    metrics.current.y = contentOffset.y;
    atBottom.current =
      contentSize.height - contentOffset.y - layoutMeasurement.height < 48;
  };
  const onContentSizeChange = (_: number, height: number) => {
    metrics.current.content = height;
    const kept = keep.current;
    if (kept) {
      keep.current = null;
      scroller.current?.scrollTo({
        y: Math.max(0, kept.y + height - kept.content),
        animated: false,
      });
      return;
    }
    if (smooth.current) scroller.current?.scrollToEnd({ animated: true });
    else if (atBottom.current)
      scroller.current?.scrollToEnd({ animated: false });
    smooth.current = false;
  };
  // Klavye açılınca ya da yazma alanı uzayınca görünür alan küçülür; en
  // alttaysak son mesaj görünür kalır.
  const onLayout = (height: number) => {
    const was = metrics.current.view;
    metrics.current.view = height;
    if (was && height !== was && atBottom.current)
      scroller.current?.scrollToEnd({ animated: false });
  };

  const email = thread ? guardianEmail(thread) : null;
  const near = body.length >= MESSAGE_MAX - 200;
  return (
    <>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // Android'de uygulama kenardan kenara çizildiği için pencere klavyeyle
        // küçülmüyor; dolgu iki platformda da verilir. Pencere küçülürse
        // hesap kendiliğinden sıfır çıkar.
        behavior="padding"
      >
        <View
          style={[
            styles.header,
            { justifyContent: "flex-start", gap: 10 },
            !!onBack && { paddingLeft: 8 },
          ]}
        >
          {!!onBack && (
            <IconButton
              ghost
              icon="chevron-back"
              label={t("chat.back")}
              onPress={onBack}
            />
          )}
          {!!thread && <ThreadAvatar thread={thread} size={36} />}
          <View style={{ flex: 1, gap: 1 }}>
            <Text
              style={styles.h2}
              numberOfLines={1}
              accessibilityRole="header"
            >
              {thread ? threadTitle(thread) : t("chat.title")}
            </Text>
            {!!email && (
              <Text style={styles.caption} numberOfLines={1}>
                {email}
              </Text>
            )}
          </View>
        </View>
        {!!error && (
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            <ErrorText message={error} />
          </View>
        )}
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          // Kısa yazışma yazma alanının hemen üstünde durur.
          contentContainerStyle={{
            padding: 16,
            gap: 6,
            flexGrow: 1,
            justifyContent: "flex-end",
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollEventThrottle={32}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
        >
          {!!thread && thread.viewer !== "GUARDIAN_READ" && (
            <View
              style={{
                alignSelf: "center",
                maxWidth: 420,
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginBottom: 6,
                borderRadius: radius.control,
                backgroundColor: colors.sunken,
              }}
            >
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Ionicons
                  name="eye-outline"
                  size={14}
                  color={colors.muted}
                  style={{ marginTop: 1 }}
                />
                <Text
                  style={[
                    styles.caption,
                    { flexShrink: 1, color: colors.muted },
                  ]}
                >
                  {readersText(thread)}
                </Text>
              </View>
              <PrivacyNote />
            </View>
          )}
          {more && (
            <Button
              secondary
              size="sm"
              icon="arrow-up"
              loading={olderBusy}
              style={{ alignSelf: "center" }}
              onPress={() => void loadOlder()}
            >
              {t("chat.older")}
            </Button>
          )}
          {!items
            ? !error && (
                <ActivityIndicator
                  color={colors.brand}
                  accessibilityLabel={t("common.loading")}
                  style={{ paddingVertical: 28 }}
                />
              )
            : !items.length
              ? !!thread?.canSend && (
                  <Text
                    style={[
                      styles.muted,
                      { textAlign: "center", paddingVertical: 20 },
                    ]}
                  >
                    {t("chat.emptyThread")}
                  </Text>
                )
              : !!thread && (
                  <MessageItems items={items} thread={thread} now={now} />
                )}
          {!items && !!error && (
            <Button
              secondary
              size="sm"
              icon="refresh-outline"
              style={{ alignSelf: "center" }}
              onPress={() => void refresh()}
            >
              {t("common.retry")}
            </Button>
          )}
        </ScrollView>
        {!thread ? null : thread.canSend ? (
          <View
            style={{
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 10,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              backgroundColor: colors.surface,
            }}
          >
            <ErrorText message={sendError} />
            <View
              style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}
            >
              <Input
                multiline
                accessibilityLabel={t("chat.placeholder")}
                placeholder={t("chat.placeholder")}
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  if (sendError) setSendError("");
                }}
                maxLength={20000}
                invalid={tooLong}
                style={{
                  flex: 1,
                  minHeight: 48,
                  maxHeight: 140,
                  paddingTop: 12,
                }}
              />
              <Button
                icon="paper-plane-outline"
                loading={sending}
                disabled={!body || tooLong}
                onPress={() => void send()}
              >
                {t("chat.send")}
              </Button>
            </View>
            {near && (
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.caption,
                  { alignSelf: "flex-end", fontVariant: ["tabular-nums"] },
                  tooLong && { color: colors.danger },
                ]}
              >
                {t("chat.count", { count: body.length })}
              </Text>
            )}
          </View>
        ) : (
          <View style={[section.footer, { alignItems: "flex-start" }]}>
            <Ionicons
              name={
                thread.viewer === "GUARDIAN_READ"
                  ? "eye-outline"
                  : "lock-closed-outline"
              }
              size={18}
              color={colors.muted}
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.muted, { flex: 1 }]}>
              {thread.viewer === "GUARDIAN_READ"
                ? t("chat.readOnly")
                : t("chat.closed")}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
      <View
        style={{ height: insets.bottom, backgroundColor: colors.surface }}
      />
    </>
  );
}

/**
 * Portalın Mesajlar sekmesi. Tek yazışma varsa (öğrenci) doğrudan o açılır;
 * velide kendi yazışması ve çocuğunun okunabilen yazışması listelenir.
 * Sekmenin kaydırma alanı yerine çizilir, böylece yazma alanı altta sabit kalır.
 */
export function PortalMessages({
  messages,
  viewer,
}: {
  messages: MessagesState;
  viewer: "STUDENT" | "GUARDIAN";
}) {
  const { colors } = useTheme();
  const { threads, open, path } = messages;
  if (!path) return null;
  if (!threads)
    return (
      <ActivityIndicator
        color={colors.brand}
        accessibilityLabel={t("common.loading")}
        style={{ flex: 1 }}
      />
    );
  const single = threads.length === 1 ? threads[0].linkId : null,
    chosen = open ?? single;
  if (chosen)
    return (
      <Conversation
        key={chosen}
        path={path}
        linkId={chosen}
        initial={threads.find((x) => x.linkId === chosen)}
        onBack={chosen === single ? undefined : () => messages.setOpen(null)}
        onUpdate={messages.patch}
      />
    );
  return <ThreadList messages={messages} viewer={viewer} inset />;
}
