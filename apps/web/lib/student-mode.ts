"use client";
import type { Access } from "@derslik/api-client";
import { t } from "@derslik/contracts";
import { webRequest } from "./client";

const MODE_KEY = "derslik-mode";
/** Öğretmene bağlı olmayan hesap "öğretmen arıyorum" dediyse bu tarayıcıda
 *  hatırlanır. */
export function rememberedStudentMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "student";
  } catch {
    return false;
  }
}
export function rememberMode(student: boolean) {
  try {
    if (student) localStorage.setItem(MODE_KEY, "student");
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* Depolama kapalıysa seçim yalnızca bu sayfada geçerli. */
  }
}

/** O öğretmendeki öğrenci görünümüne geçip dersleri açar. Erişim listesi
 *  yenilenir, çünkü istek ya da davet az önce kabul edilmiş olabilir. Hem
 *  uygulamanın içinden hem herkese açık öğretmen profilinden çağrılır. */
export async function openStudentWorkspace(workspaceId: string) {
  const fresh = await webRequest<{ list: Access[] }>("/api/session");
  const next = fresh.list.find(
    (a) => a.id === workspaceId && a.role === "STUDENT",
  );
  if (!next) throw new Error(t("conn.noticeNoAccess"));
  await webRequest("/api/session", {
    key: `${next.id}:${next.role}:${next.studentId || ""}`,
  });
  rememberMode(false);
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- tam sayfa yüklemesi bilerek: oturum bağlamı ve uygulama kabuğu baştan kurulur.
  location.assign("/?view=lessons");
}
