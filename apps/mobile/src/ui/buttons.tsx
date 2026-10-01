import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@derslik/contracts";
import { type IconName } from "./tokens";
import { useTheme } from "./theme";

/* ------------------------------------------------------------------ */
/* Düğmeler                                                            */
/* ------------------------------------------------------------------ */

// Android'de basma geri bildirimi ripple ile verilir; iOS'ta zemin değişimi
// kullanılır. Tek yerde tanımlanır ki her dokunulabilir öğe aynı hissi versin.
export const ripple = (light = false) =>
  Platform.OS === "android"
    ? {
        color: light ? "rgba(255,255,255,0.16)" : "rgba(18,26,68,0.08)",
        borderless: false,
      }
    : undefined;

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
