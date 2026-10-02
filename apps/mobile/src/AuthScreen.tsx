import React, { useEffect, useMemo, useState } from "react";
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
import { AppleMark, GoogleMark, MicrosoftMark } from "./brand-icons";
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
  Brand,
  Button,
  ErrorText,
  Field,
  GridTexture,
  Input,
  Kicker,
  type Palette,
  radius,
  SuccessText,
  TextLink,
  type Typography,
  useTheme,
} from "./ui";
import { t, upper, type MessageKey } from "@derslik/contracts";
import { LanguagePicker } from "./i18n";
import { captchaEnabled, Turnstile } from "./Turnstile";

const copy: Record<
  "signin" | "signup" | "recover" | "password",
  { title: MessageKey; lead: MessageKey; submit: MessageKey }
> = {
  signin: {
    title: "auth.signinTitle",
    lead: "mobile.authSigninLead",
    submit: "auth.signIn",
  },
  signup: {
    title: "mobile.authSignupTitle",
    lead: "mobile.authSignupLead",
    submit: "auth.signUp",
  },
  recover: {
    title: "auth.recoverTitle",
    lead: "mobile.authRecoverLead",
    submit: "auth.sendReset",
  },
  password: {
    title: "auth.passwordTitle",
    lead: "mobile.authPasswordLead",
    submit: "auth.savePassword",
  },
};
type Mode = keyof typeof copy;

