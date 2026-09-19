import React, { useState } from "react";
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
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

export const colors = {
  // Brand
  green: "#0f7a62",
  greenDark: "#0a5f4c",
  greenSoft: "#e6f4f0",
  greenBorder: "#b7ded2",
  navy: "#132c3d",
  // Text
  ink: "#0f2231",
  body: "#33485c",
  muted: "#64798c",
  faint: "#8ea0b2",
  // Surfaces
  white: "#fff",
  cream: "#f5f7fa",
  subtle: "#eef2f7",
  line: "#e3e9f0",
  lineStrong: "#cbd6e2",
  // Status
  red: "#b23a2c",
  redSoft: "#fdf1ef",
  redBorder: "#f1cec7",
  amber: "#8a5a10",
  amberSoft: "#fdf5e6",
  overlay: "rgba(15,34,49,0.45)",
};

export const radius = { sm: 10, md: 12, lg: 16, xl: 22, pill: 999 };
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

export const elevation = {
  card: shadow(1),
  raised: shadow(2),
  floating: shadow(3),
};

export const styles = StyleSheet.create({
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
    fontSize: 11,
    letterSpacing: 1.1,
    fontWeight: "700",
    color: colors.green,
    textTransform: "uppercase",
  },

  // Layout
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 18,
    gap: 10,
    ...shadow(1),
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
    borderRadius: radius.md,
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
    minHeight: 40,
    paddingVertical: 9,
    paddingHorizontal: 14,
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
    borderColor: colors.line,
    borderRadius: radius.md,
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
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    gap: 4,
    ...shadow(1),
  },
  metricValue: {
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.9,
    color: colors.ink,
  },
});

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

export function Loading({ label = "Çalışma alanınız açılıyor…" }) {
  return (
    <View
      style={[
        styles.screen,
        { alignItems: "center", justifyContent: "center", gap: 16 },
      ]}
    >
      <ActivityIndicator color={colors.green} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorText({ message }: { message: string }) {
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

const section = StyleSheet.create({
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
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.subtle,
  },
  segment: {
    flexGrow: 1,
    flexBasis: 90,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  segmentOn: {
    backgroundColor: colors.white,
    ...shadow(1),
  },
  segmentText: { fontSize: 14, fontWeight: "600", color: colors.muted },
  segmentTextOn: { color: colors.green, fontWeight: "700" },
  close: {
    width: 40,
    height: 40,
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
