import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { useFonts } from "expo-font";
// Yalnızca kullanılan kalınlıklar alt yoldan alınır; paketin kökünden almak
// bütün kalınlıkları (her biri ~95 KB) uygulamaya gömerdi.
import { Onest_400Regular } from "@expo-google-fonts/onest/400Regular";
import { Onest_500Medium } from "@expo-google-fonts/onest/500Medium";
import { Onest_600SemiBold } from "@expo-google-fonts/onest/600SemiBold";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";
import {
  dateKey,
  dayLabel,
  intlLocale,
  lower,
  t,
  upper,
} from "@derslik/contracts";

const THEME_KEY = "derslik.theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

// Android'de basma geri bildirimi ripple ile verilir; iOS'ta zemin değişimi
// kullanılır. Tek yerde tanımlanır ki her dokunulabilir öğe aynı hissi versin.
export const ripple = (light = false) =>
  Platform.OS === "android"
    ? {
        color: light ? "rgba(255,255,255,0.16)" : "rgba(18,26,68,0.08)",
        borderless: false,
      }
    : undefined;

/* ------------------------------------------------------------------ */
/* Tasarım belirteçleri                                                */
/* ------------------------------------------------------------------ */

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
const fontFiles = {
  "Onest-Regular": Onest_400Regular,
  "Onest-Medium": Onest_500Medium,
  "Onest-SemiBold": Onest_600SemiBold,
  "Bricolage-Bold": BricolageGrotesque_700Bold,
  "Bricolage-ExtraBold": BricolageGrotesque_800ExtraBold,
};
type Weight = "regular" | "medium" | "semibold" | "display" | "heavy";
export type Typography = Record<Weight, TextStyle>;
const brandType: Typography = {
  regular: { fontFamily: "Onest-Regular" },
  medium: { fontFamily: "Onest-Medium" },
  semibold: { fontFamily: "Onest-SemiBold" },
  display: { fontFamily: "Bricolage-Bold" },
  heavy: { fontFamily: "Bricolage-ExtraBold" },
};
const systemType: Typography = {
  regular: { fontWeight: "400" },
  medium: { fontWeight: "500" },
  semibold: { fontWeight: "600" },
  display: { fontWeight: "700" },
  heavy: { fontWeight: "800" },
};

const makeStyles = (colors: Palette, type: Typography) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    body: { padding: 20, paddingBottom: 44, gap: 16 },

    // Yazı
    brand: {
      ...type.heavy,
      fontSize: 23,
      letterSpacing: -0.9,
      color: colors.ink,
    },
    title: {
      ...type.heavy,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.7,
      color: colors.ink,
    },
    h2: {
      ...type.display,
      fontSize: 17,
      lineHeight: 23,
      letterSpacing: -0.3,
      color: colors.ink,
    },
    text: { ...type.regular, fontSize: 15, lineHeight: 22, color: colors.text },
    muted: {
      ...type.regular,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    caption: {
      ...type.regular,
      fontSize: 12.5,
      lineHeight: 17,
      color: colors.faint,
    },
    // Web'deki .eyebrow: küçük, aralıklı, marka renginde. Büyük harfe Kicker
    // bileşeni çevirir; textTransform Türkçe "i"yi "I" yapıyordu.
    kicker: {
      ...type.semibold,
      fontSize: 11,
      letterSpacing: 1.3,
      color: colors.brand,
    },
    label2: {
      ...type.semibold,
      fontSize: 11,
      letterSpacing: 1.1,
      color: colors.muted,
    },
    link: { ...type.semibold, fontSize: 14, color: colors.brand },

    // Düzen
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.card,
      padding: 16,
      gap: 10,
      boxShadow: colors.shadowCard,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 20,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },

    // Düğmeler: shadcn Button (default / outline / ghost / destructive).
    button: {
      minHeight: 48,
      borderRadius: radius.control,
      paddingVertical: 12,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.brand,
      backgroundColor: colors.brand,
      boxShadow: colors.shadowXs,
    },
    // Metin satıra sığmazsa kısalır; yoksa RN'de (flexShrink 0) yanındaki
    // simgeleri düğmenin dışına iter.
    buttonText: {
      ...type.medium,
      fontSize: 15,
      color: colors.onBrand,
      flexShrink: 1,
    },
    secondary: {
      backgroundColor: colors.surface,
      borderColor: colors.lineControl,
    },
    secondaryText: { color: colors.ink },
    ghost: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      boxShadow: "none",
    },
    ghostText: { color: colors.ink },
    danger: {
      backgroundColor: colors.surface,
      borderColor: colors.dangerLine,
    },
    dangerText: { color: colors.danger },
    onInk: {
      backgroundColor: "transparent",
      borderColor: "rgba(255,255,255,0.18)",
      boxShadow: "none",
    },
    onInkText: { color: colors.onFeature },
    buttonSmall: {
      minHeight: 40,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.inner,
    },
    buttonSmallText: { fontSize: 14 },

    // Form
    field: { gap: 8 },
    label: {
      ...type.medium,
      fontSize: 14,
      color: colors.ink,
    },
    hint: {
      ...type.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    input: {
      ...type.regular,
      borderWidth: 1,
      borderColor: colors.lineControl,
      borderRadius: radius.control,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 48,
      backgroundColor: colors.surface,
      fontSize: 16,
      color: colors.ink,
      boxShadow: colors.shadowXs,
    },
    // shadcn odak durumu: kenar halka renginde, çevresinde 3 px yarı saydam
    // halka.
    inputFocused: {
      borderColor: colors.ring,
      boxShadow: `0 0 0 3px ${colors.ringSoft}`,
    },
    inputInvalid: {
      borderColor: colors.danger,
      boxShadow: `0 0 0 3px ${colors.dangerRing}`,
    },
    inputDisabled: { opacity: 0.5 },
  });

