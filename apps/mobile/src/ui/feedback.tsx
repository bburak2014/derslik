import React from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@derslik/contracts";
import { type IconName } from "./tokens";
import { useTheme } from "./theme";

/* ------------------------------------------------------------------ */
/* Boş, yükleniyor, hata ve onay durumları                             */
/* ------------------------------------------------------------------ */

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
