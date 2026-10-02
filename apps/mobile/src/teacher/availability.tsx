import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@derslik/api-client";
import {
  CANCEL_PRESETS,
  DURATION_PRESETS,
  NOTICE_PRESETS,
  bookingSettingsSchema,
  dateKey,
  halfHourOptions,
  isMessageKey,
  nextWindow,
  presetOptions,
  settingsIssues,
  t,
  weekdayName,
  type BookingSettings,
} from "@derslik/contracts";
import { client } from "../core";
import {
  Button,
  Card,
  CloseButton,
  ErrorText,
  Field,
  IconButton,
  Input,
  Loading,
  Picker,
  SectionHeading,
  Toggle,
  useTheme,
} from "../ui";

// Öğretmenin müsaitliği (web: components/derslik/availability-dialog.tsx).

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const TIMES = halfHourOptions();
const STARTS = TIMES.slice(0, -1).map((v) => ({ value: v, label: v }));
const ENDS = TIMES.slice(1).map((v) => ({ value: v, label: v }));
/** Şema iletisi bir çeviri anahtarıysa etkin dilde; değilse genel uyarı. */
const issueText = (message: string) =>
  isMessageKey(message) ? t(message) : t("api.invalidFields");

type Props = {
  workspaceId: string;
  onClose: () => void;
  onSaved: (settings: BookingSettings) => void;
};

export function AvailabilitySheet({
  visible,
  ...props
}: Props & { visible: boolean }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      {visible && <AvailabilityBody {...props} />}
    </Modal>
  );
}