const makeSection = (colors: Palette, type: Typography) =>
  StyleSheet.create({
    iconButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.lineControl,
      backgroundColor: colors.surface,
      boxShadow: colors.shadowXs,
    },
    iconGhost: {
      borderColor: "transparent",
      backgroundColor: "transparent",
      boxShadow: "none",
    },
    count: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 19,
      height: 19,
      paddingHorizontal: 5,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.marker,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    countText: {
      ...type.semibold,
      fontSize: 10,
      lineHeight: 12,
      color: colors.markerInk,
      fontVariant: ["tabular-nums"],
    },
    pickerTrigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    pickerBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: colors.overlay,
    },
    pickerSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 12,
    },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.lineControl,
    },
    pickerHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: radius.inner,
    },
    wrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 6,
    },
    sectionTitle: {
      ...type.display,
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: -0.35,
      color: colors.ink,
    },
    // shadcn Badge: tam yuvarlak, kenarsız, anlamı renk tonundan gelir.
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radius.pill,
      alignSelf: "flex-start",
    },
    badgeText: { ...type.medium, fontSize: 12, lineHeight: 16, flexShrink: 1 },
    badgeDot: { width: 6, height: 6, borderRadius: 3 },
    empty: {
      alignItems: "center",
      gap: 8,
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.lineControl,
      borderStyle: "dashed",
    },
    emptyIcon: {
      width: 44,
      height: 44,
      marginBottom: 4,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.sunken,
    },
    emptyTitle: {
      ...type.display,
      fontSize: 16,
      lineHeight: 22,
      letterSpacing: -0.2,
      color: colors.ink,
      textAlign: "center",
    },
    // shadcn Alert: ince kenar, yumuşak zemin, simge + metin.
    alert: {
      flexDirection: "row",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      backgroundColor: colors.dangerSoft,
    },
    alertSuccess: {
      borderColor: colors.okLine,
      backgroundColor: colors.okSoft,
    },
    alertText: {
      ...type.regular,
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.danger,
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    fieldError: {
      ...type.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.danger,
    },
    // shadcn TabsList: gömük zemin, seçili parça yüzey renginde ve gölgeli.
    segmented: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      padding: 4,
      borderRadius: radius.control + 2,
      backgroundColor: colors.sunken,
    },
    segment: {
      flexGrow: 1,
      flexBasis: 90,
      minHeight: 40,
      flexDirection: "row",
      gap: 6,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      borderRadius: radius.inner,
      borderWidth: 1,
      borderColor: "transparent",
    },
    segmentOn: {
      backgroundColor: colors.surface,
      borderColor: colors.line,
      boxShadow: colors.shadowXs,
    },
    segmentText: {
      ...type.medium,
      fontSize: 14,
      color: colors.muted,
      flexShrink: 1,
    },
    segmentTextOn: { color: colors.ink },
    close: {
      width: 40,
      height: 40,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.sunken,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    sheetTitle: {
      ...type.display,
      fontSize: 19,
      lineHeight: 25,
      letterSpacing: -0.4,
      color: colors.ink,
    },
    footer: {
      flexDirection: "row",
      gap: 10,
      padding: 16,
      paddingBottom: 18,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      backgroundColor: colors.surface,
    },

    // Marka işareti: lacivert kare içinde fosforlu kitap (web'deki
    // kenar çubuğu logosunun küçük hali).
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    brandMark: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.navy,
    },

    // Mürekkep yüzeyi
    ink: {
      borderRadius: radius.panel,
      borderWidth: 1,
      padding: 18,
      gap: 16,
      overflow: "hidden",
    },

    // Alt gezinme: web'deki lacivert kenar çubuğunun mobil karşılığı. Etkin
    // sekme, kenar çubuğundaki defter ayracı gibi sayfaya bağlanır: tuval
    // renginde, üst kenardan sarkar.
    tabBar: {
      flexDirection: "row",
      gap: 2,
      paddingHorizontal: 6,
      backgroundColor: colors.navy,
      overflow: "hidden",
    },
    tab: {
      flex: 1,
      minHeight: 58,
      paddingTop: 9,
      paddingBottom: 8,
      gap: 4,
      alignItems: "center",
      justifyContent: "center",
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
    },
    tabOn: { backgroundColor: colors.canvas },
    tabText: {
      ...type.medium,
      fontSize: 11,
      color: colors.onNavy,
      textAlign: "center",
    },
    tabTextOn: { ...type.semibold, color: colors.ink },

    // Tarih karosu (web: .date-tile). Bugün fosforlu kalemle işaretlenir.
    dateTile: {
      width: 48,
      height: 52,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.sunken,
    },
    dateMonth: {
      ...type.semibold,
      fontSize: 9.5,
      letterSpacing: 0.8,
      color: colors.muted,
    },
    dateDay: {
      ...type.display,
      fontSize: 20,
      lineHeight: 24,
      color: colors.ink,
      fontVariant: ["tabular-nums"],
    },

    avatarText: { ...type.semibold, letterSpacing: 0.2 },

    metric: {
      flex: 1,
      minWidth: 140,
      padding: 14,
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.card,
      boxShadow: colors.shadowCard,
    },
    metricValue: {
      ...type.display,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.6,
      color: colors.ink,
      fontVariant: ["tabular-nums"],
    },

    // Gruplu liste: tek kart içinde ayraçlı satırlar.
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.card,
      overflow: "hidden",
      boxShadow: colors.shadowCard,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },

    // Teslim, geri bildirim ve video soruları: gömük zeminli alıntı kutusu.
    quote: {
      gap: 4,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.sunken,
    },
    fileIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.brandSoft,
    },
    videoThumb: {
      width: 64,
      height: 48,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.feature,
    },
    notice: {
      flexDirection: "row",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    noticeIcon: {
      width: 32,
      height: 32,
      marginTop: 1,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    unreadDot: {
      width: 8,
      height: 8,
      marginTop: 6,
      borderRadius: 4,
      backgroundColor: colors.brand,
    },

    // Mürekkep paneldeki sayılar (web: .day-figures)
    figures: { flexDirection: "row", flexWrap: "wrap", rowGap: 16 },
    figure: { width: "50%", gap: 4, paddingRight: 8 },
    figureLabel: {
      ...type.semibold,
      fontSize: 10.5,
      letterSpacing: 1,
      color: colors.onFeatureMuted,
    },
    figureValue: {
      ...type.display,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.4,
      color: colors.onFeature,
      fontVariant: ["tabular-nums"],
    },

    // shadcn Progress
    meterTrack: {
      height: 8,
      borderRadius: radius.pill,
      overflow: "hidden",
      backgroundColor: colors.brandSoft,
    },
    meterFill: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.brand,
    },
  });

