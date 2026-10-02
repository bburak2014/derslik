import React, { useState } from "react";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  dateKey,
  dayLabel,
  intlLocale,
  money,
  t,
  upper,
  type LessonPackage,
} from "@derslik/contracts";
import { type IconName, type Palette } from "./tokens";
import { useTheme } from "./theme";
import { ripple } from "./buttons";

/* ------------------------------------------------------------------ */
/* Kaplar                                                              */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  tone = "plain",
  onPress,
  style,
  onLayout,
}: Readonly<{
  children: React.ReactNode;
  tone?: "plain" | "brand" | "muted";
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  onLayout?: ViewProps["onLayout"];
}>) {
  const { colors, styles } = useTheme();
  const toned = cardTone(tone, colors);
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

function cardTone(tone: "plain" | "brand" | "muted", colors: Palette) {
  if (tone === "brand")
    return { backgroundColor: colors.brandSoft, borderColor: colors.brandLine };
  if (tone === "muted")
    return {
      backgroundColor: colors.sunken,
      borderColor: colors.line,
      boxShadow: "none",
    };
  return null;
}

/** Alt sayfa ve seçicilerin kapat düğmesi. */
export function CloseButton({
  onPress,
  disabled,
}: Readonly<{
  onPress: () => void;
  disabled?: boolean;
}>) {
  const { colors, section } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.close")}
      disabled={disabled}
      onPress={onPress}
      android_ripple={ripple()}
      hitSlop={8}
      style={({ pressed }) => [
        section.close,
        pressed && { backgroundColor: colors.line },
      ]}
    >
      <Ionicons name="close" size={20} color={colors.ink} />
    </Pressable>
  );
}

/** Ders paketi kartı: kalan hak rozeti, toplam ve ücret. Öğretmen görünümü
 *  altına son kullanım tarihini ekler. */
export function PackageCard({
  pack,
  children,
}: Readonly<{
  pack: Pick<LessonPackage, "name" | "remaining" | "granted" | "price_minor">;
  children?: React.ReactNode;
}>) {
  const { styles } = useTheme();
  const low = pack.remaining <= 2;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Text style={[styles.h2, { flex: 1 }]}>{pack.name}</Text>
        <Badge
          tone={low ? "warning" : "info"}
          icon={low ? "alert-circle-outline" : undefined}
        >
          {t("common.creditCount", { count: pack.remaining })}
        </Badge>
      </View>
      <Text style={styles.muted}>
        {t("mt.creditsOf", {
          remaining: pack.remaining,
          granted: pack.granted,
        })}{" "}
        · {money(pack.price_minor)}
      </Text>
      {children}
    </Card>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: Readonly<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}>) {
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
}: Readonly<{
  children: string;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}>) {
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
}: Readonly<{
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  icon?: IconName;
}>) {
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
      {badgeGlyph(icon, dot, palette.fg, section)}
      <Text
        numberOfLines={1}
        style={[section.badgeText, { color: palette.fg }]}
      >
        {children}
      </Text>
    </View>
  );
}

function badgeGlyph(
  icon: IconName | undefined,
  dot: boolean,
  fg: string,
  section: ReturnType<typeof useTheme>["section"],
) {
  if (icon) return <Ionicons name={icon} size={12} color={fg} />;
  if (dot) return <View style={[section.badgeDot, { backgroundColor: fg }]} />;
  return null;
}

/** Ders durumu rozeti: web'deki Status bileşeninin karşılığı. */
export function LessonStatus({
  status,
  endsAt,
}: Readonly<{
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  /** Verilirse, bitişi geçmiş ama hâlâ planlı ders "onay bekliyor" görünür. */
  endsAt?: string;
}>) {
  // Ekran açıldığı andaki saat yeterli; liste yenilenince yeniden bakılır.
  const [now] = useState(() => Date.now());
  if (status === "SCHEDULED" && endsAt && Date.parse(endsAt) < now)
    return (
      <Badge tone="warning" dot>
        {t("lesson.awaitingConfirmation")}
      </Badge>
    );
  if (status === "COMPLETED")
    return (
      <Badge tone="success" icon="checkmark">
        {t("lesson.completed")}
      </Badge>
    );
  if (status === "CANCELLED")
    return (
      <Badge tone="neutral" dot>
        {t("lesson.cancelled")}
      </Badge>
    );
  return (
    <Badge tone="info" dot>
      {t("lesson.scheduled")}
    </Badge>
  );
}

/** Baş harfli avatar. Renk web'deki StudentAvatar ile aynı hesaplanır; aynı
 *  öğrenci iki uygulamada da aynı tonda görünür. */
export function Avatar({
  name,
  size = 40,
}: Readonly<{ name: string; size?: number }>) {
  const { colors, section } = useTheme();
  const index =
    Array.from(name).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) % 4;
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
export function DateTile({ date }: Readonly<{ date: string }>) {
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
}: Readonly<{
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}>) {
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
export function List({ children }: Readonly<{ children: React.ReactNode }>) {
  const { section } = useTheme();
  return <View style={section.list}>{children}</View>;
}

/** Liste satırı. İlk satır dışındakiler üst ayraç çizer (`divider`). */
export function ListRow({
  children,
  onPress,
  divider = false,
  accessibilityLabel,
}: Readonly<{
  children: React.ReactNode;
  onPress?: () => void;
  divider?: boolean;
  accessibilityLabel?: string;
}>) {
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
}: Readonly<{
  items: { label: string; value: React.ReactNode }[];
}>) {
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
}: Readonly<{
  label: string;
  used: number;
  limit: number;
  unit?: string;
}>) {
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
