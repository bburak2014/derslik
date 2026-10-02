import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "@derslik/contracts";
import { useTheme } from "./theme";
import { Button } from "./buttons";
import { CloseButton } from "./containers";
import { ErrorText } from "./feedback";
import { Input, Field, Segmented, Picker } from "./form-controls";

/* ------------------------------------------------------------------ */
/* Form penceresi                                                      */
/* ------------------------------------------------------------------ */

export type FormField = {
  key: string;
  label: string;
  value?: string;
  required?: boolean;
  multiline?: boolean;
  keyboard?: "default" | "email-address" | "decimal-pad";
  secure?: boolean;
  hint?: string;
  placeholder?: string;
  /** Varsayılan: çok satırlıda 5000, parolada 128, diğerlerinde 200. */
  maxLength?: number;
  options?: { value: string; label: string }[];
};
export type FormSpec = {
  title: string;
  description?: string;
  submit_label?: string;
  fields: FormField[];
  submit: (values: Record<string, string>) => Promise<void>;
};

export function FormSheet({
  form,
  onClose,
}: Readonly<{
  form: FormSpec | null;
  onClose: () => void;
}>) {
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

/**
 * Segmented yalnızca üç kısa seçeneğe kadar okunur kalıyor; öğrenci, paket ya
 * da ders gibi büyüyen listeler web'deki Select gibi ayrı bir seçim katmanında
 * açılır.
 */
const pickFromList = (options: { label: string }[]) =>
  options.length > 3 || options.some((o) => o.label.length > 18);

function FormBody({
  form,
  onClose,
}: Readonly<{ form: FormSpec; onClose: () => void }>) {
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
      setError(t("common.fillMarked"));
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
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      edges={["top", "bottom"]}
    >
      <View style={section.sheetHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle} numberOfLines={1}>
            {form.title}
          </Text>
          {!!form.description && (
            <Text style={styles.muted} numberOfLines={2}>
              {form.description}
            </Text>
          )}
        </View>
        <CloseButton onPress={onClose} disabled={busy} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.body, { gap: 20 }]}
        >
          {form.fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={f.hint}
              required={f.required}
              error={missing.includes(f.key) ? t("common.required") : undefined}
            >
              <FieldControl
                field={f}
                value={values[f.key]}
                invalid={missing.includes(f.key)}
                busy={busy}
                onChange={(next) => set(f.key, next)}
              />
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
            {t("common.cancel")}
          </Button>
          <Button
            loading={busy}
            onPress={() => void save()}
            style={{ flex: 2 }}
          >
            {busy
              ? t("learn.savingEllipsis")
              : form.submit_label || t("common.save")}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldControl({
  field: f,
  value,
  invalid,
  busy,
  onChange,
}: Readonly<{
  field: FormField;
  value: string;
  invalid: boolean;
  busy: boolean;
  onChange: (next: string) => void;
}>) {
  if (f.options && pickFromList(f.options))
    return (
      <Picker
        label={f.label}
        options={f.options}
        value={value}
        onChange={onChange}
      />
    );
  if (f.options)
    return (
      <Segmented
        label={f.label}
        options={f.options}
        value={value}
        onChange={onChange}
      />
    );
  return (
    <Input
      accessibilityLabel={f.label}
      invalid={invalid}
      value={value}
      onChangeText={onChange}
      placeholder={f.placeholder}
      keyboardType={f.keyboard || "default"}
      multiline={f.multiline}
      secureTextEntry={f.secure}
      editable={!busy}
      autoCapitalize={f.keyboard === "email-address" ? "none" : "sentences"}
      autoCorrect={f.keyboard !== "email-address"}
      maxLength={f.maxLength ?? defaultMaxLength(f)}
    />
  );
}

function defaultMaxLength(f: FormField) {
  if (f.multiline) return 5000;
  return f.secure ? 128 : 200;
}