function AvailabilityBody({ workspaceId, onClose, onSaved }: Readonly<Props>) {
  const { colors, styles, section } = useTheme();
  const [form, setForm] = useState<BookingSettings | null>(null),
    [issues, setIssues] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setForm((await client.booking(workspaceId)).data);
      setIssues({});
      setStale(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  /** Formu değiştirir; eski satır hataları artık yanlış satırı gösterebilir. */
  const edit = (change: (f: BookingSettings) => BookingSettings) => {
    setIssues({});
    setForm((f) => (f ? change(f) : f));
  };
  async function save() {
    if (!form || busy) return;
    const parsed = bookingSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setIssues(settingsIssues(parsed.error.issues));
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved((await client.saveBooking(workspaceId, parsed.data)).data);
      onClose();
    } catch (e) {
      // 409: ayar başka yerde (ör. webde) kaydedilmiş; yeniden yükleme sunulur.
      setStale(e instanceof ApiError && e.status === 409);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rowIssue = (key: string) =>
    issues[key] ? (
      <Text style={section.fieldError}>{issueText(issues[key])}</Text>
    ) : null;
  const numberOptions = (
    presets: readonly number[],
    current: number,
    label: (n: number) => string,
  ) =>
    presetOptions(presets, current).map((n) => ({
      value: String(n),
      label: label(n),
    }));
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      edges={["top", "bottom"]}
    >
      <View style={section.sheetHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle} numberOfLines={1}>
            {t("booking.title")}
          </Text>
          <Text style={styles.muted} numberOfLines={2}>
            {t("booking.description")}
          </Text>
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
          {!form ? (
            <LoadFallback error={error} onRetry={() => void load()} />
          ) : (
            <>
              <Toggle
                label={t("booking.enabled")}
                hint={t("booking.enabledHint")}
                value={form.enabled}
                onChange={(enabled) => edit((f) => ({ ...f, enabled }))}
              />
              <SectionHeading
                title={t("booking.weeklyHours")}
                description={t("booking.weeklyHoursHint")}
              />
              {!!issues.windows && (
                <ErrorText message={issueText(issues.windows)} />
              )}
              {WEEKDAYS.map((weekday) => {
                const day = weekdayName(weekday);
                const rows = form.windows
                  .map((window, index) => ({ window, index }))
                  .filter((x) => x.window.weekday === weekday);
                const next = nextWindow(form.windows, weekday);
                return (
                  <Card key={weekday}>
                    <View
                      style={[styles.row, { justifyContent: "space-between" }]}
                    >
                      <Text style={styles.h2}>{day}</Text>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="add"
                        disabled={!next}
                        onPress={() =>
                          next &&
                          edit((f) => ({ ...f, windows: [...f.windows, next] }))
                        }
                      >
                        {t("booking.addRange")}
                      </Button>
                    </View>
                    {!rows.length && (
                      <Text style={styles.muted}>{t("booking.dayClosed")}</Text>
                    )}
                    {rows.map(({ window, index }) => (
                      <View key={index} style={{ gap: 4 }}>
                        <View
                          style={[styles.row, { flexWrap: "nowrap", gap: 8 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Picker
                              label={t("booking.rangeStart", { day })}
                              value={window.start}
                              options={STARTS}
                              onChange={(start) =>
                                edit((f) => ({
                                  ...f,
                                  windows: f.windows.map((w, i) =>
                                    i === index ? { ...w, start } : w,
                                  ),
                                }))
                              }
                            />
                          </View>
                          <Text style={styles.muted}>–</Text>
                          <View style={{ flex: 1 }}>
                            <Picker
                              label={t("booking.rangeEnd", { day })}
                              value={window.end}
                              options={ENDS}
                              onChange={(end) =>
                                edit((f) => ({
                                  ...f,
                                  windows: f.windows.map((w, i) =>
                                    i === index ? { ...w, end } : w,
                                  ),
                                }))
                              }
                            />
                          </View>
                          <IconButton
                            icon="close"
                            ghost
                            label={t("booking.removeRange")}
                            onPress={() =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.filter(
                                  (_, i) => i !== index,
                                ),
                              }))
                            }
                          />
                        </View>
                        {rowIssue(`windows.${index}`)}
                      </View>
                    ))}
                  </Card>
                );
              })}
              <SectionHeading
                title={t("booking.closedDays")}
                description={t("booking.closedDaysHint")}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="add"
                    onPress={() =>
                      edit((f) => ({
                        ...f,
                        blocks: [
                          ...f.blocks,
                          { from: dateKey(), to: dateKey() },
                        ],
                      }))
                    }
                  >
                    {t("booking.addClosedDays")}
                  </Button>
                }
              />
              {!!issues.blocks && (
                <ErrorText message={issueText(issues.blocks)} />
              )}
              {!form.blocks.length && (
                <Text style={styles.muted}>{t("booking.noClosedDays")}</Text>
              )}
              {form.blocks.map((block, index) => (
                <View key={index} style={{ gap: 4 }}>
                  <View style={[styles.row, { flexWrap: "nowrap", gap: 8 }]}>
                    <View style={{ flex: 1 }}>
                      <Input
                        accessibilityLabel={t("booking.from")}
                        value={block.from}
                        placeholder={t("mt.datePattern")}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                        onChangeText={(from) =>
                          edit((f) => ({
                            ...f,
                            blocks: f.blocks.map((b, i) =>
                              i === index ? { ...b, from } : b,
                            ),
                          }))
                        }
                      />
                    </View>
                    <Text style={styles.muted}>–</Text>
                    <View style={{ flex: 1 }}>
                      <Input
                        accessibilityLabel={t("booking.to")}
                        value={block.to}
                        placeholder={t("mt.datePattern")}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                        onChangeText={(to) =>
                          edit((f) => ({
                            ...f,
                            blocks: f.blocks.map((b, i) =>
                              i === index ? { ...b, to } : b,
                            ),
                          }))
                        }
                      />
                    </View>
                    <IconButton
                      icon="close"
                      ghost
                      label={t("booking.removeClosedDays")}
                      onPress={() =>
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.filter((_, i) => i !== index),
                        }))
                      }
                    />
                  </View>
                  {rowIssue(`blocks.${index}`)}
                </View>
              ))}
              <Field label={t("booking.duration")}>
                <Picker
                  label={t("booking.duration")}
                  value={String(form.durationMinutes)}
                  options={numberOptions(
                    DURATION_PRESETS,
                    form.durationMinutes,
                    (n) => t("booking.minutes", { count: n }),
                  )}
                  onChange={(v) =>
                    edit((f) => ({ ...f, durationMinutes: Number(v) }))
                  }
                />
              </Field>
              <Field label={t("booking.notice")}>
                <Picker
                  label={t("booking.notice")}
                  value={String(form.noticeHours)}
                  options={numberOptions(
                    NOTICE_PRESETS,
                    form.noticeHours,
                    (n) =>
                      n
                        ? t("booking.hours", { count: n })
                        : t("booking.noticeNone"),
                  )}
                  onChange={(v) =>
                    edit((f) => ({ ...f, noticeHours: Number(v) }))
                  }
                />
              </Field>
              <Field label={t("booking.cancelWindow")}>
                <Picker
                  label={t("booking.cancelWindow")}
                  value={String(form.cancelHours)}
                  options={numberOptions(
                    CANCEL_PRESETS,
                    form.cancelHours,
                    (n) =>
                      n
                        ? t("booking.hoursBefore", { count: n })
                        : t("booking.cancelUntilStart"),
                  )}
                  onChange={(v) =>
                    edit((f) => ({ ...f, cancelHours: Number(v) }))
                  }
                />
              </Field>
              <Field
                label={t("booking.location")}
                error={issues.location ? issueText(issues.location) : undefined}
              >
                <Input
                  accessibilityLabel={t("booking.location")}
                  value={form.location}
                  placeholder={t("booking.locationPlaceholder")}
                  maxLength={100}
                  onChangeText={(location) => edit((f) => ({ ...f, location }))}
                />
              </Field>
              <Text style={styles.hint}>{t("booking.note")}</Text>
              <ErrorText message={error} />
              {stale && (
                <Button secondary onPress={() => void load()}>
                  {t("booking.reload")}
                </Button>
              )}
            </>
          )}
        </ScrollView>
        {!!form && (
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
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LoadFallback({
  error,
  onRetry,
}: Readonly<{ error: string; onRetry: () => void }>) {
  if (!error) return <Loading />;
  return (
    <>
      <ErrorText message={error} />
      <Button secondary onPress={onRetry}>
        {t("common.retry")}
      </Button>
    </>
  );
}
