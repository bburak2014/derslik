/* Tutorwise Academy logosu tek kaynaktan: işaret (açık kitap ve kep) ve
   renkler. Web uygulamasının ve mobil uygulamanın marka işareti, favicon ve
   uygulama simgesi buradan üretilir (scripts/brand-assets.mjs).
   Kaynak: tanıtım sitesi deposu (tutorwise-landing, lib/brand.ts); logo
   değişirse iki depoda birlikte güncellenir. İşaretin sol yarısı özgün
   logodan elle çizildi; sağ yarı MARK_CENTER çevresinde aynalanır. */

/** Uygulamanın görünen adı (teknik kimlikler — paket adları, çerezler,
 *  başlıklar, uygulama kimliği — "derslik" olarak kalır). */
export const BRAND_NAME = "Tutorwise";
/** Büyük harfli marka (sayfa yolu gibi); dile göre büyütülmez, yoksa
 *  Türkçede "TUTORWİSE" olurdu. */
export const BRAND_CAPS = BRAND_NAME.toUpperCase();

export const brand = {
  navy: "#021c43",
  orange: "#fdab20",
  sky: "#08aaf9",
  royal: ["#0059c6", "#003881"] as const,
  /** Koyu zeminde lacivertin yerini alan açık mürekkep. */
  ink: "#f2f5ff",
};

export const MARK_CENTER = 343.5;
export const MARK_VIEWBOX = { x: 8, y: 2, width: 672, height: 612 };

type Segment = [command: "M" | "L" | "Q" | "C", ...points: number[]];
type Half = "cover" | "upper" | "lower";

/** Sol yarı: kapak (dış çubuk ve ortaya kıvrılan alt bant), üst ve alt sayfa. */
const halves: Record<Half, Segment[]> = {
  cover: [
    ["M", 26, 221],
    ["L", 84, 229],
    ["Q", 92, 230, 92, 239],
    ["L", 92, 455],
    ["C", 190, 462, 288, 518, 322, 603],
    ["C", 262, 548, 132, 504, 28, 499],
    ["Q", 18, 498, 18, 488],
    ["L", 18, 230],
    ["Q", 18, 221, 26, 221],
  ],
  upper: [
    ["M", 124, 118],
    ["C", 226, 142, 322, 240, 331, 384],
    ["C", 302, 300, 222, 240, 124, 219],
    ["Q", 117, 217, 117, 209],
    ["L", 116, 127],
    ["Q", 116, 117, 124, 118],
  ],
  lower: [
    ["M", 125, 246],
    ["C", 222, 268, 318, 348, 329, 470],
    ["L", 331, 578],
    ["C", 300, 520, 222, 457, 124, 443],
    ["Q", 117, 442, 117, 434],
    ["L", 117, 254],
    ["Q", 117, 245, 125, 246],
  ],
};

const round = (value: number) => Math.round(value * 10) / 10;
const mirror = (segments: Segment[]): Segment[] =>
  segments.map(([command, ...points]) => [
    command,
    ...points.map((value, i) => (i % 2 === 0 ? round(2 * MARK_CENTER - value) : value)),
  ]);
const toPath = (segments: Segment[]) => `${segments.map(([command, ...points]) => command + points.join(" ")).join(" ")} Z`;

/** Sol ve sağ yarıların SVG yolları. */
export const markParts = Object.fromEntries(
  (Object.keys(halves) as Half[]).map((name) => [name, { left: toPath(halves[name]), right: toPath(mirror(halves[name])) }]),
) as Record<Half, { left: string; right: string }>;

/** Kep: tepe (köşeleri yuvarlatılmış dörtgen), gövde, ip, düğüm ve püskül. */
export const capParts = {
  top: "M342 13 L491 71 L342 147 L193 80 Z",
  base: "M259 128 L342 164 L420 125 L420 170 Q420 183 407 191 L355 216 Q342 223 329 216 L273 191 Q259 183 259 170 Z",
  cord: "M474 81 L474 95",
  knob: { cx: 474, cy: 101, r: 6 },
  tassel: "M470 107 L478 107 L485 145 Q486 152 479 152 L469 152 Q462 152 463 145 Z",
};