function build(colors: Palette, type: Typography) {
  return {
    colors,
    type,
    styles: makeStyles(colors, type),
    section: makeSection(colors, type),
  };
}
const themes = {
  brand: {
    light: build(lightColors, brandType),
    dark: build(darkColors, brandType),
  },
  system: {
    light: build(lightColors, systemType),
    dark: build(darkColors, systemType),
  },
};

export type ThemeMode = "light" | "dark" | "system";
type ThemeValue = ReturnType<typeof build> & {
  scheme: "light" | "dark";
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeValue>({
  ...themes.system.light,
  scheme: "light",
  mode: "system",
  setMode: () => {},
});

/**
 * Tema sağlayıcı. `mode` üç değerli: cihazı izle (system) ya da sabitle.
 * Seçim cihazda saklanır; web'deki tema düğmesiyle aynı davranış. Yazı
 * tipleri de burada yüklenir; yüklenene kadar yalnızca tuval çizilir.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const device = useColorScheme();
  const [fontsReady, fontError] = useFonts(fontFiles);
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    let alive = true;
    void getItemAsync(THEME_KEY)
      .then((stored) => {
        if (alive && (stored === "light" || stored === "dark"))
          setModeState(stored);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void (next === "system"
      ? deleteItemAsync(THEME_KEY).catch(() => {})
      : setItemAsync(THEME_KEY, next).catch(() => {}));
  }, []);
  const scheme: "light" | "dark" =
    mode === "system" ? (device === "dark" ? "dark" : "light") : mode;
  const family = fontsReady ? "brand" : "system";
  const value = useMemo(
    () => ({ ...themes[family][scheme], scheme, mode, setMode }),
    [family, scheme, mode, setMode],
  );
  if (!fontsReady && !fontError)
    return <View style={{ flex: 1, backgroundColor: value.colors.canvas }} />;
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Bileşenler bunu `const { colors, styles } = useTheme()` diye kullanır. */
export function useTheme() {
  return useContext(ThemeContext);
}

/* ------------------------------------------------------------------ */
/* Marka ve mürekkep yüzeyleri                                         */
/* ------------------------------------------------------------------ */

/** Kareli defter dokusu: web'deki --grid-texture ile aynı 18 px ızgara.
 *  Yalnızca mürekkep yüzeylerde kullanılır. */
export function GridTexture() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id="derslik-grid"
            width={18}
            height={18}
            patternUnits="userSpaceOnUse"
          >
            <Path
              d="M18 0.5H0.5V18"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#derslik-grid)" />
      </Svg>
    </View>
  );
}