export function AuthScreen({
  reset = false,
  onDone,
}: Readonly<{
  reset?: boolean;
  onDone?: () => void;
}>) {
  const { colors, styles, type } = useTheme();
  const auth = useMemo(() => makeAuth(colors, type), [colors, type]);
  const [mode, setMode] = useState<Mode>(reset ? "password" : "signin"),
    [shownReset, setShownReset] = useState(reset);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState<SocialProvider[]>([]);
  const [providerNotice, setProviderNotice] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRound, setCaptchaRound] = useState(0);
  // Şifre ekranı zaten açık bir oturumda çalışır; CAPTCHA istemez.
  const captcha = captchaEnabled && mode !== "password";
  useEffect(() => {
    let alive = true;
    availableProviders()
      .then((list) => {
        if (!alive) return;
        setEnabled(list);
        if (!list.length) setProviderNotice(t("mobile.authProvidersSoon"));
      })
      .catch(() => {
        if (alive) setProviderNotice(t("auth.providersUnreachable"));
      });
    return () => {
      alive = false;
    };
  }, []);
  // Switch to the new-password form when a recovery link arrives later.
  if (reset !== shownReset) {
    setShownReset(reset);
    if (reset) setMode("password");
  }
  const changeMode = (next: Mode) => {
    setMode(next);
    setError("");
    setMessage("");
    setPassword("");
    setVisible(false);
  };
  async function startSocial(id: SocialProvider) {
    setBusy(id);
    setError("");
    try {
      await socialSignIn(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function submit() {
    if (busy) return;
    setError("");
    setMessage("");
    const issue = formIssue(mode, password, captcha, captchaToken);
    if (issue) {
      setError(issue);
      return;
    }
    const captchaOptions = captcha ? { captchaToken } : {};
    setBusy("email");
    try {
      if (mode === "password") {
        await savePassword(password);
        onDone?.();
        return;
      }
      const note = await emailAuth(
        mode,
        email.trim(),
        password,
        captchaOptions,
      );
      if (note) setMessage(note);
    } catch (e) {
      setError(
        (e as { code?: string }).code === "captcha_failed"
          ? t("auth.captchaFailed")
          : (e as Error).message,
      );
    } finally {
      setBusy(null);
      // Belirteç tek kullanımlık; sonraki deneme yenisini alır.
      if (captcha) {
        setCaptchaToken("");
        setCaptchaRound((n) => n + 1);
      }
    }
  }
  const text = copy[mode];
  // Tanıtım başlığı yalnızca giriş ve kayıtta; şifre ekranlarında form daha
  // yukarıda kalsın diye yalnızca logo görünür.
  const intro = mode === "signin" || mode === "signup";
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.navy }]}
      edges={["top", "bottom", "left", "right"]}
    >
      <StatusBar style="light" />
      <GridTexture />
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
            <Brand inverse />
            {intro && (
              <View style={auth.story}>
                <Text style={auth.storyLabel}>
                  {upper(t("auth.storyLabel"))}
                </Text>
                <View>
                  <Text style={auth.headline}>{t("auth.storyTitle1")}</Text>
                  <View style={auth.mark}>
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={[auth.headline, { color: colors.markerInk }]}
                    >
                      {t("auth.storyTitle2")}
                    </Text>
                  </View>
                </View>
                <Text style={auth.heroLead}>{t("auth.storyBody")}</Text>
              </View>
            )}
          </View>

          <View style={auth.card}>
            <View style={{ gap: 8 }}>
              <Kicker>{t("auth.account")}</Kicker>
              <Text style={auth.title}>{t(text.title)}</Text>
              <Text style={styles.muted}>{t(text.lead)}</Text>
            </View>

            {(mode === "signin" || mode === "signup") && (
              <SocialProviders
                auth={auth}
                enabled={enabled}
                busy={busy}
                notice={providerNotice}
                onSelect={(id) => void startSocial(id)}
              />
            )}

            {mode !== "password" && (
              <EmailField
                mode={mode}
                value={email}
                busy={busy}
                onChange={setEmail}
                onSubmit={() => void submit()}
              />
            )}

            {mode !== "recover" && (
              <PasswordField
                auth={auth}
                mode={mode}
                value={password}
                visible={visible}
                busy={busy}
                onChange={setPassword}
                onToggleVisible={() => setVisible(!visible)}
                onSubmit={() => void submit()}
              />
            )}

            {mode === "signin" && (
              <View style={auth.forgot}>
                <TextLink
                  disabled={!!busy}
                  onPress={() => changeMode("recover")}
                >
                  {t("auth.forgot")}
                </TextLink>
              </View>
            )}

            {captcha && (
              <Turnstile
                round={captchaRound}
                onToken={setCaptchaToken}
                onError={() => setError(t("auth.captchaFailed"))}
              />
            )}
            <ErrorText message={error} />
            <SuccessText message={message} />

            <Button
              loading={busy === "email"}
              disabled={!!busy}
              onPress={() => void submit()}
              trailingIcon={busy === "email" ? undefined : "arrow-forward"}
            >
              {busy === "email" ? t("auth.processing") : t(text.submit)}
            </Button>

            {mode === "recover" && (
              <View style={auth.backRow}>
                <TextLink
                  icon="arrow-back"
                  disabled={!!busy}
                  onPress={() => changeMode("signin")}
                >
                  {t("mobile.authBackToSignin")}
                </TextLink>
              </View>
            )}

            {!reset && mode !== "recover" && (
              <ModeSwitch
                auth={auth}
                mode={mode}
                busy={busy}
                onChange={changeMode}
              />
            )}
          </View>

          <View style={auth.footer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={15}
              color={colors.onNavy}
            />
            <Text style={auth.footerText}>{t("auth.footnote")}</Text>
          </View>
          <View style={auth.language}>
            <LanguagePicker />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type AuthStyles = ReturnType<typeof makeAuth>;
/** CAPTCHA açıkken istekle giden belirteç; kapalıyken boş nesne. */
type CaptchaOptions = { captchaToken?: string };

/** Gönderimden önceki form denetimi; sorun yoksa null, varsa gösterilecek ileti. */
function formIssue(
  mode: Mode,
  password: string,
  captcha: boolean,
  captchaToken: string,
): string | null {
  if ((mode === "signup" || mode === "password") && password.length < 10)
    return t("web.passwordTooShort");
  if (mode === "signin" && !password) return t("mobile.authPasswordRequired");
  if (captcha && !captchaToken) return t("auth.captchaRequired");
  return null;
}

/** Açık oturumda yeni şifreyi kaydeder. */
async function savePassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) throw error;
}

