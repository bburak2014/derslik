const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, "../..");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sep = "[/\\\\]";

// Mobile only bundles its own source plus the two shared workspace packages.
// Watching apps/web and apps/api as well made every Next.js or Nest rebuild
// look like a source change to Metro.
config.watchFolders = [
  path.join(root, "node_modules"),
  __dirname,
  path.join(root, "packages/contracts"),
  path.join(root, "packages/api-client"),
];

// Folders a running development session writes into. Metro's HMR server answers
// *any* change under a watched folder with an "update-start" message, which is
// what paints the blue "Refreshing…" banner on the device — even when the
// resulting bundle delta is empty. Paths are anchored at the repository root so
// that identically named folders inside node_modules (`dist`, `build`, …) stay
// resolvable.
// Kökte durmaları beklenen klasörler. `dist` ve `build` yaygın paket klasör
// adları olduğu için kökte sabitlenir; yoksa node_modules içindekiler
// çözümlenemez hale gelirdi.
const generatedAtRoot = [
  ".git",
  "coverage",
  "dist",
  "build",
  "apps/web/.next",
  "apps/api/dist",
  "apps/mobile/dist",
];

// Bunlar araçların kendi durum ve önbellek klasörleri; hiçbir yayımlanmış paket
// bu adlarla klasör göndermez, bu yüzden her derinlikte engellenirler.
// `.sites-runtime` kökte sabitliydi ve bir pnpm kurulumu onu apps/mobile
// altında da oluşturunca izlenen ağaçta kalıp banner'ı geri getirdi.
const generatedAnywhere = [
  ".api-build",
  ".next",
  ".vinext",
  ".wrangler",
  ".sites-runtime",
  ".qodo",
  ".openai",
  ".expo",
];

const previous = config.resolver.blockList || [];
config.resolver.blockList = [
  ...(Array.isArray(previous) ? previous : [previous]),
  ...generatedAtRoot.map(
    (folder) =>
      new RegExp("^" + escape(path.join(root, folder)) + "(?:" + sep + "|$)"),
  ),
  // `.expo` içinde `dev/logs/start.log` var; Expo her paketleme olayında ve
  // cihazın yazdığı her konsol satırında oraya ekleme yapıyor. İzlenirse
  // uygulamanın kendi günlükleri banner'ı döngüye sokuyor. Aynı mantık diğer
  // araç önbellekleri için de geçerli.
  ...generatedAnywhere.map(
    (folder) =>
      new RegExp(
        "^" +
          escape(root) +
          sep +
          "(?:.*" +
          sep +
          ")?" +
          escape(folder) +
          "(?:" +
          sep +
          "|$)",
      ),
  ),
];

module.exports = config;
