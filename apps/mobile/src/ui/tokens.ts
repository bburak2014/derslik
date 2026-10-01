import React from "react";
import { type TextStyle } from "react-native";
// Yalnızca kullanılan kalınlıklar alt yoldan alınır; paketin kökünden almak
// bütün kalınlıkları (her biri ~95 KB) uygulamaya gömerdi.
import { Onest_400Regular } from "@expo-google-fonts/onest/400Regular";
import { Onest_500Medium } from "@expo-google-fonts/onest/500Medium";
import { Onest_600SemiBold } from "@expo-google-fonts/onest/600SemiBold";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Ionicons } from "@expo/vector-icons";

/* ------------------------------------------------------------------ */
/* Tasarım belirteçleri                                                */
/* ------------------------------------------------------------------ */

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

// "Mürekkep ve fosforlu kalem": değerler apps/web/app/globals.css'teki
// light-dark() çiftlerinin birebir karşılığı. Kaynak orası; burada yeni renk
// uydurulmaz, her anahtarın yanında web'deki belirteç adı yazar.
export const lightColors = {
  // Yüzeyler
  canvas: "#f5f6fa", // --canvas
  surface: "#ffffff", // --surface
  sunken: "#eceef6", // --surface-sunken

  // Çizgiler: ayraç (shadcn --border) ve kontrol kenarlığı (shadcn --input).
  // İkisi de ince ve açık; kontrolün sınırını gölge ve odak halkası da taşır.
  line: "#e2e5ef", // --line
  lineControl: "#d3d7e4", // --line-control
  ring: "#6f80e0", // --ring
  ringSoft: "rgba(111,128,224,0.5)", // ring/50: shadcn'in 3 px odak halkası

  // Metin: hepsi yüzey ve tuval üzerinde AA (4.5:1)
  ink: "#121a44", // --ink
  text: "#2f3760", // --text
  muted: "#535a80", // --text-muted
  faint: "#5d6488", // --text-subtle

  // Marka
  brand: "#2338a8", // --brand
  brandHover: "#1a2b86", // --brand-hover
  brandSoft: "#e7eafb", // --brand-soft
  brandLine: "#b9c2f2", // --brand-line
  onBrand: "#ffffff", // --on-brand

  // Fosforlu kalem: yalnızca "şimdi" ve "dikkat" için tek vurgu.
  marker: "#ffd84a", // --marker
  markerInk: "#2a2100", // --marker-ink
  markerSoft: "#fff4c2", // --marker-soft

  // Mürekkep yüzeyi: web'deki kenar çubuğu; mobilde giriş ekranı ve alt
  // gezinme.
  navy: "#141c4d", // --navy
  navySoft: "#232d68", // --navy-soft
  onNavy: "#c3c9ec", // --sidebar-foreground
  onNavyStrong: "#ffffff", // --sidebar-accent-foreground

  // Öne çıkan panel (Bugün, toplam bakiye): açık temada lacivert, koyu
  // temada yükseltilmiş yüzey + marka kenarı (web: --stat-feature-*).
  feature: "#141c4d",
  featureLine: "#141c4d",
  onFeature: "#ffffff",
  onFeatureMuted: "#c3c9ec",

  // Durumlar
  danger: "#b33a26", // --danger
  dangerSoft: "#fbeeeb", // --danger-soft
  dangerLine: "#efc4ba", // --danger-line
  dangerRing: "rgba(179,58,38,0.2)", // destructive/20
  warn: "#7f5300", // --warn
  warnSoft: "#fdf3d8", // --warn-soft
  warnLine: "#ecd49a", // --warn-line
  ok: "#1a6e4a", // --ok
  okSoft: "#e3f4ec", // --ok-soft
  okLine: "rgba(26,110,74,0.3)", // ok/30
  info: "#2338a8", // --info
  infoSoft: "#eef0fc", // --info-soft
  infoLine: "#c9d0f4", // --info-line

  // Kimlik tonları: yalnızca ayırt etmek için (avatar); durumlardan ayrık.
  tint1Bg: "#e7eafb",
  tint1Fg: "#2338a8",
  tint2Bg: "#e3f4ec",
  tint2Fg: "#1a6e4a",
  tint3Bg: "#f1e6fb",
  tint3Fg: "#6b3aa0",
  tint4Bg: "#fbe9e5",
  tint4Fg: "#9c3420",

  overlay: "rgba(18,26,68,0.45)",
  scrim: "rgba(9,13,36,0.94)", // görsel önizlemesinin zemini
  playerSurface: "#090d24",

  // Gölgeler (RN boxShadow): shadcn'in shadow-xs'i ve --shadow-card/raised.
  shadowXs: "0 1px 2px 0 rgba(18,26,68,0.05)",
  shadowCard: "0 1px 3px 0 rgba(13,29,41,0.08)",
  shadowRaised: "0 6px 20px 0 rgba(13,29,41,0.1)",
};

