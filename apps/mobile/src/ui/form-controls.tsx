import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { lower, t } from "@derslik/contracts";
import { type IconName, type Palette, radius } from "./tokens";
import { type ThemeMode, useTheme } from "./theme";
import { ripple } from "./buttons";
import { CloseButton } from "./containers";

/* ------------------------------------------------------------------ */
/* Form denetimleri                                                    */
/* ------------------------------------------------------------------ */

export function Input({
  invalid = false,
  multiline,
  style,
  onFocus,
  onBlur,
  editable = true,
  icon,
  ...rest
}: TextInputProps & { invalid?: boolean; icon?: IconName }) {
  const { colors, styles } = useTheme();
  const [focused, setFocused] = useState(false);
  const field = (
    <TextInput
      {...rest}
      editable={editable}
      multiline={multiline}
      placeholderTextColor={colors.muted}
      selectionColor={colors.brand}
      cursorColor={colors.brand}
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
          minHeight: 120,
          paddingTop: 12,
          textAlignVertical: "top",
        },
        focused && styles.inputFocused,
        invalid && styles.inputInvalid,
        !editable && styles.inputDisabled,
        !!icon && { paddingLeft: 42 },
        style,
      ]}
    />
  );
  if (!icon) return field;
  // Baştaki simge (ör. arama) girdinin içinde, metnin solunda durur.
  return (
    <View>
      {field}
      <Ionicons
        name={icon}
        size={18}
        color={colors.muted}
        pointerEvents="none"
        style={{ position: "absolute", left: 14, top: 15 }}
      />
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  const { styles, section } = useTheme();
  return (
    <View style={styles.field}>
      <View style={section.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {required === false && (
          <Text style={styles.caption}>{t("common.optional")}</Text>
        )}
      </View>
      {children}
      {!!error && <Text style={section.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/** Yatay seçim denetimi (shadcn Tabs görünümü); tam genişlik düğme yığınlarının
 *  yerini alır. */
export function Segmented({
  options,
  value,
  onChange,
  label,
}: Readonly<{
  options: { value: string; label: string; icon?: IconName }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}>) {
  const { colors, section } = useTheme();
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
            android_ripple={ripple()}
            style={({ pressed }) => [
              section.segment,
              selected && section.segmentOn,
              pressed && !selected && { backgroundColor: colors.line },
            ]}
          >
            {!!o.icon && (
              <Ionicons
                name={o.icon}
                size={16}
                color={selected ? colors.ink : colors.muted}
              />
            )}
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

/** Çoklu seçim çipleri (web'deki ToggleGroup type="multiple"). `max` dolunca
 *  seçili olmayanlar kapanır. */
export function ChipGroup({
  options,
  value,
  onChange,
  label,
  max,
}: Readonly<{
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  max?: number;
}>) {
  const { colors, type } = useTheme();
  const full = max !== undefined && value.length >= max;
  return (
    <View
      accessibilityLabel={label}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
    >
      {options.map((o) => {
        const on = value.includes(o.value),
          disabled = !on && full;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() =>
              onChange(
                on ? value.filter((v) => v !== o.value) : [...value, o.value],
              )
            }
            android_ripple={ripple()}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              minHeight: 36,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.brandLine : colors.lineControl,
              backgroundColor: chipBackground(colors, on, pressed),
              opacity: disabled ? 0.45 : 1,
            })}
          >
            {on && <Ionicons name="checkmark" size={14} color={colors.brand} />}
            <Text
              style={{
                ...type.medium,
                fontSize: 13.5,
                color: on ? colors.ink : colors.text,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function chipBackground(colors: Palette, on: boolean, pressed: boolean) {
  if (on) return colors.brandSoft;
  return pressed ? colors.sunken : colors.surface;
}

/** Aç/kapa anahtarı (shadcn Switch), etiketi ve açıklamasıyla bir satır. */
export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}>) {
  const { colors, styles } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>{label}</Text>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.lineControl, true: colors.brand }}
        thumbColor={colors.surface}
        // react-native-web açık konumda kendi rengini kullanır.
        {...{ activeThumbColor: colors.surface }}
        ios_backgroundColor={colors.lineControl}
      />
    </View>
  );
}

/** Yatay kayan sekme şeridi (shadcn TabsList, web'deki öğrenci penceresiyle
 *  aynı). Sekme sayısı ekrana sığmadığında kaydırılır. */
export function TabStrip({
  tabs,
  value,
  onChange,
}: Readonly<{
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}>) {
  const { colors, section } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{
        flexGrow: 0,
        flexShrink: 0,
        marginHorizontal: 20,
        marginTop: 14,
      }}
      contentContainerStyle={[
        section.segmented,
        { flexWrap: "nowrap", flexGrow: 1 },
      ]}
    >
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.id)}
            android_ripple={ripple()}
            style={({ pressed }) => [
              section.segment,
              { flexBasis: "auto", flexGrow: 0, paddingHorizontal: 14 },
              on && section.segmentOn,
              pressed && !on && { backgroundColor: colors.line },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[section.segmentText, on && section.segmentTextOn]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Uzun listeden tek seçim. Segmented yalnızca iki üç seçenek için uygun;
 * öğrenci listesi gibi büyüyen listelerde arama yapılabilen bir katman gerekir
 * (web tarafındaki Select'in mobil karşılığı).
 */
export function Picker({
  value,
  options,
  onChange,
  label,
  placeholder = t("common.choose"),
  pill,
}: Readonly<{
  value: string;
  options: {
    value: string;
    label: string;
    hint?: string;
    icon?: React.ReactNode;
  }[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  /** Filtre hapı: "Etiket: seçim" yazan yuvarlak düğme; boş değer dışında
   *  bir seçim yapılınca marka tonuna geçer. */
  pill?: { icon: IconName };
}>) {
  const { colors, styles, section, type } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const needle = lower(query.trim());
  const shown = needle
    ? options.filter((o) => lower(o.label).includes(needle))
    : options;
  const on = !!pill && !!value;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        android_ripple={ripple()}
        style={({ pressed }) =>
          pill
            ? [
                section.pillTrigger,
                on && {
                  borderColor: colors.brandLine,
                  backgroundColor: colors.brandSoft,
                },
                pressed && !on && { backgroundColor: colors.sunken },
              ]
            : [
                styles.input,
                section.pickerTrigger,
                pressed && styles.inputFocused,
              ]
        }
      >
        {pill ? (
          <>
            <Ionicons
              name={pill.icon}
              size={15}
              color={on ? colors.brand : colors.muted}
            />
            <Text numberOfLines={1} style={[type.medium, section.pillText]}>
              {!!label && (
                <Text style={{ color: colors.muted }}>{label}: </Text>
              )}
              <Text style={{ color: on ? colors.brand : colors.ink }}>
                {selected?.label ?? placeholder}
              </Text>
            </Text>
            <Ionicons
              name="chevron-down"
              size={14}
              color={on ? colors.brand : colors.muted}
            />
          </>
        ) : (
          <>
            {selected?.icon}
            <Text
              numberOfLines={1}
              style={[
                styles.text,
                { flex: 1, color: colors.ink },
                !selected && { color: colors.muted },
              ]}
            >
              {selected?.label ?? placeholder}
            </Text>
            <Ionicons name="chevron-down" size={17} color={colors.muted} />
          </>
        )}
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={section.pickerBackdrop}>
          <SafeAreaView edges={["bottom"]} style={section.pickerSheet}>
            <View style={section.grabber} />
            <View style={section.pickerHead}>
              <Text style={section.sheetTitle}>
                {label ?? t("common.choose")}
              </Text>
              <CloseButton onPress={() => setOpen(false)} />
            </View>
            {options.length > 7 && (
              <Input
                placeholder={t("common.search")}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            )}
            <ScrollView
              style={{ maxHeight: 360 }}
              keyboardShouldPersistTaps="handled"
            >
              {!shown.length && (
                <Text style={[styles.muted, { padding: 14 }]}>
                  {t("common.noMatch")}
                </Text>
              )}
              {shown.map((o) => {
                const on = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    android_ripple={ripple()}
                    style={({ pressed }) => [
                      section.pickerRow,
                      (pressed || on) && { backgroundColor: colors.sunken },
                    ]}
                  >
                    {o.icon}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.text, on && { color: colors.ink }]}>
                        {o.label}
                      </Text>
                      {!!o.hint && <Text style={styles.caption}>{o.hint}</Text>}
                    </View>
                    {on && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.brand}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

/** Görünüm seçimi: web'deki tema düğmesiyle aynı üç seçenek. */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <Segmented
      label={t("common.appearance")}
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={[
        { value: "light", label: t("theme.light"), icon: "sunny-outline" },
        { value: "dark", label: t("theme.dark"), icon: "moon-outline" },
        {
          value: "system",
          label: t("theme.system"),
          icon: "phone-portrait-outline",
        },
      ]}
    />
  );
}
