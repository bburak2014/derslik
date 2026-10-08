// Logodan üretilen dosyalar (kaynak: packages/contracts/src/brand.ts):
//   apps/web/public/favicon.svg            64 px, yuvarlak köşeli
//   apps/mobile/assets/icon.svg|png        1024 px, uygulama simgesi
//   apps/mobile/assets/adaptive-icon.svg|png  Android ön planı (saydam)
// PNG'ler sharp ile çizilir (Next'in bağımlılığı olarak kurulu).
// Kullanım: node --experimental-strip-types scripts/brand-assets.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { adaptiveIconSvg, iconSvg } from "../packages/contracts/src/brand.ts";

const root = resolve(import.meta.dirname, "..");

/** Depodaki yolu ve içeriğiyle üretilen her dosya (yazmadan). */
export async function brandAssets() {
  const svg = {
    "apps/web/public/favicon.svg": iconSvg(64),
    "apps/mobile/assets/icon.svg": iconSvg(1024),
    "apps/mobile/assets/adaptive-icon.svg": adaptiveIconSvg(1024),
  };
  const next = createRequire(import.meta.url).resolve("next/package.json", { paths: [resolve(root, "apps/web")] });
  const sharp = createRequire(next)("sharp");
  const png = (source) => sharp(Buffer.from(svg[source])).png().toBuffer();
  return {
    ...svg,
    "apps/mobile/assets/icon.png": await png("apps/mobile/assets/icon.svg"),
    "apps/mobile/assets/adaptive-icon.png": await png("apps/mobile/assets/adaptive-icon.svg"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = await brandAssets();
  for (const [path, contents] of Object.entries(files)) writeFileSync(resolve(root, path), contents);
  console.log(`${Object.keys(files).join(", ")} ✓`);
}
