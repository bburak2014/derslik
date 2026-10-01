import {
  csrf,
  errorResponse,
  HttpError,
  json,
  serverSession,
} from "@/lib/server/session";
import { socketUrl } from "@/lib/server/realtime";
export const dynamic = "force-dynamic";

/** Anlık mesajlaşma soketi için tek kullanımlık bilet ve soket adresi.
 *  Tarayıcı oturum belirtecini görmez; bileti oturum çereziyle buradan alır
 *  ve API'nin soketine onunla bağlanır. Bilet 30 saniye geçerlidir. */
export async function POST(request: Request) {
  try {
    csrf(request);
    const url = socketUrl();
    // 501: soket bu kurulumda yok (istemci uzun aralıkla dener). 503 geçici
    // hata anlamına gelir (API kapalı); istemci kısa aralıkla yeniden dener.
    if (!url) throw new HttpError(501, "web.notConfigured");
    const { client } = await serverSession();
    const r = await client.request<{
      data: { ticket: string; expiresIn: number };
    }>("/v1/socket/ticket", { method: "POST", body: {} });
    return json({ data: { ...r.data, url } });
  } catch (e) {
    return errorResponse(e);
  }
}
