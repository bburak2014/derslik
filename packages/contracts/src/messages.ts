import { z } from "zod";
import { t } from "./i18n/index.ts";

// Uygulama içi mesajlaşma: öğretmen bağlı her hesapla (öğrenci hesabı ve her
// veli hesabı) ayrı yazışır; telefon numarası paylaşılmaz. Bir yazışma bir
// portal bağlantısıdır, kimliği bağlantının kimliğidir. Paylaşımlara erişimi
// olan veli, çocuğunun öğretmenle yazışmasını okuyabilir, yazamaz.

/** Bir mesajın en fazla karakter sayısı. */
export const MESSAGE_MAX = 2000;

/** Satır sonlarını `\n` yapar, `\n` ve `\t` dışındaki denetim karakterlerini
 *  atar, baştaki ve sondaki boşluğu kırpar. Sunucu ve istemciler aynı kuralı
 *  kullanır; sayaç temizlenmiş metni sayar. */
export function cleanMessage(text: string): string {
  let out = "";
  for (const c of text.replace(/\r\n?/g, "\n")) {
    const code = c.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || (code > 31 && (code < 127 || code > 159)))
      out += c;
  }
  return out.trim();
}

/** Karakter sayısı: emoji gibi iki kod birimli karakterler bir sayılır
 *  (veritabanındaki `char_length` gibi). Sayaçlar da bunu kullanır. */
export function messageLength(text: string): number {
  return [...text].length;
}

export const messageSchema = z.object({
  body: z
    .string()
    .max(20000)
    .transform(cleanMessage)
    .pipe(
      z
        .string()
        .min(1)
        .refine((body) => messageLength(body) <= MESSAGE_MAX),
    ),
});

/** Çağıranın yazışmadaki yeri: öğretmen, yazışmanın kendi tarafı ya da
 *  çocuğunun yazışmasını yalnızca okuyan veli. */
export type MessageViewer = "OWNER" | "SELF" | "GUARDIAN_READ";

export type MessageThread = {
  /** Portal bağlantısının kimliği. */
  linkId: string;
  /** Yazışmanın karşı tarafı: öğrenci hesabı ya da bir veli hesabı. */
  role: "STUDENT" | "GUARDIAN";
  studentId: string;
  studentName: string;
  teacherName: string;
  /** Yalnızca öğretmende ve veli yazışmalarında: kabul edilen davetin adresi. */
  guardianEmail: string | null;
  viewer: MessageViewer;
  canSend: boolean;
  /** Erişim kaldırıldıysa ya da öğrenci arşivlendiyse false (kapalı yazışma). */
  active: boolean;
  /** Öğrenci yazışmasını okuyabilen veli hesabı sayısı (öğretmen ve öğrenci için). */
  guardianReaders: number;
  /** Son mesajın ilk 200 karakteri. */
  lastBody: string | null;
  lastAt: string | null;
  lastMine: boolean;
  unread: number;
};

export type ChatMessage = {
  id: string;
  senderRole: "OWNER" | "STUDENT" | "GUARDIAN" | "OTHER";
  mine: boolean;
  body: string;
  createdAt: string;
};

/** Listede ve yazışma başlığında görünen ad. */
export function threadTitle(thread: MessageThread): string {
  if (thread.viewer === "SELF") return thread.teacherName;
  if (thread.viewer === "GUARDIAN_READ")
    return t("chat.childThread", { student: thread.studentName });
  return thread.role === "GUARDIAN"
    ? t("chat.guardianOf", { student: thread.studentName })
    : thread.studentName;
}

/** Mesajın üstündeki gönderen adı. Öğrenci ve veli öğrencinin adıyla görünür. */
export function senderLabel(m: ChatMessage, thread: MessageThread): string {
  if (m.mine) return t("chat.you");
  if (m.senderRole === "OWNER") return thread.teacherName;
  if (m.senderRole === "STUDENT") return thread.studentName;
  if (m.senderRole === "GUARDIAN")
    return t("chat.guardianOf", { student: thread.studentName });
  return t("chat.someone");
}

/** Yazışma satırı, soketten gelen yeni mesajdan sonra: son mesaj sunucunun
 *  listesindeki gibi ilk 200 karakteriyle, karşı taraftan geldiyse okunmamış
 *  bir artar. Satır bu mesajı ya da daha yenisini zaten gösteriyorsa null. */
export function threadWithMessage(
  thread: MessageThread,
  message: ChatMessage,
): MessageThread | null {
  if (
    thread.lastAt &&
    Date.parse(thread.lastAt) >= Date.parse(message.createdAt)
  )
    return null;
  return {
    ...thread,
    lastBody: Array.from(message.body).slice(0, 200).join(""),
    lastAt: message.createdAt,
    lastMine: message.mine,
    unread: message.mine ? thread.unread : thread.unread + 1,
  };
}

/** Yazışma listesi, soketten gelen yeni mesajdan sonra: satır güncellenir ve
 *  sunucunun sırasıyla (son mesajı en yeni olan başta, mesajsızlar sonda)
 *  yerine geçer; öteki satırların sırası değişmez. Yazışma listede yoksa ya
 *  da mesajı zaten gösteriyorsa null (liste değişmez). */
export function threadsWithMessage(
  threads: readonly MessageThread[],
  linkId: string,
  message: ChatMessage,
): MessageThread[] | null {
  const row = threads.find((x) => x.linkId === linkId);
  const next = row && threadWithMessage(row, message);
  if (!next) return null;
  const last = (x: MessageThread) =>
    x.lastAt ? Date.parse(x.lastAt) : -Infinity;
  return threads
    .map((x) => (x === row ? next : x))
    .sort((a, b) => last(b) - last(a) || 0);
}

/** Okunmamış mesaj sayacı. Velinin yalnızca okuduğu çocuk yazışması sayılmaz. */
export function unreadBadge(threads: MessageThread[]): number {
  return threads.reduce(
    (sum, x) => (x.viewer === "GUARDIAN_READ" ? sum : sum + x.unread),
    0,
  );
}
