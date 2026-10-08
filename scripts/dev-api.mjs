import { once } from "node:events";

// Geliştirmede API, tsc --watch bir derlemeyi bitirdiğinde yeniden başlatılır.
// Çıktı klasörü izlenmez: tsc --watch açılışta bütün dosyaları yeniden yazar
// ve macOS bu değişiklikleri onlarca saniyeye yayarak bildirebilir; dosya
// izleyicisi (node --watch) API'yi bu sürede art arda yeniden başlatıyordu.

/** tsc --watch her derlemenin sonunda bu satırı yazar (hatalı derlemede de). */
export const compileFinished = (line) =>
  line.includes("Watching for file changes.");

const running = (child) =>
  !!child && child.exitCode === null && child.signalCode === null;

/** Her bitmiş derlemede API'yi yeniden başlatır. Eski süreç kapanmadan yenisi
 *  başlamaz; bekleme sırasında biten derlemeleri, ardından başlayan süreç
 *  zaten en yeni çıktıyla açılır. `start` null dönerse (başlatıcı kapanıyor)
 *  yeni süreç açılmaz. */
export function apiRunner(start) {
  let child = null;
  let restarting = false;
  return {
    async compiled() {
      if (restarting) return;
      restarting = true;
      if (running(child)) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      child = start();
      restarting = false;
    },
  };
}
