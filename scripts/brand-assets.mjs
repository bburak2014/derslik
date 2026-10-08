// Logodan üretilen dosyalar (kaynak: packages/contracts/src/brand.ts):
//   apps/web/public/favicon.svg            64 px, yuvarlak köşeli
//   apps/mobile/assets/icon.svg|png        1024 px, uygulama simgesi
//   apps/mobile/assets/adaptive-icon.svg|png  Android ön planı (saydam)
// PNG'ler sharp ile çizilir (Next'in bağımlılığı olarak kurulu).
// Kullanım: node --experimental-strip-types scripts/brand-assets.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { adaptiveIconSvg, iconSvg } from "../packages/contracts/src/brand.ts";

const files = {
  "apps/web/public/favicon.svg": iconSvg(64),
  "apps/mobile/assets/icon.svg": iconSvg(1024),
  "apps/mobile/assets/adaptive-icon.svg": adaptiveIconSvg(1024),
};
for (const [path, svg] of Object.entries(files)) writeFileSync(path, svg);

const next = createRequire(import.meta.url).resolve("next/package.json", { paths: ["apps/web"] });
const sharp = createRequire(next)("sharp");
await sharp(Buffer.from(files["apps/mobile/assets/icon.svg"])).png().toFile("apps/mobile/assets/icon.png");
await sharp(Buffer.from(files["apps/mobile/assets/adaptive-icon.svg"])).png().toFile("apps/mobile/assets/adaptive-icon.png");
console.log(`${Object.keys(files).join(", ")}, apps/mobile/assets/icon.png, apps/mobile/assets/adaptive-icon.png ✓`);
