// İlk açılışta öğretmen çalışma alanının verisi, alanın kodu yüklenirken
// paralel istenir; kod gelince hazır cevap kullanılır. Yalnızca bir kez:
// sonraki yenilemeler her zaman taze istek atar.

/** İstek, ekrandaki çalışma alanını taşır. Oturum çerezleri sekmeler arasında
 *  ortaktır; sunucu çerezlerin seçtiği alan bu değilse işlemi yapmaz. */
export const WORKSPACE_HEADER = "X-Derslik-Workspace";

let pending: { workspaceId: string; response: Promise<Response> } | null =
  null;

const request = (workspaceId: string) =>
  fetch("/api/workspace", {
    cache: "no-store",
    headers: { [WORKSPACE_HEADER]: workspaceId },
  });

export function prefetchWorkspace(workspaceId: string) {
  pending ??= { workspaceId, response: request(workspaceId) };
}

export function workspaceResponse(workspaceId: string) {
  const ready = pending?.workspaceId === workspaceId ? pending.response : null;
  pending = null;
  return ready ?? request(workspaceId);
}

/** Başka sekmede hesap ya da alan değiştiyse sayfa güncel hesapla yeniden
 *  açılır; eski ekrandan yeni hesaba bir şey yazılmaz. */
export async function accountChanged(response: Response) {
  if (response.status !== 409) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { accountChanged?: boolean } | null;
  return body?.accountChanged === true;
}
