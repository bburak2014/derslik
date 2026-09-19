import { ConnectedWorkspace } from "@/components/account/connected-workspace";
import { configured } from "@/lib/server/session";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (configured()) return <ConnectedWorkspace />;
  return (
    <main className="connection-state">
      <h1>Derslik kurulumu</h1>
      <p>
        Uygulamanın bağlantı ayarları henüz tamamlanmamış. Kurulum kılavuzundaki
        web ve API ayarlarını tamamlayıp yeniden başlatın.
      </p>
    </main>
  );
}