/** İşaretin renkleri: on-light açık zemin (özgün logo), on-dark koyu zemin. */
export type Tone = "on-light" | "on-dark";

export function markColors(tone: Tone) {
  return {
    ink: tone === "on-dark" ? brand.ink : brand.navy,
    orange: brand.orange,
    sky: brand.sky,
    royal: brand.royal,
  };
}

/** Koyu mavi sayfanın geçişi (sağ üstten sol alta), işaret koordinatlarında. */
export const ROYAL_GRADIENT = { x1: 560, y1: 250, x2: 350, y2: 580 };

/** İşaretin SVG içeriği (svg etiketi olmadan). */
export function markSvg({ tone = "on-light", id = "tw" }: { tone?: Tone; id?: string } = {}) {
  const c = markColors(tone);
  const g = ROYAL_GRADIENT;
  return [
    `<defs><linearGradient id="${id}-royal" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c.royal[0]}"/><stop offset="1" stop-color="${c.royal[1]}"/></linearGradient></defs>`,
    `<path fill="${c.ink}" d="${markParts.cover.left}"/>`,
    `<path fill="${c.ink}" d="${markParts.cover.right}"/>`,
    `<path fill="${c.orange}" d="${markParts.upper.left}"/>`,
    `<path fill="${c.sky}" d="${markParts.upper.right}"/>`,
    `<path fill="${c.sky}" d="${markParts.lower.left}"/>`,
    `<path fill="url(#${id}-royal)" d="${markParts.lower.right}"/>`,
    `<path fill="${c.ink}" stroke="${c.ink}" stroke-width="6" stroke-linejoin="round" d="${capParts.top}"/>`,
    `<path fill="${c.ink}" d="${capParts.base}"/>`,
    `<path fill="none" stroke="${c.ink}" stroke-width="4" stroke-linecap="round" d="${capParts.cord}"/>`,
    `<circle fill="${c.ink}" cx="${capParts.knob.cx}" cy="${capParts.knob.cy}" r="${capParts.knob.r}"/>`,
    `<path fill="${c.ink}" d="${capParts.tassel}"/>`,
  ].join("");
}

const fixed = (value: number) => Number(value.toFixed(4));

/** Kare simge: beyaz zemin, ortada özgün renkli işaret. 256 px ve altı
 *  (favicon) köşeleri yuvarlak; büyük boy (uygulama simgesi) tam kare,
 *  köşeleri işletim sistemi keser. */
export function iconSvg(size: number) {
  const { x, y, width, height } = MARK_VIEWBOX;
  const scale = (size * 0.7) / Math.max(width, height);
  const tx = (size - width * scale) / 2 - x * scale;
  const ty = (size - height * scale) / 2 - y * scale;
  const corner = size <= 256 ? ` rx="${fixed(size * 0.22)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}"${corner} fill="#ffffff"/><g transform="translate(${fixed(tx)} ${fixed(ty)}) scale(${fixed(scale)})">${markSvg({ id: "icon" })}</g></svg>\n`;
}

/** Android uyarlanabilir simgenin ön planı: saydam zemin, işaret ortada ve
 *  küçük (sistem kenarları daire ya da kare olarak kırpar; güvenli bölge
 *  ortadaki %66). Zemin rengi app.json'da beyaz. */
export function adaptiveIconSvg(size: number) {
  const { x, y, width, height } = MARK_VIEWBOX;
  const scale = (size * 0.5) / Math.max(width, height);
  const tx = (size - width * scale) / 2 - x * scale;
  const ty = (size - height * scale) / 2 - y * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${fixed(tx)} ${fixed(ty)}) scale(${fixed(scale)})">${markSvg({ id: "adaptive" })}</g></svg>\n`;
}