/** "derslik." yazısı. Açık yüzeyde lacivert karo + marka noktası; mürekkep
 *  zeminde (giriş ekranı) beyaz yazı + fosforlu nokta, web'deki gibi. */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  const { colors, styles, section } = useTheme();
  return (
    <View
      style={section.brandRow}
      accessible
      accessibilityRole="header"
      accessibilityLabel="Derslik"
    >
      {inverse ? (
        <Ionicons name="book-outline" size={26} color={colors.marker} />
      ) : (
        <View style={section.brandMark}>
          <Ionicons name="book-outline" size={18} color={colors.marker} />
        </View>
      )}
      <Text style={[styles.brand, inverse && { color: colors.onNavyStrong }]}>
        derslik
        <Text style={{ color: inverse ? colors.marker : colors.brand }}>.</Text>
      </Text>
    </View>
  );
}

/** Öne çıkan mürekkep panel (web: Bugün paneli, lacivert istatistik kartı). */
export function InkPanel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, section } = useTheme();
  return (
    <View
      style={[
        section.ink,
        { backgroundColor: colors.feature, borderColor: colors.featureLine },
        style,
      ]}
    >
      <GridTexture />
      {children}
    </View>
  );
}

const solidIcon = (name: IconName) =>
  name.endsWith("-outline") ? (name.slice(0, -8) as IconName) : name;

