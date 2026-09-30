import React, { useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { calendarLinks, t } from "@derslik/contracts";
import { request } from "./core";
import {
  Button,
  Card,
  confirmAction,
  ErrorText,
  SuccessText,
  TextLink,
  useTheme,
} from "./ui";

/**
 * Takvim aboneliği: önce tek bir düğme görünür, basınca kişiye özel bağlantı
 * alınır ve ekleme seçenekleri açılır. Bağlantı ilk istekte oluşur, sonra
 * hep aynısı döner.
 */
export function CalendarFeed() {
  const { colors, styles } = useTheme();
  const [url, setUrl] = useState(""),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const links = url ? calendarLinks(url) : null;
  async function toggle() {
    setError("");
    setNotice("");
    if (open || url) {
      setOpen(!open);
      return;
    }
    setLoading(true);
    try {
      const r = await request<{ data: { url: string } }>("/calendar", {});
      setUrl(r.data.url);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function openApp(address: string) {
    setError("");
    try {
      await Linking.openURL(address);
    } catch {
      setError(t("calendar.feedOpenFailed"));
    }
  }
  async function copy() {
    setError("");
    try {
      await setStringAsync(url);
      setCopied(true);
    } catch {
      setError(t("calendar.feedCopyManually"));
    }
  }
  const rotate = () =>
    confirmAction(
      t("calendar.feedRotateTitle"),
      t("calendar.feedRotateBody"),
      async () => {
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const r = await request<{ data: { url: string } }>(
            "/calendar/rotate",
            {},
          );
          setUrl(r.data.url);
          setCopied(false);
          setNotice(t("calendar.feedRotated"));
        } finally {
          setBusy(false);
        }
      },
      setError,
    );
  // iPhone'da Apple Takvim tek dokunuşla abone olur; Android'de önce Google
  // gelir, ama Google bağlantıyla eklemeyi yalnızca bilgisayarda yapar.
  // Google yerel adrese ulaşamaz; o zaman düğme gösterilmez.
  const apple = links && (
    <Button
      key="apple"
      secondary
      size="sm"
      trailingIcon="open-outline"
      onPress={() => void openApp(links.webcal)}
    >
      {t("calendar.feedApple")}
    </Button>
  );
  const google = links && !links.local && (
    <View key="google" style={{ gap: 6 }}>
      <Button
        secondary
        size="sm"
        trailingIcon="open-outline"
        onPress={() => void openApp(links.google)}
      >
        {t("calendar.feedGoogle")}
      </Button>
      <Text style={styles.caption}>{t("calendar.feedGoogleComputer")}</Text>
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      <Button
        secondary
        size="sm"
        icon="calendar-outline"
        trailingIcon={open ? "chevron-up" : "chevron-down"}
        loading={loading}
        style={{ alignSelf: "flex-start" }}
        onPress={() => void toggle()}
      >
        {t("calendar.feedButton")}
      </Button>
      {!open && <ErrorText message={error} />}
      {open && links && (
        <Card tone="brand">
          <View style={[styles.row, { gap: 6 }]}>
            <Ionicons name="calendar-outline" size={16} color={colors.brand} />
            <Text style={styles.label}>{t("calendar.feedTitle")}</Text>
          </View>
          <Text style={styles.muted}>{t("calendar.feedBody")}</Text>
          {Platform.OS === "ios" ? [apple, google] : [google, apple]}
          <Text style={styles.caption} numberOfLines={2} selectable>
            {links.url}
          </Text>
          <Button
            secondary
            size="sm"
            icon={copied ? "checkmark" : "copy-outline"}
            style={{ alignSelf: "flex-start" }}
            onPress={() => void copy()}
          >
            {copied ? t("ml.copied") : t("calendar.feedCopy")}
          </Button>
          {links.local ? (
            <Text style={styles.caption}>{t("calendar.feedLocal")}</Text>
          ) : (
            <Text style={styles.caption}>{t("calendar.feedDelay")}</Text>
          )}
          <Text style={styles.caption}>{t("calendar.feedOther")}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Ionicons
              name="lock-closed-outline"
              size={14}
              color={colors.faint}
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.caption, { flex: 1 }]}>
              {t("calendar.feedPrivate")}
            </Text>
          </View>
          <TextLink icon="refresh-outline" disabled={busy} onPress={rotate}>
            {t("calendar.feedRotate")}
          </TextLink>
          <ErrorText message={error} />
          <SuccessText message={notice} />
        </Card>
      )}
    </View>
  );
}
