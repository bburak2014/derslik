"use client";
import { useEffect, useState } from "react";
import { backend } from "@/lib/client";
export function Subscription({
  workspaceId,
  onUpdate,
}: {
  workspaceId: string;
  onUpdate: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void backend(`/workspaces/${workspaceId}/subscription`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, [workspaceId]);
  async function open(kind: "checkout" | "portal") {
    setBusy(true);
    setError("");
    try {
      const r = await backend(
        `/workspaces/${workspaceId}/subscription/${kind}`,
        {},
      );
      location.assign(r.data.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return error ? <p role="alert">{error}</p> : null;
  return (
    <article className="usage-card">
      <h3>Derslik aboneliği</h3>
      <p>
        {data.providerId
          ? `Durum: ${({ active: "Etkin", on_trial: "Deneme", cancelled: "İptal edildi", expired: "Sona erdi", past_due: "Ödeme bekliyor", unpaid: "Ödenmedi", paused: "Duraklatıldı" } as Record<string, string>)[data.status] || data.status}`
          : "Pilot planını kullanıyorsunuz."}
      </p>
      {data.endsAt && (
        <p>Bitiş: {new Date(data.endsAt).toLocaleDateString("tr-TR")}</p>
      )}
      {data.available ? (
        <>
          <p>
            Pro: {data.pro.students} öğrenci · {data.pro.videoHours} saat video
            · {data.pro.materialGb} GB dosya.
          </p>
          <p className="text-sm text-muted-foreground">
            {data.testMode
              ? "Test ödeme ortamı açık. Gerçek ücret alınmaz."
              : "Ücret ve yenileme koşulları ödeme sayfasında gösterilir."}
          </p>
          <div className="learning-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void open(data.providerId ? "portal" : "checkout")}
            >
              {data.providerId ? "Aboneliği yönet" : "Pro ödeme sayfasını aç"}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await backend(
                    `/workspaces/${workspaceId}/subscription/sync`,
                    {},
                  );
                  setData(r.data);
                  onUpdate();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Durumu yenile
            </button>
          </div>
        </>
      ) : (
        <p>Ücretli abonelikler henüz açılmamış.</p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </article>
  );
}
