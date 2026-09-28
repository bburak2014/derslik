// İlk açılışta öğretmen çalışma alanının verisi, alanın kodu yüklenirken
// paralel istenir; kod gelince hazır cevap kullanılır. Yalnızca bir kez:
// sonraki yenilemeler her zaman taze istek atar.
let pending: Promise<Response> | null = null;

const request = () => fetch("/api/workspace", { cache: "no-store" });

export function prefetchWorkspace() {
  pending ??= request();
}

export function workspaceResponse() {
  const response = pending ?? request();
  pending = null;
  return response;
}
