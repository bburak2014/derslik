// İlk açılışta öğretmen çalışma alanının verisi, alanın kodu yüklenirken
// paralel istenir; kod gelince sürmekte olan istek kullanılır. Aynı anda
// gelen yükleme istekleri de (geliştirmede React her efekti iki kez çalıştırır)
// tek isteği paylaşır. Kayıttan sonraki yenileme her zaman taze istek atar.

/** İstek, ekrandaki çalışma alanını taşır. Oturum çerezleri sekmeler arasında
 *  ortaktır; sunucu çerezlerin seçtiği alan bu değilse işlemi yapmaz. */
export const WORKSPACE_HEADER = "X-Derslik-Workspace";

export type WorkspaceLoad = {
  ok: boolean;
  status: number;
  body: unknown;
  /** Başka sekmede hesap ya da alan değişti: sayfa güncel hesapla yeniden
   *  açılır, eski ekrandan yeni hesaba bir şey yazılmaz. */
  accountChanged: boolean;
};

let cached: { workspaceId: string; load: Promise<WorkspaceLoad> } | null =
  null;

async function request(workspaceId: string): Promise<WorkspaceLoad> {
  const r = await fetch("/api/workspace", {
    cache: "no-store",
    headers: { [WORKSPACE_HEADER]: workspaceId },
  });
  const body = (await r.json().catch(() => null)) as {
    accountChanged?: boolean;
  } | null;
  return {
    ok: r.ok,
    status: r.status,
    body,
    accountChanged: r.status === 409 && body?.accountChanged === true,
  };
}

/** Ön yükleme, alanın kodu gelip onu kullanana kadar saklanır. */
export function prefetchWorkspace(workspaceId: string) {
  cached ??= { workspaceId, load: request(workspaceId) };
}

/** Ön yüklemeyi (yoksa yeni isteği) verir. Aynı anda gelen ikinci yükleme
 *  aynı isteği paylaşır; sonraki yüklemeler yeni istek atar.
 *  `fresh`: elde olanı kullanma (kayıttan sonra, yeniden denemede). */
export function workspaceResponse(workspaceId: string, fresh = false) {
  const entry =
    !fresh && cached?.workspaceId === workspaceId
      ? cached
      : { workspaceId, load: request(workspaceId) };
  cached = entry;
  setTimeout(() => {
    if (cached === entry) cached = null;
  }, 0);
  return entry.load;
}

export async function accountChanged(response: Response) {
  if (response.status !== 409) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { accountChanged?: boolean } | null;
  return body?.accountChanged === true;
}
