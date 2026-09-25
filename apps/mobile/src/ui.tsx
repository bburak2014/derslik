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
  type ViewStyle,
} from "react-native";
import {
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
} from "expo-secure-store";

const THEME_KEY = "derslik.theme";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

// Android'de basma geri bildirimi ripple ile verilir; iOS'ta opaklık değişimi
// kullanılır. Tek yerde tanımlanır ki her dokunulabilir öğe aynı hissi versin.
export const ripple = (light = false) =>
  Platform.OS === "android"
    ? { color: light ? "rgba(255,255,255,0.18)" : "rgba(13,29,41,0.10)", borderless: false }
    : undefined;

// Web ile birebir aynı değerler (apps/web/app/globals.css açık tema bloğu).
// İki palet elle senkron tutuluyordu ve birbirinden kaymıştı; kaynak orası,
// buradaki her değerin karşılığı orada bir belirteç.
export const lightColors = {
  // Marka
  green: "#0f7a62", // --brand
  greenDark: "#0a5f4c", // --brand-hover
  greenSoft: "#e4f2ee", // --brand-soft
  greenBorder: "#a7d4c6", // --brand-line
  onBrand: "#ffffff", // --on-brand
  navy: "#122c3e", // --navy
  navySoft: "#1d3c51", // --navy-soft
  onNavy: "#a8bfcf", // navy üzerindeki ikincil metin
  playerSurface: "#172e24", // oynatıcı boşluğu

  // Metin — hepsi yüzey ve tuval üzerinde AA (4.5:1)
  ink: "#0d1d29", // --ink
  body: "#2c4153", // --text
  muted: "#51657a", // --text-muted
  faint: "#5c7084", // --text-subtle  (eski #8ea0b2 yalnızca 2.68:1 veriyordu)

  // Yüzeyler
  white: "#ffffff", // --surface
  cream: "#f3f6f8", // --canvas
  subtle: "#e8edf2", // --surface-sunken

  // Çizgiler: dekoratif ayraç ile kontrol kenarlığı ayrı.
  line: "#dae2e9", // --line         (kart kenarı, ayraç)
  lineStrong: "#7e8f9e", // --line-control (girdi sınırı, 3:1)

  // Durumlar
  red: "#ae3226", // --danger
  redSoft: "#fdf1ef", // --danger-soft
  redBorder: "#efc7bf", // --danger-line
  amber: "#7e5310", // --warn
  amberSoft: "#fcf4e5", // --warn-soft
  amberBorder: "#e8d3ab", // --warn-line
  info: "#1a5578", // --info
  infoSoft: "#ecf5fa", // --info-soft
  infoBorder: "#c6deec", // --info-line

  // Kimlik tonları — yalnızca ayırt etmek için; durum renklerinden ayrık.
  tint1Bg: "#e2f1ec",
  tint1Fg: "#0c6a55",
  tint2Bg: "#e6edf4",
  tint2Fg: "#2d5a80",
  tint3Bg: "#ebe9f6",
  tint3Fg: "#4c4494",
  tint4Bg: "#f5e9e4",
  tint4Fg: "#8a4a33",

  overlay: "rgba(13,29,41,0.45)",
};

export type Palette = typeof lightColors;

