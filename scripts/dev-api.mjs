import { once } from "node:events";
import { createInterface } from "node:readline";

// Geliştirmede API, tsc --watch bir derlemeyi bitirdiğinde yeniden başlatılır.
// Çıktı klasörü izlenmez: tsc --watch açılışta bütün dosyaları yeniden yazar
// ve macOS bu değişiklikleri onlarca saniyeye yayarak bildirebilir; dosya
// izleyicisi (node --watch) API'yi bu sürede art arda yeniden başlatıyordu.

/** tsc --watch'un argümanları. Çıktısı okunacağı için borudan gelir; terminale
 *  yazılıyorsa renkler --pretty ile korunur. */
export const compilerArgs = (tsc, terminal) => [
  tsc,
  "-p",
  "apps/api/tsconfig.json",
  "--watch",
  "--preserveWatchOutput",
  ...(terminal ? ["--pretty"] : []),
];

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

/** tsc --watch çıktısını satır satır terminale yazar; her bitmiş derlemede
 *  API'yi yeniden başlatır. */
export function restartOnBuild(output, start, write = console.log) {
  const runner = apiRunner(start);
  createInterface({ input: output }).on("line", (line) => {
    write(line);
    if (compileFinished(line)) void runner.compiled();
  });
}