export type Palette = typeof lightColors;

// Koyu tema: web'deki light-dark() çiftlerinin ikinci değerleri. Anahtarlar
// açık paletle birebir aynı.
export const darkColors: Palette = {
  canvas: "#0d1230",
  surface: "#151b3f",
  sunken: "#1c2350",

  line: "rgba(255,255,255,0.1)",
  lineControl: "rgba(255,255,255,0.15)",
  ring: "#8ea0ff",
  ringSoft: "rgba(142,160,255,0.5)",

  ink: "#eef0fb",
  text: "#c9cdea",
  muted: "#9ea5cb",
  faint: "#9198c0",

  brand: "#8ea0ff",
  brandHover: "#a9b7ff",
  brandSoft: "#202a66",
  brandLine: "#3a4690",
  onBrand: "#0d1230",

  marker: "#f2d44e",
  markerInk: "#221b00",
  markerSoft: "#3a3212",

  navy: "#090d24",
  navySoft: "#161c40",
  onNavy: "#aab1dc",
  onNavyStrong: "#eef0fb",

  feature: "#1a2150",
  featureLine: "#3a4690",
  onFeature: "#eef0fb",
  onFeatureMuted: "#9ea5cb",

  danger: "#f39a86",
  dangerSoft: "#3a1b16",
  dangerLine: "#6a332a",
  dangerRing: "rgba(243,154,134,0.4)",
  warn: "#f0c46a",
  warnSoft: "#352a10",
  warnLine: "#5e4a1c",
  ok: "#7fdcb2",
  okSoft: "#12342a",
  okLine: "rgba(127,220,178,0.3)",
  info: "#aeb9ff",
  infoSoft: "#1a2150",
  infoLine: "#34408a",

  tint1Bg: "#202a66",
  tint1Fg: "#aeb9ff",
  tint2Bg: "#12342a",
  tint2Fg: "#7fdcb2",
  tint3Bg: "#2c1d48",
  tint3Fg: "#cfaef5",
  tint4Bg: "#3a1b16",
  tint4Fg: "#f5ab98",

  overlay: "rgba(0,0,0,0.6)",
  scrim: "rgba(4,6,18,0.96)",
  playerSurface: "#05081a",

  shadowXs: "0 1px 2px 0 rgba(0,0,0,0.25)",
  shadowCard: "0 1px 3px 0 rgba(0,0,0,0.3)",
  shadowRaised: "0 6px 20px 0 rgba(0,0,0,0.45)",
};

// Web'deki --radius (10 px) ve türevleri.
export const radius = {
  inner: 8, // segment, küçük düğme (--radius - 2px)
  control: 10, // düğme, girdi, seçici (--radius)
  card: 14, // kart ve panel (--radius + 4px)
  panel: 18, // öne çıkan panel (web: .day-panel)
  sheet: 20, // alttan açılan katman
  pill: 999,
};

// Yazı tipleri web ile aynı: başlıklar Bricolage Grotesque, gövde Onest.
// Özel yazı tipinde her kalınlık ayrı bir aile; fontWeight ile birlikte
// verilirse Android sahte kalın çiziyor. Bu yüzden stiller kalınlığı yalnızca
// aile adıyla seçer. Yazı tipi yüklenemezse sistem yazı tipine düşülür.
export const fontFiles = {
  "Onest-Regular": Onest_400Regular,
  "Onest-Medium": Onest_500Medium,
  "Onest-SemiBold": Onest_600SemiBold,
  "Bricolage-Bold": BricolageGrotesque_700Bold,
  "Bricolage-ExtraBold": BricolageGrotesque_800ExtraBold,
};
type Weight = "regular" | "medium" | "semibold" | "display" | "heavy";
export type Typography = Record<Weight, TextStyle>;
export const brandType: Typography = {
  regular: { fontFamily: "Onest-Regular" },
  medium: { fontFamily: "Onest-Medium" },
  semibold: { fontFamily: "Onest-SemiBold" },
  display: { fontFamily: "Bricolage-Bold" },
  heavy: { fontFamily: "Bricolage-ExtraBold" },
};
export const systemType: Typography = {
  regular: { fontWeight: "400" },
  medium: { fontWeight: "500" },
  semibold: { fontWeight: "600" },
  display: { fontWeight: "700" },
  heavy: { fontWeight: "800" },
};