/** E-postaya sıfırlama bağlantısı gönderir; gösterilecek iletiyi döndürür. */
async function requestReset(email: string, captchaOptions: CaptchaOptions) {
  const { error } = await supabase!.auth.resetPasswordForEmail(email, {
    ...captchaOptions,
    redirectTo: authRedirect("recovery"),
  });
  if (error) throw error;
  return t("mobile.authResetSent");
}

/** Hesap açar; oturum hemen gelmediyse doğrulama iletisini döndürür. */
async function createAccount(
  email: string,
  password: string,
  captchaOptions: CaptchaOptions,
) {
  const { data, error } = await supabase!.auth.signUp({
    email,
    password,
    options: {
      ...captchaOptions,
      emailRedirectTo: authRedirect("confirm"),
    },
  });
  if (error) throw error;
  if (!data.session) return t("mobile.authVerifyEmail");
}

async function signInWithEmail(
  email: string,
  password: string,
  captchaOptions: CaptchaOptions,
) {
  const { error } = await supabase!.auth.signInWithPassword({
    email,
    password,
    options: captchaOptions,
  });
  if (error)
    throw new Error(
      t(
        error.code === "captcha_failed"
          ? "auth.captchaFailed"
          : "web.signinFailed",
      ),
    );
}

/** E-posta tabanlı modlar (sıfırlama, kayıt, giriş); varsa gösterilecek ileti döner.
 *  Bilerek `async` değil: geçersiz e-posta hatası, `submit`'teki ilk `await`'ten
 *  önce eşzamanlı fırlar (tek çizim, `busy` hiç "email" görünmez). */
function emailAuth(
  mode: Exclude<Mode, "password">,
  email: string,
  password: string,
  captchaOptions: CaptchaOptions,
) {
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
    throw new Error(t("mobile.authEmailInvalid"));
  if (mode === "recover") return requestReset(email, captchaOptions);
  if (mode === "signup") return createAccount(email, password, captchaOptions);
  return signInWithEmail(email, password, captchaOptions);
}

