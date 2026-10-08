import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, Pattern, Rect, Stop } from "react-native-svg";
import { BRAND_NAME, MARK_VIEWBOX, ROYAL_GRADIENT, brand, capParts, markParts } from "@derslik/contracts/brand";
import { type IconName } from "./tokens";
import { useTheme } from "./theme";
import { ripple } from "./buttons";

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

/** Tutorwise Academy işareti (@derslik/contracts/brand): lacivert kısımlar
 *  `ink` rengini alır (açık temada lacivert, koyu zeminde açık); sayfalar
 *  kendi renklerinde. */
export function BrandMark({ size, ink }: Readonly<{ size: number; ink: string }>) {
  const { x, y, width, height } = MARK_VIEWBOX;
  const g = ROYAL_GRADIENT;
  return (
    <Svg width={(size * width) / height} height={size} viewBox={`${x} ${y} ${width} ${height}`}>
      <Defs>
        <LinearGradient id="tutorwise-royal" gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
          <Stop offset="0" stopColor={brand.royal[0]} />
          <Stop offset="1" stopColor={brand.royal[1]} />
        </LinearGradient>
      </Defs>
      <Path fill={ink} d={markParts.cover.left} />
      <Path fill={ink} d={markParts.cover.right} />
      <Path fill={brand.orange} d={markParts.upper.left} />
      <Path fill={brand.sky} d={markParts.upper.right} />
      <Path fill={brand.sky} d={markParts.lower.left} />
      <Path fill="url(#tutorwise-royal)" d={markParts.lower.right} />
      <Path fill={ink} stroke={ink} strokeWidth={6} strokeLinejoin="round" d={capParts.top} />
      <Path fill={ink} d={capParts.base} />
      <Path fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" d={capParts.cord} />
      <Circle fill={ink} cx={capParts.knob.cx} cy={capParts.knob.cy} r={capParts.knob.r} />
      <Path fill={ink} d={capParts.tassel} />
    </Svg>
  );
}

/** Marka: işaret ve "Tutorwise" yazısı. Mürekkep zeminde (giriş ekranı)
 *  açık renkte ve biraz büyük. `compact` dar başlıklarda yalnızca işareti çizer. */
export function Brand({
  inverse = false,
  compact = false,
}: Readonly<{
  inverse?: boolean;
  compact?: boolean;
}>) {
  const { colors, styles, section } = useTheme();
  const ink = inverse ? colors.onNavyStrong : colors.ink;
  return (
    <View
      style={section.brandRow}
      accessible
      accessibilityRole="header"
      accessibilityLabel={BRAND_NAME}
    >
      <BrandMark size={inverse ? 34 : 28} ink={ink} />
      {!compact && (
        <Text style={[styles.brand, inverse && { color: colors.onNavyStrong }]}>
          {BRAND_NAME}
        </Text>
      )}
    </View>
  );
}

/** Öne çıkan mürekkep panel (web: Bugün paneli, lacivert istatistik kartı). */
export function InkPanel({
  children,
  style,
}: Readonly<{
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}>) {
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
}: Readonly<{
  items: { id: string; label: string; icon: IconName }[];
  value: string;
  onChange: (id: string) => void;
}>) {
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