// Koyu tema — web'deki light-dark() çiftlerinin ikinci değerleri
// (apps/web/app/globals.css). Anahtarlar açık paletle birebir aynı, böylece
// hiçbir kullanım satırı değişmiyor.
export const darkColors: Palette = {
  green: "#4ecba5", // --brand
  greenDark: "#6fd9b8", // --brand-hover
  greenSoft: "#13332c", // --brand-soft
  greenBorder: "#2a5f51", // --brand-line
  onBrand: "#08110c", // --on-brand
  navy: "#0a1219", // --navy
  navySoft: "#1c2a37", // --navy-soft
  onNavy: "#a8bfcf",
  playerSurface: "#172e24",

  ink: "#eaf0f5", // --ink
  body: "#c3d1dc", // --text
  muted: "#94a7b8", // --text-muted
  faint: "#8698a9", // --text-subtle

  white: "#141f2a", // --surface
  cream: "#0c151e", // --canvas
  subtle: "#1c2a37", // --surface-sunken

  line: "#2a3b4a", // --line
  lineStrong: "#5a7086", // --line-control

  red: "#f09a8c", // --danger
  redSoft: "#2e1a16", // --danger-soft
  redBorder: "#5c332c", // --danger-line
  amber: "#e3b872", // --warn
  amberSoft: "#2b2113", // --warn-soft
  amberBorder: "#544022", // --warn-line
  info: "#8dc5e6", // --info
  infoSoft: "#122531", // --info-soft
  infoBorder: "#27485c", // --info-line

  tint1Bg: "#16332c",
  tint1Fg: "#5ccfaa",
  tint2Bg: "#17293a",
  tint2Fg: "#87bce4",
  tint3Bg: "#241f3d",
  tint3Fg: "#a99ce8",
  tint4Bg: "#33211b",
  tint4Fg: "#e0a48c",

  overlay: "rgba(0,0,0,0.6)",
};

// surface: veri yüzeyi (kart, panel) — çizgili kâğıt hissi
// action: eylem öğesi (düğme, girdi, segment)
// pill: durum rozeti — veriden ayrışsın
export const radius = {
  surface: 6,
  action: 8,
  sm: 8,
  md: 8,
  lg: 6,
  xl: 10,
  pill: 999,
};
export const rail = 3;
export const space = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 };

const shadow = (level: 1 | 2 | 3) =>
  Platform.select({
    ios: {
      shadowColor: "#0f2231",
      shadowOffset: { width: 0, height: level * 2 },
      shadowOpacity: 0.03 + level * 0.015,
      shadowRadius: level * 6,
    },
    android: { elevation: level },
    default: {},
  })!;

// Gölge yalnızca gerçekten yüzen yüzeyler için. Veri yüzeyleri (kart, metrik,
// segment) çizgiyle ayrışır; bu, "defter" biçim dilinin temel kuralı.
export const elevation = { floating: shadow(3) };

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  body: { padding: 20, paddingBottom: 44, gap: 16 },

  // Typography
  brand: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.9,
    color: colors.ink,
  },
  title: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: colors.ink,
  },
  h2: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: colors.ink,
  },
  text: { fontSize: 15, lineHeight: 23, color: colors.body },
  muted: { fontSize: 13.5, lineHeight: 21, color: colors.muted },
  caption: { fontSize: 12, lineHeight: 17, color: colors.faint },
  kicker: {
    fontSize: 10.5,
    letterSpacing: 0.75,
    fontWeight: "700",
    color: colors.green,
    textTransform: "uppercase",
  },
  label2: {
    fontSize: 10.5,
    letterSpacing: 0.75,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
  },

  // Layout
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.surface,
    padding: 16,
    gap: 10,
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
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },

  // Buttons
  button: {
    minHeight: 50,
    borderRadius: radius.action,
    paddingVertical: 13,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.green,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.1,
    color: colors.white,
  },
  secondary: {
    backgroundColor: colors.white,
    borderColor: colors.lineStrong,
    borderWidth: 1,
  },
  secondaryText: { color: colors.ink },
  ghost: { backgroundColor: "transparent" },
  ghostText: { color: colors.green },
  danger: { backgroundColor: colors.redSoft, borderColor: colors.redBorder },
  dangerText: { color: colors.red },
  buttonSmall: {
    // 48: Android'in 48dp'si iOS'un 44pt'sini de kapsıyor, tek değer yetiyor.
    minHeight: 48,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  buttonSmallText: { fontSize: 13.5 },

  // Form
  field: { gap: 7 },
  label: {
    fontSize: 13.5,
    fontWeight: "600",
    letterSpacing: -0.1,
    color: colors.ink,
  },
  hint: { fontSize: 12.5, lineHeight: 18, color: colors.muted },
  input: {
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    borderRadius: radius.action,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 52,
    backgroundColor: colors.white,
    fontSize: 16,
    color: colors.ink,
  },
  inputFocused: {
    borderColor: colors.green,
    backgroundColor: colors.white,
    ...Platform.select({
      ios: {
        shadowColor: colors.green,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 5,
      },
      default: {},
    }),
  },
  inputInvalid: { borderColor: colors.redBorder, backgroundColor: colors.redSoft },
  inputDisabled: { backgroundColor: colors.subtle, color: colors.muted },

  // Feedback
  error: {
    padding: 13,
    paddingHorizontal: 14,
    backgroundColor: colors.redSoft,
    borderWidth: 1,
    borderColor: colors.redBorder,
    color: colors.red,
    borderRadius: radius.md,
    fontSize: 13.5,
    lineHeight: 20,
  },
  success: {
    padding: 13,
    paddingHorizontal: 14,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.greenBorder,
    borderRadius: radius.md,
  },

  // Tabs
  tabs: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 2,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  tab: {
    flex: 1,
    minHeight: 54,
    paddingVertical: 7,
    gap: 3,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radius.md,
  },
  tabText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    textAlign: "center",
  },

  // Data
  metric: {
    flex: 1,
    minWidth: 140,
    padding: 16,
    paddingLeft: 16 - rail,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: rail,
    borderLeftColor: colors.greenBorder,
    borderRadius: radius.surface,
    gap: 4,
  },
  metricValue: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.9,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  });

