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
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";
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

/** "derslik." yazısı. Açık yüzeyde lacivert karo + marka noktası; mürekkep
 *  zeminde (giriş ekranı) beyaz yazı + fosforlu nokta, web'deki gibi.
 *  `compact` dar başlıklarda yalnızca karoyu çizer. */
export function Brand({
  inverse = false,
  compact = false,
}: Readonly<{
  inverse?: boolean;
  compact?: boolean;
}>) {
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
      {!compact && (
        <Text style={[styles.brand, inverse && { color: colors.onNavyStrong }]}>
          derslik
          <Text style={{ color: inverse ? colors.marker : colors.brand }}>
            .
          </Text>
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
