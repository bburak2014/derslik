/** Bildirimin ilgili olduğu kayıt. Sunucu her bildirime türünü ve kaydın
 *  kimliğini yazar; web ve mobil aynı kuralla ilgili sayfayı açar. */
export type NoticeKind =
  | "ASSIGNMENT"
  | "SUBMISSION"
  | "REVIEW"
  | "VIDEO"
  | "QUESTION"
  | "ANSWER"
  | "SUMMARY";

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
export type NoticeSection = "assignments" | "videos" | "notes";

export type NoticeTarget = {
  workspaceId: string;
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
};

/** Başlıklar sunucuda sabit metinler; türü yazılmamış eski bildirimler için. */
function sectionFromTitle(title: string): NoticeSection | null {
  const t = title.toLocaleLowerCase("tr");
  if (t.includes("soru") || t.includes("video")) return "videos";
  if (t.includes("özet")) return "notes";
  if (t.includes("ödev")) return "assignments";
  return null;
}

export function noticeTarget(n: Notice): NoticeTarget | null {
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