/** Alt gezinme çubuğu. Güvenli alanı kendisi taşır. */
export function BottomTabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; icon: IconName }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { colors, section } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[section.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      <GridTexture />
      {items.map((t) => {
        const on = value === t.id;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.id)}
            android_ripple={on ? undefined : ripple(true)}
            style={({ pressed }) => [
              section.tab,
              on && section.tabOn,
              pressed && !on && { backgroundColor: colors.navySoft },
            ]}
          >
            <Ionicons
              name={on ? solidIcon(t.icon) : t.icon}
              size={22}
              color={on ? colors.brand : colors.onNavy}
            />
            <Text
              numberOfLines={1}
              style={[section.tabText, on && section.tabTextOn]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Düğmeler                                                            */
/* ------------------------------------------------------------------ */

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "onInk";

export function Button({
  children,
  onPress,
  secondary = false,
  variant,
  size = "md",
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  /** Eski çağrılar için; variant="secondary" ile aynı (shadcn outline). */
  secondary?: boolean;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, styles } = useTheme();
  const kind: ButtonVariant = variant || (secondary ? "secondary" : "primary");
  const inactive = disabled || loading;
  const surface = {
    primary: null,
    secondary: styles.secondary,
    ghost: styles.ghost,
    danger: styles.danger,
    onInk: styles.onInk,
  }[kind];
  const label = {
    primary: null,
    secondary: styles.secondaryText,
    ghost: styles.ghostText,
    danger: styles.dangerText,
    onInk: styles.onInkText,
  }[kind];
  const tint = {
    primary: colors.onBrand,
    secondary: colors.ink,
    ghost: colors.ink,
    danger: colors.danger,
    onInk: colors.onFeature,
  }[kind];
  const pressedSurface = {
    primary: {
      backgroundColor: colors.brandHover,
      borderColor: colors.brandHover,
    },
    secondary: { backgroundColor: colors.sunken },
    ghost: { backgroundColor: colors.sunken },
    danger: { backgroundColor: colors.dangerSoft },
    onInk: { backgroundColor: "rgba(255,255,255,0.1)" },
  }[kind];
  const iconSize = size === "sm" ? 16 : 18;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      hitSlop={size === "sm" ? 4 : undefined}
      android_ripple={ripple(kind === "primary" || kind === "onInk")}
      style={({ pressed }) => [
        styles.button,
        surface,
        size === "sm" && styles.buttonSmall,
        pressed && !inactive && pressedSurface,
        inactive && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : icon ? (
        <Ionicons name={icon} size={iconSize} color={tint} />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          label,
          size === "sm" && styles.buttonSmallText,
        ]}
        numberOfLines={1}
      >
        {children}
      </Text>
      {!!trailingIcon && (
        <Ionicons name={trailingIcon} size={iconSize - 2} color={tint} />
      )}
    </Pressable>
  );
}

/** Metin bağlantısı görünümlü düğme (shadcn Button variant="link"). */
export function TextLink({
  children,
  onPress,
  disabled = false,
  icon,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { colors, styles } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 6 },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {!!icon && <Ionicons name={icon} size={16} color={colors.brand} />}
      <Text style={styles.link}>{children}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Kaplar                                                              */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  tone = "plain",
  onPress,
  style,
  onLayout,
}: {
  children: React.ReactNode;
  tone?: "plain" | "brand" | "muted";
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  onLayout?: ViewProps["onLayout"];
}) {
  const { colors, styles } = useTheme();
  const toned =
    tone === "brand"
      ? { backgroundColor: colors.brandSoft, borderColor: colors.brandLine }
      : tone === "muted"
        ? {
            backgroundColor: colors.sunken,
            borderColor: colors.line,
            boxShadow: "none",
          }
        : null;
  if (!onPress)
    return (
      <View style={[styles.card, toned, style]} onLayout={onLayout}>
        {children}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLayout={onLayout}
      android_ripple={ripple()}
      style={({ pressed }) => [
        styles.card,
        toned,
        pressed && { backgroundColor: colors.sunken },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const { styles, section } = useTheme();
  return (
    <View style={section.wrap}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text accessibilityRole="header" style={section.sectionTitle}>
          {title}
        </Text>
        {!!description && <Text style={styles.muted}>{description}</Text>}
      </View>
      {action}
    </View>
  );
}

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Üst başlık (web: .eyebrow). Metni etkin dilin kurallarıyla büyük harfe
 *  çevirir: Türkçede "Derslik hesabı" -> "DERSLİK HESABI". */
export function Kicker({
  children,
  muted = false,
  style,
}: {
  children: string;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const { styles } = useTheme();
  return (
    <Text style={[muted ? styles.label2 : styles.kicker, style]}>
      {upper(children)}
    </Text>
  );
}

/** Durum rozeti: web'deki ToneBadge ile aynı tonlar. `dot` planlı/iptal gibi
 *  durumlarda baştaki noktayı, `icon` tamamlandı gibi durumlarda simgeyi
 *  çizer. */
export function Badge({
  children,
  tone = "neutral",
  dot = false,
  icon,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  icon?: IconName;
}) {
  const { colors, section } = useTheme();
  const palette = {
    neutral: { bg: colors.sunken, fg: colors.muted },
    info: { bg: colors.infoSoft, fg: colors.info },
    success: { bg: colors.okSoft, fg: colors.ok },
    warning: { bg: colors.warnSoft, fg: colors.warn },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  return (
    <View style={[section.badge, { backgroundColor: palette.bg }]}>
      {icon ? (
        <Ionicons name={icon} size={12} color={palette.fg} />
      ) : dot ? (
        <View style={[section.badgeDot, { backgroundColor: palette.fg }]} />
      ) : null}
      <Text
        numberOfLines={1}
        style={[section.badgeText, { color: palette.fg }]}
      >
        {children}
      </Text>
    </View>
  );
}

/** Ders durumu rozeti: web'deki Status bileşeninin karşılığı. */
export function LessonStatus({
  status,
}: {
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
}) {
  return status === "COMPLETED" ? (
    <Badge tone="success" icon="checkmark">
      {t("lesson.completed")}
    </Badge>
  ) : status === "CANCELLED" ? (
    <Badge tone="neutral" dot>
      {t("lesson.cancelled")}
    </Badge>
  ) : (
    <Badge tone="info" dot>
      {t("lesson.scheduled")}
    </Badge>
  );
}

/** Baş harfli avatar. Renk web'deki StudentAvatar ile aynı hesaplanır; aynı
 *  öğrenci iki uygulamada da aynı tonda görünür. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const { colors, section } = useTheme();
  const index =
    Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  const tone = [
    { bg: colors.tint1Bg, fg: colors.tint1Fg },
    { bg: colors.tint4Bg, fg: colors.tint4Fg },
    { bg: colors.tint3Bg, fg: colors.tint3Fg },
    { bg: colors.tint2Bg, fg: colors.tint2Fg },
  ][index];
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase(intlLocale());
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone.bg,
      }}
    >
      <Text
        style={[
          section.avatarText,
          { color: tone.fg, fontSize: Math.round(size * 0.36) },
        ]}
      >
        {initials}
      </Text>
    </View>
  );
}

/** Tarih karosu: ay kısaltması ve gün. Bugün fosforlu kalemle işaretli. */
export function DateTile({ date }: { date: string }) {
  const { colors, section } = useTheme();
  const today = dateKey(date) === dateKey();
  return (
    <View
      style={[section.dateTile, today && { backgroundColor: colors.marker }]}
    >
      <Text style={[section.dateMonth, today && { color: colors.markerInk }]}>
        {upper(dayLabel(date, { month: "short", day: undefined }))}
      </Text>
      <Text style={[section.dateDay, today && { color: colors.markerInk }]}>
        {Number(dateKey(date).slice(-2))}
      </Text>
    </View>
  );
}

/** Sayı kutusu (kalan ders, açık bakiye). `warn` azalan değerler için. */
export function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}) {
  const { colors, styles, section } = useTheme();
  return (
    <View
      style={[
        section.metric,
        warn && {
          backgroundColor: colors.warnSoft,
          borderColor: colors.warnLine,
        },
      ]}
    >
      <Text style={[styles.muted, warn && { color: colors.warn }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[section.metricValue, warn && { color: colors.warn }]}
      >
        {value}
      </Text>
    </View>
  );
}

/** Gruplu liste kabı; satırlar ListRow ile eklenir. */
export function List({ children }: { children: React.ReactNode }) {
  const { section } = useTheme();
  return <View style={section.list}>{children}</View>;
}

/** Liste satırı. İlk satır dışındakiler üst ayraç çizer (`divider`). */
export function ListRow({
  children,
  onPress,
  divider = false,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  divider?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors, section } = useTheme();
  const line = divider && { borderTopWidth: 1, borderTopColor: colors.line };
  if (!onPress) return <View style={[section.listRow, line]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={ripple()}
      style={({ pressed }) => [
        section.listRow,
        line,
        pressed && { backgroundColor: colors.sunken },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Mürekkep paneldeki sayı ızgarası: iki sütun, büyük harf etiketler. */
export function InkFigures({
  items,
}: {
  items: { label: string; value: React.ReactNode }[];
}) {
  const { section } = useTheme();
  return (
    <View style={section.figures}>
      {items.map((item) => (
        <View key={item.label} style={section.figure}>
          <Text style={section.figureLabel}>
            {item.label.toLocaleUpperCase("tr")}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={section.figureValue}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Kullanım göstergesi (web: UsageMeter). %90 ve üstü tehlike renginde. */
export function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}) {
  const { colors, styles, section } = useTheme();
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = percent >= 90;
  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.muted, { fontVariant: ["tabular-nums"] }]}>
          {used.toLocaleString(intlLocale())} /{" "}
          {limit.toLocaleString(intlLocale())}
          {unit ? " " + unit : ""}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={[
          section.meterTrack,
          full && { backgroundColor: colors.dangerSoft },
        ]}
      >
        <View
          style={[
            section.meterFill,
            { width: `${percent}%` },
            full && { backgroundColor: colors.danger },
          ]}
        />
      </View>
    </View>
  );
}

export function EmptyState({
  icon = "sparkles-outline",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const { colors, styles, section } = useTheme();
  return (
    <View style={section.empty}>
      <View style={section.emptyIcon}>
        <Ionicons name={icon} size={21} color={colors.ink} />
      </View>
      <Text style={section.emptyTitle}>{title}</Text>
      {!!description && (
        <Text style={[styles.muted, { textAlign: "center" }]}>
          {description}
        </Text>
      )}
      {!!action && <View style={{ marginTop: 6 }}>{action}</View>}
    </View>
  );
}

/** Yükleme göstergesi: yalnızca dönen simge. Metin ekran okuyucuda kalır,
 *  ekranda "yükleniyor" yazısı görünmez (web ile aynı davranış). */
export function Loading({ label = t("common.loading") }) {
  const { colors, styles } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[
        styles.screen,
        { alignItems: "center", justifyContent: "center" },
      ]}
    >
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

export function ErrorText({ message }: { message: string }) {
  const { colors, section } = useTheme();
  return message ? (
    <View style={section.alert}>
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={colors.danger}
        style={{ marginTop: 1 }}
      />
      <Text accessibilityRole="alert" style={section.alertText}>
        {message}
      </Text>
    </View>
  ) : null;
}

export function SuccessText({ message }: { message: string }) {
  const { colors, section } = useTheme();
  return message ? (
    <View style={[section.alert, section.alertSuccess]}>
      <Ionicons
        name="checkmark-circle-outline"
        size={18}
        color={colors.ok}
        style={{ marginTop: 1 }}
      />
      <Text
        accessibilityRole="alert"
        style={[section.alertText, { color: colors.ok }]}
      >
        {message}
      </Text>
    </View>
  ) : null;
}

/* ------------------------------------------------------------------ */
/* Form denetimleri                                                    */
/* ------------------------------------------------------------------ */

export function Input({
  invalid = false,
  multiline,
  style,
  onFocus,
  onBlur,
  editable = true,
  icon,
  ...rest
}: TextInputProps & { invalid?: boolean; icon?: IconName }) {
  const { colors, styles } = useTheme();
  const [focused, setFocused] = useState(false);
  const field = (
    <TextInput
      {...rest}
      editable={editable}
      multiline={multiline}
      placeholderTextColor={colors.muted}
      selectionColor={colors.brand}
      cursorColor={colors.brand}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.input,
        multiline && {
          minHeight: 120,
          paddingTop: 12,
          textAlignVertical: "top",
        },
        focused && styles.inputFocused,
        invalid && styles.inputInvalid,
        !editable && styles.inputDisabled,
        !!icon && { paddingLeft: 42 },
        style,
      ]}
    />
  );
  if (!icon) return field;
  // Baştaki simge (ör. arama) girdinin içinde, metnin solunda durur.
  return (
    <View>
      {field}
      <Ionicons
        name={icon}
        size={18}
        color={colors.muted}
        pointerEvents="none"
        style={{ position: "absolute", left: 14, top: 15 }}
      />
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const { styles, section } = useTheme();
  return (
    <View style={styles.field}>
      <View style={section.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {required === false && (
          <Text style={styles.caption}>{t("common.optional")}</Text>
        )}
      </View>
      {children}
      {!!error && <Text style={section.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/** Yatay seçim denetimi (shadcn Tabs görünümü); tam genişlik düğme yığınlarının
 *  yerini alır. */
export function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string; icon?: IconName }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const { colors, section } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={section.segmented}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(o.value)}
            android_ripple={ripple()}
            style={({ pressed }) => [
              section.segment,
              selected && section.segmentOn,
              pressed && !selected && { backgroundColor: colors.line },
            ]}
          >
            {!!o.icon && (
              <Ionicons
                name={o.icon}
                size={16}
                color={selected ? colors.ink : colors.muted}
              />
            )}
            <Text
              numberOfLines={1}
              style={[section.segmentText, selected && section.segmentTextOn]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Yatay kayan sekme şeridi (shadcn TabsList, web'deki öğrenci penceresiyle
 *  aynı). Sekme sayısı ekrana sığmadığında kaydırılır. */
export function TabStrip({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { colors, section } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{ flexGrow: 0, marginHorizontal: 20, marginTop: 14 }}
      contentContainerStyle={[
        section.segmented,
        { flexWrap: "nowrap", flexGrow: 1 },
      ]}
    >
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.id)}
            android_ripple={ripple()}
            style={({ pressed }) => [
              section.segment,
              { flexBasis: "auto", flexGrow: 0, paddingHorizontal: 14 },
              on && section.segmentOn,
              pressed && !on && { backgroundColor: colors.line },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[section.segmentText, on && section.segmentTextOn]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Form penceresi                                                      */
/* ------------------------------------------------------------------ */

export type Field = {
  key: string;
  label: string;
  value?: string;
  required?: boolean;
  multiline?: boolean;
  keyboard?: "default" | "email-address" | "decimal-pad";
  secure?: boolean;
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
};
export type FormSpec = {
  title: string;
  description?: string;
  submit_label?: string;
  fields: Field[];
  submit: (values: Record<string, string>) => Promise<void>;
};

/**
 * Yalnızca simgeli eylem düğmesi (shadcn Button size="icon"). Ad erişilebilirlik
 * etiketinde kalır. `count` okunmamış sayısını fosforlu rozetle gösterir.
 */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  danger = false,
  ghost = false,
  selected = false,
  count = 0,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  ghost?: boolean;
  selected?: boolean;
  count?: number;
}) {
  const { colors, section } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        count ? t("common.unreadLabel", { label, count }) : label
      }
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      android_ripple={ripple()}
      style={({ pressed }) => [
        section.iconButton,
        ghost && section.iconGhost,
        danger && { borderColor: colors.dangerLine },
        selected && { backgroundColor: colors.brandSoft },
        pressed &&
          !disabled && {
            backgroundColor: danger ? colors.dangerSoft : colors.sunken,
          },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Ionicons
        name={icon}
        size={19}
        color={danger ? colors.danger : selected ? colors.brand : colors.text}
      />
      {count > 0 && (
        <View style={section.count}>
          <Text style={section.countText}>{count > 9 ? "9+" : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Uzun listeden tek seçim. Segmented yalnızca iki üç seçenek için uygun;
 * öğrenci listesi gibi büyüyen listelerde arama yapılabilen bir katman gerekir
 * (web tarafındaki Select'in mobil karşılığı).
 */
export function Picker({
  value,
  options,
  onChange,
  label,
  placeholder = t("common.choose"),
}: {
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const { colors, styles, section } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const needle = lower(query.trim());
  const shown = needle
    ? options.filter((o) => lower(o.label).includes(needle))
    : options;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        android_ripple={ripple()}
        style={({ pressed }) => [
          styles.input,
          section.pickerTrigger,
          pressed && styles.inputFocused,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.text,
            { flex: 1, color: colors.ink },
            !selected && { color: colors.muted },
          ]}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={17} color={colors.muted} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={section.pickerBackdrop}>
          <SafeAreaView edges={["bottom"]} style={section.pickerSheet}>
            <View style={section.grabber} />
            <View style={section.pickerHead}>
              <Text style={section.sheetTitle}>
                {label ?? t("common.choose")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                onPress={() => setOpen(false)}
                hitSlop={8}
                style={({ pressed }) => [
                  section.close,
                  pressed && { backgroundColor: colors.line },
                ]}
              >
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>
            {options.length > 7 && (
              <Input
                placeholder={t("common.search")}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            )}
            <ScrollView
              style={{ maxHeight: 360 }}
              keyboardShouldPersistTaps="handled"
            >
              {!shown.length && (
                <Text style={[styles.muted, { padding: 14 }]}>
                  {t("common.noMatch")}
                </Text>
              )}
              {shown.map((o) => {
                const on = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    android_ripple={ripple()}
                    style={({ pressed }) => [
                      section.pickerRow,
                      (pressed || on) && { backgroundColor: colors.sunken },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.text, on && { color: colors.ink }]}>
                        {o.label}
                      </Text>
                      {!!o.hint && <Text style={styles.caption}>{o.hint}</Text>}
                    </View>
                    {on && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.brand}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

/** Görünüm seçimi: web'deki tema düğmesiyle aynı üç seçenek. */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <Segmented
      label={t("common.appearance")}
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={[
        { value: "light", label: t("theme.light"), icon: "sunny-outline" },
        { value: "dark", label: t("theme.dark"), icon: "moon-outline" },
        {
          value: "system",
          label: t("theme.system"),
          icon: "phone-portrait-outline",
        },
      ]}
    />
  );
}

export function FormSheet({
  form,
  onClose,
}: {
  form: FormSpec | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={!!form}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {form && <FormBody key={form.title} form={form} onClose={onClose} />}
    </Modal>
  );
}

/**
 * Segmented yalnızca üç kısa seçeneğe kadar okunur kalıyor; öğrenci, paket ya
 * da ders gibi büyüyen listeler web'deki Select gibi ayrı bir seçim katmanında
 * açılır.
 */
const pickFromList = (options: { label: string }[]) =>
  options.length > 3 || options.some((o) => o.label.length > 18);

function FormBody({ form, onClose }: { form: FormSpec; onClose: () => void }) {
  const { colors, styles, section } = useTheme();
  const [values, setValues] = useState(
      Object.fromEntries(
        form.fields.map((f) => [f.key, f.value || f.options?.[0]?.value || ""]),
      ),
    ),
    [busy, setBusy] = useState(false),
    [missing, setMissing] = useState<string[]>([]),
    [error, setError] = useState("");
  const set = (key: string, text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    setMissing((m) => m.filter((k) => k !== key));
  };
  async function save() {
    setError("");
    const empty = form.fields
      .filter((f) => f.required !== false && !values[f.key]?.trim())
      .map((f) => f.key);
    setMissing(empty);
    if (empty.length) {
      setError(t("common.fillMarked"));
      return;
    }
    setBusy(true);
    try {
      await form.submit(values);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      edges={["top", "bottom"]}
    >
      <View style={section.sheetHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle} numberOfLines={1}>
            {form.title}
          </Text>
          {!!form.description && (
            <Text style={styles.muted} numberOfLines={2}>
              {form.description}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          disabled={busy}
          onPress={onClose}
          android_ripple={ripple()}
          hitSlop={8}
          style={({ pressed }) => [
            section.close,
            pressed && { backgroundColor: colors.line },
          ]}
        >
          <Ionicons name="close" size={20} color={colors.ink} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.body, { gap: 20 }]}
        >
          {form.fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={f.hint}
              required={f.required}
              error={missing.includes(f.key) ? t("common.required") : undefined}
            >
              {f.options && pickFromList(f.options) ? (
                <Picker
                  label={f.label}
                  options={f.options}
                  value={values[f.key]}
                  onChange={(next) => set(f.key, next)}
                />
              ) : f.options ? (
                <Segmented
                  label={f.label}
                  options={f.options}
                  value={values[f.key]}
                  onChange={(next) => set(f.key, next)}
                />
              ) : (
                <Input
                  accessibilityLabel={f.label}
                  invalid={missing.includes(f.key)}
                  value={values[f.key]}
                  onChangeText={(text) => set(f.key, text)}
                  placeholder={f.placeholder}
                  keyboardType={f.keyboard || "default"}
                  multiline={f.multiline}
                  secureTextEntry={f.secure}
                  editable={!busy}
                  autoCapitalize={
                    f.keyboard === "email-address" ? "none" : "sentences"
                  }
                  autoCorrect={f.keyboard !== "email-address"}
                  maxLength={f.multiline ? 5000 : f.secure ? 128 : 200}
                />
              )}
            </Field>
          ))}
          <ErrorText message={error} />
        </ScrollView>
        <View style={section.footer}>
          <Button
            secondary
            disabled={busy}
            onPress={onClose}
            style={{ flex: 1 }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            loading={busy}
            onPress={() => void save()}
            style={{ flex: 2 }}
          >
            {busy
              ? t("learn.savingEllipsis")
              : form.submit_label || t("common.save")}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function confirmAction(
  title: string,
  description: string,
  perform: () => Promise<void>,
  onError: (e: string) => void,
) {
  Alert.alert(title, description, [
    { text: t("common.cancel"), style: "cancel" },
    {
      text: t("common.confirm"),
      onPress: () => {
        void perform().catch((e) => onError((e as Error).message));
      },
    },
  ]);
}
