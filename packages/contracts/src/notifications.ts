import { isMessageKey, t, translate, type MessageKey } from "./i18n/index.ts";
import { dayLabel } from "./types.ts";

/** Bildirimin ilgili olduğu kayıt. Sunucu her bildirime türünü ve kaydın
 *  kimliğini yazar; web ve mobil aynı kuralla ilgili sayfayı açar. */
export type NoticeKind =
  | "ASSIGNMENT"
  | "SUBMISSION"
  | "REVIEW"
  | "VIDEO"
  | "QUESTION"
  | "ANSWER"
  | "SUMMARY"
  | "REQUEST"
  | "REQUEST_DECISION";

export type Notice = {
  id: string;
  workspaceId: string;
  studentId: string | null;
  title: string;
  body: string;
  /** Eski bildirimlerde boş; o zaman bölüm başlıktan çıkarılır. */
  kind: NoticeKind | null;
  targetId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Bildirimin açtığı bölüm: öğretmende Ödevler / Ders videoları sayfası ya da
 *  öğrenci dosyasındaki Paylaşımlar, öğrenci ve velide aynı adlı sekme. */
export type NoticeSection =
  | "assignments"
  | "videos"
  | "notes"
  /** Öğretmenin vitrin sayfasındaki gelen ders istekleri. */
  | "requests"
  /** Öğrencinin gönderdiği istekler (kabul edildiyse o öğretmenin dersleri). */
  | "myRequests";

export type NoticeTarget = {
  workspaceId: string;
  /** İstek bildirimlerinde öğrenci kaydı henüz yoksa boş. */
  studentId: string;
  section: NoticeSection;
  /** Bölümde öne çıkarılacak ödev, video veya özet. */
  itemId: string | null;
};

const sections: Record<NoticeKind, NoticeSection> = {
  ASSIGNMENT: "assignments",
  SUBMISSION: "assignments",
  REVIEW: "assignments",
  VIDEO: "videos",
  QUESTION: "videos",
  ANSWER: "videos",
  SUMMARY: "notes",
  REQUEST: "requests",
  REQUEST_DECISION: "myRequests",
};

/** Başlıklar sunucuda sabit metinler; türü yazılmamış eski bildirimler için. */
function sectionFromTitle(title: string): NoticeSection | null {
  const t = title.toLocaleLowerCase("tr");
  if (t.includes("soru") || t.includes("video")) return "videos";
  if (t.includes("özet")) return "notes";
  if (t.includes("ödev")) return "assignments";
  return null;
}

// Sunucu bildirim başlığını ve sabit gövdeleri çeviri anahtarı olarak yazar
// ("notice.assignmentNew"); okuyan kişi kendi dilinde görür. Anahtardan önce
// yazılmış bildirimler Türkçe metin taşır, onlar da eşleşen anahtara çevrilir.
const noticeKeys: MessageKey[] = [
  "notice.assignmentNew",
  "notice.submissionNew",
  "notice.submissionNewBody",
  "notice.submissionUpdated",
  "notice.submissionUpdatedBody",
  "notice.reviewed",
  "notice.reviewedBody",
  "notice.question",
  "notice.questionBody",
  "notice.answered",
  "notice.answeredBody",
  "notice.videoReady",
  "notice.summaryReady",
  "notice.summaryReadyBody",
  "notice.requestNew",
  "notice.requestAccepted",
  "notice.requestDeclined",
];
/** Bildirim başlığı veya gövdesi, okuyanın dilinde. Öğretmenin yazdığı ödev
 *  ya da video adı gibi serbest metinler olduğu gibi kalır. */
export function noticeText(text: string): string {
  if (text.startsWith("notice.") && isMessageKey(text)) return t(text);
  const legacy = noticeKeys.find((key) => translate("tr", key) === text);
  return legacy ? t(legacy) : text;
}

export function noticeTarget(n: Notice): NoticeTarget | null {
  if (n.kind === "REQUEST" || n.kind === "REQUEST_DECISION")
    return {
      workspaceId: n.workspaceId,
      studentId: n.studentId ?? "",
      section: sections[n.kind],
      itemId: n.targetId,
    };
  if (!n.studentId) return null;
  const section = n.kind ? sections[n.kind] : sectionFromTitle(n.title);
  if (!section) return null;
  return {
    workspaceId: n.workspaceId,
    studentId: n.studentId,
    section,
    itemId: n.kind ? n.targetId : null,
  };
}

/** Bildirim simgesinin türü; web lucide, mobil Ionicons simgesiyle çizer.
 *  Türü yazılmamış eski bildirimlerde sunucunun sabit Türkçe başlığına bakılır. */
export type NoticeIcon =
  "question" | "video" | "summary" | "assignment" | "other";

export function noticeIcon(n: Pick<Notice, "kind" | "title">): NoticeIcon {
  if (n.kind === "QUESTION" || n.kind === "ANSWER") return "question";
  if (n.kind === "VIDEO") return "video";
  if (n.kind === "SUMMARY") return "summary";
  if (n.kind) return "assignment";
  const title = n.title.toLocaleLowerCase("tr");
  if (title.includes("soru")) return "question";
  if (title.includes("video")) return "video";
  if (title.includes("özet")) return "summary";
  if (title.includes("ödev")) return "assignment";
  return "other";
}

/** "5 dk önce", "dün"; bir haftadan eskiyse tarih. */
export function timeAgo(iso: string, now: number) {
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

type NoticeAccess = {
  id: string;
  role: "OWNER" | "STUDENT" | "GUARDIAN";
  studentId?: string;
};

/** Öğrencinin istek yanıtı dışındaki bildirimler için hangi görünümün
 *  açılacağı: şu an açık olan uyuyorsa o, yoksa öğretmen görünümü, yoksa o
 *  öğrencinin görünümü. Gelen ders istekleri yalnızca öğretmende açılır. */
export function noticeAccess<A extends NoticeAccess>(
  target: NoticeTarget,
  list: A[],
  current: A | null,
): A | null {
  const fits = (a: A) =>
    a.id === target.workspaceId &&
    (a.role === "OWNER" ||
      (target.section !== "requests" && a.studentId === target.studentId));
  if (current && fits(current)) return current;
  return (
    list.find((a) => fits(a) && a.role === "OWNER") ?? list.find(fits) ?? null
  );
}