function SocialProviders({
  auth,
  enabled,
  busy,
  notice,
  onSelect,
}: Readonly<{
  auth: AuthStyles;
  enabled: SocialProvider[];
  busy: string | null;
  notice: string;
  onSelect: (id: SocialProvider) => void;
}>) {
  const { colors, styles } = useTheme();
  return (
    <>
      <View style={auth.socialRow}>
        {providers.map((p) => {
          const off = !enabled.includes(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={t("auth.continueWith", {
                name: p.name,
              })}
              accessibilityState={{ disabled: !!busy || off }}
              disabled={!!busy || off}
              onPress={() => onSelect(p.id)}
              style={({ pressed }) => [
                auth.social,
                pressed && !off && auth.socialPressed,
                { opacity: off || busy ? 0.5 : 1 },
              ]}
            >
              {socialMark(p.id, colors.ink)}
              <Text style={auth.socialLabel} numberOfLines={1}>
                {busy === p.id ? t("auth.opening") : p.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!!notice && <Text style={styles.hint}>{notice}</Text>}
      <View style={auth.separator}>
        <View style={auth.line} />
        <Text style={auth.separatorText}>{t("auth.orEmail")}</Text>
        <View style={auth.line} />
      </View>
    </>
  );
}

function EmailField({
  mode,
  value,
  busy,
  onChange,
  onSubmit,
}: Readonly<{
  mode: Mode;
  value: string;
  busy: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <Field label={t("auth.email")}>
      <Input
        accessibilityLabel={t("auth.email")}
        value={value}
        onChangeText={onChange}
        placeholder={t("auth.emailPlaceholder")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!busy}
        maxLength={200}
        returnKeyType={mode === "recover" ? "go" : "next"}
        onSubmitEditing={mode === "recover" ? onSubmit : undefined}
      />
    </Field>
  );
}

function PasswordField({
  auth,
  mode,
  value,
  visible,
  busy,
  onChange,
  onToggleVisible,
  onSubmit,
}: Readonly<{
  auth: AuthStyles;
  mode: Mode;
  value: string;
  visible: boolean;
  busy: string | null;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
  onSubmit: () => void;
}>) {
  const { colors } = useTheme();
  return (
    <Field
      label={t("auth.password")}
      hint={mode === "signin" ? undefined : t("mobile.authPasswordHint")}
    >
      <View>
        <Input
          accessibilityLabel={t("auth.password")}
          value={value}
          onChangeText={onChange}
          placeholder={
            mode === "signin"
              ? t("auth.passwordPlaceholder")
              : t("auth.passwordMin")
          }
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          editable={!busy}
          maxLength={128}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          style={{ paddingRight: 52 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            visible ? t("auth.hidePassword") : t("auth.showPassword")
          }
          accessibilityState={{ selected: visible }}
          onPress={onToggleVisible}
          hitSlop={6}
          style={auth.reveal}
        >
          <Ionicons
            name={visible ? "eye-off-outline" : "eye-outline"}
            size={19}
            color={colors.muted}
          />
        </Pressable>
      </View>
    </Field>
  );
}

function ModeSwitch({
  auth,
  mode,
  busy,
  onChange,
}: Readonly<{
  auth: AuthStyles;
  mode: Mode;
  busy: string | null;
  onChange: (next: Mode) => void;
}>) {
  const { styles } = useTheme();
  return (
    <View style={auth.switch}>
      <Text style={styles.muted}>
        {mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount")}
      </Text>
      <TextLink
        disabled={!!busy}
        onPress={() => onChange(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? t("auth.signUp") : t("auth.signIn")}
      </TextLink>
    </View>
  );
}

function socialMark(id: SocialProvider, ink: string) {
  if (id === "google") return <GoogleMark size={20} />;
  if (id === "apple") return <AppleMark size={20} color={ink} />;
  return <MicrosoftMark size={20} />;
}

const makeAuth = (colors: Palette, type: Typography) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      justifyContent: "center",
      gap: 28,
      padding: 18,
      paddingTop: 28,
      paddingBottom: 28,
      width: "100%",
      maxWidth: 560,
      alignSelf: "center",
    },
    hero: { gap: 28, paddingHorizontal: 6 },
    story: { gap: 14 },
    // Web'deki .auth-story-label: fosforlu, aralıklı.
    storyLabel: {
      ...type.semibold,
      fontSize: 11,
      letterSpacing: 1.6,
      color: colors.marker,
    },
    headline: {
      ...type.heavy,
      fontSize: 34,
      lineHeight: 42,
      letterSpacing: -1.2,
      color: colors.onNavyStrong,
    },
    // Fosforlu kalem: web'deki .auth-story .ink-mark.
    mark: {
      alignSelf: "flex-start",
      marginTop: 2,
      paddingHorizontal: 7,
      borderRadius: 7,
      backgroundColor: colors.marker,
    },
    heroLead: {
      ...type.regular,
      color: colors.onNavy,
      fontSize: 15,
      lineHeight: 23,
      maxWidth: 360,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.sheet,
      borderWidth: 1,
      borderColor: colors.line,
      padding: 22,
      gap: 18,
      boxShadow: colors.shadowRaised,
    },
    title: {
      ...type.heavy,
      color: colors.ink,
      fontSize: 27,
      lineHeight: 33,
      letterSpacing: -0.8,
    },
    socialRow: { flexDirection: "row", gap: 8 },
    social: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 58,
      paddingHorizontal: 6,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.lineControl,
      backgroundColor: colors.surface,
      boxShadow: colors.shadowXs,
      gap: 5,
    },
    socialPressed: { backgroundColor: colors.sunken },
    socialLabel: { ...type.medium, fontSize: 12.5, color: colors.ink },
    separator: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    line: { flex: 1, height: 1, backgroundColor: colors.line },
    separatorText: { ...type.regular, fontSize: 12.5, color: colors.muted },
    reveal: {
      position: "absolute",
      right: 2,
      top: 2,
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.inner,
    },
    forgot: { alignSelf: "flex-end", marginTop: -6 },
    backRow: { alignItems: "center", paddingVertical: 4 },
    switch: {
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingHorizontal: 12,
    },
    language: { width: "100%", maxWidth: 240, alignSelf: "center" },
    footerText: {
      ...type.regular,
      textAlign: "center",
      color: colors.onNavy,
      fontSize: 12.5,
    },
  });
