import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { supabase } from "./core";
import {
  authRedirect,
  availableProviders,
  providers,
  socialSignIn,
  type SocialProvider,
} from "./oauth";
import {
  Button,
  colors,
  ErrorText,
  Field,
  Input,
  radius,
  styles,
  SuccessText,
} from "./ui";

const copy = {
  signin: {
    title: "Tekrar hoş geldiniz",
    lead: "Derslerinize ve öğrencilerinize kaldığınız yerden devam edin.",
    submit: "Giriş yap",
  },
  signup: {
    title: "Birlikte başlayalım",
    lead: "Öğretmen, öğrenci ve veli için ortak bir çalışma alanı.",
    submit: "Hesap oluştur",
  },
  recover: {
    title: "Şifrenizi mi unuttunuz?",
    lead: "Kayıtlı e-posta adresinize sıfırlama bağlantısı gönderelim.",
    submit: "Sıfırlama bağlantısı gönder",
  },
  password: {
    title: "Yeni şifrenizi belirleyin",
    lead: "En az 10 karakterli, tahmin edilmesi zor bir şifre seçin.",
    submit: "Yeni şifreyi kaydet",
  },
} as const;
type Mode = keyof typeof copy;

export function AuthScreen({
  reset = false,
  onDone,
}: {
  reset?: boolean;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(reset ? "password" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState<SocialProvider[]>([]);
  const [providerNotice, setProviderNotice] = useState("");
  useEffect(() => {
    let alive = true;
    availableProviders()
      .then((list) => {
        if (!alive) return;
        setEnabled(list);
        if (!list.length)
          setProviderNotice("Diğer giriş seçenekleri henüz kullanıma açılmadı.");
      })
      .catch(() => {
        if (alive)
          setProviderNotice(
            "Diğer giriş seçeneklerine ulaşılamadı. E-posta ile devam edebilirsiniz.",
          );
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (reset) setMode("password");
  }, [reset]);
  const changeMode = (next: Mode) => {
    setMode(next);
    setError("");
    setMessage("");
    setPassword("");
    setVisible(false);
  };
  async function submit() {
    if (busy) return;
    setError("");
    setMessage("");
    if ((mode === "signup" || mode === "password") && password.length < 10) {
      setError("Şifre en az 10 karakter olmalı.");
      return;
    }
    if (mode === "signin" && !password) {
      setError("Şifrenizi girin.");
      return;
    }
    setBusy("email");
    try {
      if (mode === "password") {
        const { error } = await supabase!.auth.updateUser({ password });
        if (error) throw error;
        onDone?.();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
        throw new Error("Geçerli bir e-posta adresi girin.");
      if (mode === "recover") {
        const { error } = await supabase!.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: authRedirect("recovery") },
        );
        if (error) throw error;
        setMessage(
          "Şifre sıfırlama bağlantısı için e-posta kutunuzu kontrol edin.",
        );
      } else if (mode === "signup") {
        const { data, error } = await supabase!.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirect("confirm") },
        });
        if (error) throw error;
        if (!data.session)
          setMessage("E-posta kutunuzdaki bağlantıyla hesabınızı doğrulayın.");
      } else {
        const { error } = await supabase!.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error)
          throw new Error(
            "Giriş yapılamadı. Bilgilerinizi ve e-posta doğrulamanızı kontrol edin.",
          );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const text = copy[mode];
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.navy }]}
      edges={["top", "bottom", "left", "right"]}
    >
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={auth.container}
        >
          <View style={auth.hero}>
            <View style={auth.header}>
              <View style={auth.brandIcon}>
                <Text style={auth.brandLetter}>d.</Text>
              </View>
              <Text style={auth.brand}>
                derslik<Text style={{ color: colors.greenBorder }}>.</Text>
              </Text>
            </View>
            <Text style={auth.heroLead}>
              Dersleriniz. Öğrencileriniz. Tek bir yer.
            </Text>
          </View>

          <View style={auth.card}>
            <Text style={styles.kicker}>Derslik hesabı</Text>
            <Text style={auth.title}>{text.title}</Text>
            <Text style={[styles.muted, { marginBottom: 4 }]}>{text.lead}</Text>

            {(mode === "signin" || mode === "signup") && (
              <>
                <View style={auth.socialRow}>
                  {providers.map((p) => {
                    const off = !enabled.includes(p.id);
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.name} ile devam et`}
                        accessibilityState={{ disabled: !!busy || off }}
                        disabled={!!busy || off}
                        onPress={async () => {
                          setBusy(p.id);
                          setError("");
                          try {
                            await socialSignIn(p.id);
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(null);
                          }
                        }}
                        style={({ pressed }) => [
                          auth.social,
                          pressed && !off && auth.socialPressed,
                          { opacity: off || busy ? 0.45 : 1 },
                        ]}
                      >
                        <Ionicons
                          name={
                            p.id === "google"
                              ? "logo-google"
                              : p.id === "apple"
                                ? "logo-apple"
                                : "logo-microsoft"
                          }
                          size={21}
                          color={colors.ink}
                        />
                        <Text style={auth.socialLabel} numberOfLines={1}>
                          {busy === p.id ? "Açılıyor…" : p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!!providerNotice && (
                  <Text style={styles.hint}>{providerNotice}</Text>
                )}
                <View style={auth.separator}>
                  <View style={auth.line} />
                  <Text style={auth.separatorText}>veya e-posta ile</Text>
                  <View style={auth.line} />
                </View>
              </>
            )}

            {mode !== "password" && (
              <Field label="E-posta adresi">
                <Input
                  accessibilityLabel="E-posta adresi"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="ornek@eposta.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  editable={!busy}
                  maxLength={200}
                  returnKeyType={mode === "recover" ? "go" : "next"}
                  onSubmitEditing={
                    mode === "recover" ? () => void submit() : undefined
                  }
                />
              </Field>
            )}

            {mode !== "recover" && (
              <Field
                label="Şifre"
                hint={
                  mode === "signin" ? undefined : "En az 10 karakter kullanın."
                }
              >
                <View>
                  <Input
                    accessibilityLabel="Şifre"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={
                      mode === "signin" ? "Şifrenizi girin" : "En az 10 karakter"
                    }
                    secureTextEntry={!visible}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    editable={!busy}
                    maxLength={128}
                    returnKeyType="go"
                    onSubmitEditing={() => void submit()}
                    style={{ paddingRight: 56 }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      visible ? "Şifreyi gizle" : "Şifreyi göster"
                    }
                    accessibilityState={{ selected: visible }}
                    onPress={() => setVisible(!visible)}
                    hitSlop={6}
                    style={auth.reveal}
                  >
                    <Ionicons
                      name={visible ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>
              </Field>
            )}

            {mode === "signin" && (
              <Pressable
                accessibilityRole="button"
                disabled={!!busy}
                style={auth.forgot}
                onPress={() => changeMode("recover")}
              >
                <Text style={auth.link}>Şifremi unuttum</Text>
              </Pressable>
            )}

            <ErrorText message={error} />
            <SuccessText message={message} />

            <Button
              loading={busy === "email"}
              disabled={!!busy}
              onPress={() => void submit()}
              style={{ marginTop: 2 }}
            >
              {busy === "email" ? "İşleniyor…" : text.submit}
            </Button>

            {mode === "recover" && (
              <Pressable
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => changeMode("signin")}
                style={auth.backRow}
              >
                <Ionicons name="arrow-back" size={16} color={colors.green} />
                <Text style={auth.link}>Girişe dön</Text>
              </Pressable>
            )}

            {!reset && mode !== "recover" && (
              <View style={auth.switch}>
                <Text style={styles.muted}>
                  {mode === "signin"
                    ? "Henüz hesabınız yok mu?"
                    : "Zaten hesabınız var mı?"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy}
                  style={auth.switchLink}
                  onPress={() =>
                    changeMode(mode === "signin" ? "signup" : "signin")
                  }
                >
                  <Text style={auth.link}>
                    {mode === "signin" ? "Hesap oluştur" : "Giriş yap"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={auth.footer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={15}
              color={colors.greenBorder}
            />
            <Text style={auth.footerText}>
              Hesabınız web ve mobilde birlikte çalışır.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const auth = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    gap: 20,
    padding: 18,
    paddingBottom: 28,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  hero: { gap: 10, paddingHorizontal: 6, paddingTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandIcon: {
    width: 42,
    height: 42,
    backgroundColor: colors.green,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: {
    color: colors.white,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -1.6,
  },
  brand: {
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -1,
    color: colors.white,
  },
  heroLead: { color: "#a8bfcf", fontSize: 14.5, lineHeight: 21 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: 22,
    gap: 14,
  },
  title: {
    color: colors.ink,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  socialRow: { flexDirection: "row", gap: 8 },
  social: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 62,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
    gap: 5,
  },
  socialPressed: {
    borderColor: colors.greenBorder,
    backgroundColor: colors.greenSoft,
  },
  socialLabel: { fontSize: 12, fontWeight: "600", color: colors.ink },
  separator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 2,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.line },
  separatorText: { fontSize: 12.5, color: colors.muted },
  reveal: {
    position: "absolute",
    right: 2,
    top: 2,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  link: { color: colors.green, fontSize: 14, fontWeight: "700" },
  forgot: {
    alignSelf: "flex-end",
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 4,
    marginTop: -8,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 48,
  },
  switch: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  switchLink: { minHeight: 48, justifyContent: "center", paddingHorizontal: 4 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  footerText: { textAlign: "center", color: "#a8bfcf", fontSize: 12.5 },
});
