// Logodan üretilen dosyalar (kaynak: packages/contracts/src/brand.ts):
//   apps/web/public/favicon.svg            64 px, yuvarlak köşeli
//   apps/mobile/assets/icon.svg|png        1024 px, uygulama simgesi
//   apps/mobile/assets/adaptive-icon.svg|png  Android ön planı (saydam)
// PNG'ler sharp ile çizilir (Next'in bağımlılığı olarak kurulu).
// Kullanım: node --experimental-strip-types scripts/brand-assets.mjs [hedef klasör]
// Hedef verilmezse deponun kendisine yazar.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { adaptiveIconSvg, iconSvg } from "../packages/contracts/src/brand.ts";

const repo = resolve(import.meta.dirname, "..");
const target = resolve(process.argv[2] ?? repo);

const files = {
  "apps/web/public/favicon.svg": iconSvg(64),
  "apps/mobile/assets/icon.svg": iconSvg(1024),
  "apps/mobile/assets/adaptive-icon.svg": adaptiveIconSvg(1024),
};
const write = (path, contents) => {
  mkdirSync(dirname(resolve(target, path)), { recursive: true });
  writeFileSync(resolve(target, path), contents);
};
for (const [path, svg] of Object.entries(files)) write(path, svg);

const next = createRequire(import.meta.url).resolve("next/package.json", { paths: [resolve(repo, "apps/web")] });
const sharp = createRequire(next)("sharp");
const png = async (path) => write(path.replace(/\.svg$/, ".png"), await sharp(Buffer.from(files[path])).png().toBuffer());
await png("apps/mobile/assets/icon.svg");
await png("apps/mobile/assets/adaptive-icon.svg");
console.log(`${Object.keys(files).join(", ")}, apps/mobile/assets/icon.png, apps/mobile/assets/adaptive-icon.png ✓`);
