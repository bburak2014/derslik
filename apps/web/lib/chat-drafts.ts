"use client";
/** Yazışmalarda yarım kalan metinler, yazışmanın API yoluna göre (yol çalışma
 *  alanını, öğrenciyi ve yazışmayı içerir). Yalnızca bu sekmenin belleğinde
 *  durur; oturum kapanınca silinir ki aynı sekmede giren başka hesap görmesin.
 *  Giriş paketine mesajlaşma kodunu taşımamak için ayrı modüldedir. */
const chatDrafts = new Map<string, string>();

/** Yazışmanın yarım kalan metni (yazışmanın API yoluna göre). */
export const getChatDraft = (key: string) => chatDrafts.get(key);

/** Yarım kalan metni saklar; boş metin kaydı siler. */
export function setChatDraft(key: string, text: string) {
  if (text) chatDrafts.set(key, text);
  else chatDrafts.delete(key);
}

export function clearChatDrafts() {
  chatDrafts.clear();
}

/** Erişim değişirken adresteki yazışma ve öğrenci kimliği bırakılır: başka
 *  alana ait kimlikle açılan yazışma bulunamaz (404) ve tek yazışmalı
 *  öğrencide listeye dönüş yolu yoktur. */
export function forgetChatInUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has("thread") && !params.has("student")) return;
  params.delete("thread");
  params.delete("student");
  const search = params.toString();
  window.history.replaceState(
    {},
    "",
    location.pathname + (search ? "?" + search : ""),
  );
}
