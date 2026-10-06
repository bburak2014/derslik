import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { MediaProviders } from "./providers.js";

const BATCH = 100;
const EVERY_MS = 10 * 60_000;

type Due = { id: string; object_key: string; checked_at: Date };

/**
 * Depodaki sahipsiz nesneleri temizler. Silinen kaydın yükleme bağlantısı
 * süresi dolana kadar geçerlidir; süresi dolan bekleyen yüklemenin nesnesi de
 * depoda kalmış olabilir. Bütün bağlantıları biten bu kayıtların yolu
 * sağlayıcıdan yeniden silinir, kota ancak o zaman boşalır. Silme tekrarlanabilir
 * olduğundan birden çok API kopyası aynı kaydı işlerse sorun olmaz.
 */
@Injectable()
export class MaterialCleanupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly providers: MediaProviders,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  onApplicationBootstrap() {
    // Testler run() fonksiyonunu kendileri çağırır.
    if (
      this.config.NODE_ENV === "test" ||
      !this.providers.attachmentsConfigured()
    )
      return;
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      console.error("Material cleanup failed", {
        code: (error as Error & { code?: string }).code,
        message: (error as Error).message,
      });
    } finally {
      this.running = false;
    }
  }

  /** Temizlenmesi gereken nesneleri siler; temizlenen kayıt sayısını döndürür. */
  async run(): Promise<number> {
    let total = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- sonraki parti, bu partinin nesneleri silinip kayıtları işaretlendikten sonra istenir; aksi halde aynı kayıtlar yeniden gelir.
      const due = await this.db.systemTransaction(
        async (tx) =>
          (
            await tx.query<Due>(
              "SELECT * FROM derslik.material_cleanup_due($1)",
              [BATCH],
            )
          ).rows,
      );
      if (!due.length) return total;
      // eslint-disable-next-line no-await-in-loop -- kayıt, nesnesi sağlayıcıdan silindikten sonra işaretlenir; sıra bozulamaz.
      await this.providers.deleteFiles(due.map((d) => d.object_key));
      // eslint-disable-next-line no-await-in-loop -- işaretleme bu partinin silinmesine bağlı; bir sonraki parti ancak bundan sonra istenir.
      const purged = await this.db.systemTransaction(
        async (tx) =>
          (
            await tx.query<{ n: number }>(
              "SELECT derslik.material_cleanup_done($1,$2) AS n",
              [due.map((d) => d.id), due[0].checked_at],
            )
          ).rows[0].n,
      );
      total += purged;
      // İşaretlenemeyen kayıt (yarışta değişti) sonraki turda yeniden gelir;
      // aynı turda dönmek sonsuz döngü olurdu.
      if (due.length < BATCH || purged < due.length) return total;
    }
  }
}