const makeSection = (colors: Palette) =>
  StyleSheet.create({
    iconButton: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.action,
      borderWidth: 1.5,
      borderColor: colors.lineStrong,
      backgroundColor: colors.white,
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
      backgroundColor: colors.white,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 18,
      paddingTop: 16,
      gap: 12,
    },
    pickerHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pickerClose: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingHorizontal: 12,
      borderRadius: radius.action,
    },
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 11.5, fontWeight: "600", letterSpacing: 0.1 },
  empty: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: "dashed",
    backgroundColor: colors.white,
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.greenSoft,
  },
  alert: {
    flexDirection: "row",
    gap: 10,
    padding: 13,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.redBorder,
    backgroundColor: colors.redSoft,
  },
  alertSuccess: {
    borderColor: colors.greenBorder,
    backgroundColor: colors.greenSoft,
  },
  alertText: { flex: 1, fontSize: 13.5, lineHeight: 20, color: colors.red },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fieldError: { fontSize: 12.5, lineHeight: 18, color: colors.red },
  segmented: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    padding: 4,
    borderRadius: radius.action,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.subtle,
  },
  segment: {
    flexGrow: 1,
    flexBasis: 90,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  segmentOn: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.greenBorder,
  },
  segmentText: { fontSize: 14, fontWeight: "600", color: colors.muted },
  segmentTextOn: { color: colors.green, fontWeight: "700" },
  close: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.subtle,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  });

const themes = {
  light: {
    colors: lightColors,
    styles: makeStyles(lightColors),
    section: makeSection(lightColors),
  },
  dark: {
    colors: darkColors,
    styles: makeStyles(darkColors),
    section: makeSection(darkColors),
  },
};

export type ThemeMode = "light" | "dark" | "system";
type ThemeValue = {
  colors: Palette;
  styles: ReturnType<typeof makeStyles>;
  section: ReturnType<typeof makeSection>;
  scheme: "light" | "dark";
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeValue>({
  ...themes.light,
  scheme: "light",
  mode: "system",
  setMode: () => {},
});

/**
 * Tema sağlayıcı. `mode` üç değerli: cihazı izle (system) ya da sabitle.
 * Seçim cihazda saklanır; web'deki tema düğmesiyle aynı davranış.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const device = useColorScheme();
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
  const value = useMemo(
    () => ({ ...themes[scheme], scheme, mode, setMode }),
    [scheme, mode, setMode],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Bileşenler bunu `const { colors, styles } = useTheme()` diye kullanır;
 *  böylece mevcut `colors.x` / `styles.y` satırları aynen çalışır. */
export function useTheme() {
  return useContext(ThemeContext);
}


/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onPress,
  secondary = false,
  variant,
  size = "md",
  icon,
  loading = false,
  disabled = false,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  /** Kept for existing call sites; equivalent to variant="secondary". */
  secondary?: boolean;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, styles } = useTheme();
  const kind: ButtonVariant = variant || (secondary ? "secondary" : "primary");
  const inactive = disabled || loading;
  const surface =
    kind === "secondary"
      ? styles.secondary
      : kind === "ghost"
        ? styles.ghost
        : kind === "danger"
          ? [styles.secondary, styles.danger]
          : null;
  const label =
    kind === "secondary"
      ? styles.secondaryText
      : kind === "ghost"
        ? styles.ghostText
        : kind === "danger"
          ? styles.dangerText
          : null;
  const tint =
    kind === "primary"
      ? colors.white
      : kind === "danger"
        ? colors.red
        : kind === "ghost"
          ? colors.green
          : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      android_ripple={ripple(kind === "primary")}
      style={({ pressed }) => [
        styles.button,
        surface,
        size === "sm" && styles.buttonSmall,
        { opacity: inactive ? 0.45 : pressed ? 0.78 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : icon ? (
        <Ionicons name={icon} size={size === "sm" ? 16 : 18} color={tint} />
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
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Containers                                                          */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  tone = "plain",
  onPress,
  style,
}: {
  children: React.ReactNode;
  tone?: "plain" | "brand" | "muted";
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, styles } = useTheme();
  const toned =
    tone === "brand"
      ? { backgroundColor: colors.greenSoft, borderColor: colors.greenBorder }
      : tone === "muted"
        ? { backgroundColor: colors.subtle, borderColor: colors.line }
        : null;
  if (!onPress)
    return <View style={[styles.card, toned, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={ripple()}
      style={({ pressed }) => [
        styles.card,
        toned,
        pressed && { backgroundColor: colors.subtle, borderColor: colors.lineStrong },
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
        <Text style={styles.h2}>{title}</Text>
        {!!description && <Text style={styles.muted}>{description}</Text>}
      </View>
      {action}
    </View>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const { colors, section } = useTheme();
  const palette = {
    neutral: { bg: colors.subtle, fg: colors.muted, br: colors.line },
    success: { bg: colors.greenSoft, fg: colors.greenDark, br: colors.greenBorder },
    warning: { bg: colors.amberSoft, fg: colors.amber, br: "#f0dcb4" },
    danger: { bg: colors.redSoft, fg: colors.red, br: colors.redBorder },
  }[tone];
  return (
    <View
      style={[
        section.badge,
        { backgroundColor: palette.bg, borderColor: palette.br },
      ]}
    >
      <Text style={[section.badgeText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

export function EmptyState({
  icon = "sparkles-outline",
  title,
  description,
  action,
}: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const { colors, styles, section } = useTheme();
  return (
    <View style={section.empty}>
      <View style={section.emptyIcon}>
        <Ionicons name={icon} size={22} color={colors.green} />
      </View>
      <Text style={[styles.h2, { textAlign: "center" }]}>{title}</Text>
      {!!description && (
        <Text style={[styles.muted, { textAlign: "center" }]}>
          {description}
        </Text>
      )}
      {action}
    </View>
  );
}

/** Yükleme göstergesi: yalnızca dönen simge. Metin ekran okuyucuda kalır,
 *  ekranda "yükleniyor" yazısı görünmez (web ile aynı davranış). */
export function Loading({ label = "Yükleniyor" }) {
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
      <ActivityIndicator size="large" color={colors.green} />
    </View>
  );
}

export function ErrorText({ message }: { message: string }) {
  const { colors, section } = useTheme();
  return message ? (
    <View style={section.alert}>
      <Ionicons
        name="alert-circle"
        size={18}
        color={colors.red}
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
        name="checkmark-circle"
        size={18}
        color={colors.greenDark}
        style={{ marginTop: 1 }}
      />
      <Text
        accessibilityRole="alert"
        style={[section.alertText, { color: colors.greenDark }]}
      >
        {message}
      </Text>
    </View>
  ) : null;
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Input({
  invalid = false,
  multiline,
  style,
  onFocus,
  onBlur,
  editable = true,
  ...rest
}: TextInputProps & { invalid?: boolean }) {
  const { colors, styles } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...rest}
      editable={editable}
      multiline={multiline}
      placeholderTextColor={colors.faint}
      selectionColor={colors.green}
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
          minHeight: 122,
          paddingTop: 13,
          textAlignVertical: "top",
        },
        focused && styles.inputFocused,
        invalid && styles.inputInvalid,
        !editable && styles.inputDisabled,
        style,
      ]}
    />
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
          <Text style={styles.caption}>isteğe bağlı</Text>
        )}
      </View>
      {children}
      {!!error && <Text style={section.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/** Horizontal choice control; replaces stacks of full-width buttons. */
export function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
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
              pressed && !selected && { backgroundColor: colors.subtle },
            ]}
          >
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

/* ------------------------------------------------------------------ */
/* Form sheet                                                          */
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
 * Yalnızca ikonlu eylem düğmesi. Liste satırlarında üç tam genişlik düğme
 * kartı şişiriyordu; ad erişilebilirlik etiketinde kalır. Hedef 48 dp.
 */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { colors, section } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={ripple()}
      style={({ pressed }) => [
        section.iconButton,
        danger && { borderColor: colors.redBorder },
        pressed &&
          !disabled && {
            backgroundColor: danger ? colors.redSoft : colors.subtle,
          },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Ionicons
        name={icon}
        size={19}
        color={danger ? colors.red : colors.body}
      />
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
  placeholder = "Seçin",
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
  const needle = query.trim().toLocaleLowerCase("tr");
  const shown = needle
    ? options.filter((o) => o.label.toLocaleLowerCase("tr").includes(needle))
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
          pressed && { borderColor: colors.green },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.text,
            { flex: 1 },
            !selected && { color: colors.faint },
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
            <View style={section.pickerHead}>
              <Text style={styles.h2}>{label ?? "Seçin"}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setOpen(false)}
                hitSlop={10}
                style={section.pickerClose}
              >
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {options.length > 7 && (
              <Input
                placeholder="Ara…"
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
                  Eşleşen kayıt yok.
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
                      (pressed || on) && { backgroundColor: colors.greenSoft },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.text, on && { color: colors.green }]}>
                        {o.label}
                      </Text>
                      {!!o.hint && <Text style={styles.caption}>{o.hint}</Text>}
                    </View>
                    {on && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.green}
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

/** Görünüm seçimi — web'deki tema düğmesiyle aynı üç seçenek. */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <Segmented
      label="Görünüm"
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={[
        { value: "light", label: "Açık" },
        { value: "dark", label: "Koyu" },
        { value: "system", label: "Sistem" },
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
      setError("Lütfen işaretli alanları doldurun.");
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
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.h2} numberOfLines={1}>
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
          accessibilityLabel="Kapat"
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
          contentContainerStyle={[styles.body, { gap: 18 }]}
        >
          {form.fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={f.hint}
              required={f.required}
              error={missing.includes(f.key) ? "Bu alan gerekli." : undefined}
            >
              {f.options ? (
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
            Vazgeç
          </Button>
          <Button loading={busy} onPress={() => void save()} style={{ flex: 2 }}>
            {busy ? "Kaydediliyor…" : form.submit_label || "Kaydet"}
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
    { text: "Vazgeç", style: "cancel" },
    {
      text: "Onayla",
      onPress: () => {
        void perform().catch((e) => onError((e as Error).message));
      },
    },
  ]);
}

