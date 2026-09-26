import { Text, View } from "react-native";
import { dayLabel, money } from "@derslik/contracts";
import {
  Avatar,
  Badge,
  Button,
  Card,
  confirmAction,
  EmptyState,
  InkPanel,
} from "../ui";
import { t, upper } from "@derslik/contracts";
import { type TeacherCtx } from "./use-teacher-screen";

export function PaymentsSection({ ctx }: { ctx: TeacherCtx }) {
  const {
    colors,
    styles,
    section,
    data,
    setError,
    busy,
    mutate,
    newPayment,
    balance,
  } = ctx;
  return (
    <>
      <InkPanel>
        <Text style={[section.figureLabel, { color: colors.marker }]}>
          {upper(t("mt.totalBalance"))}
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.title, { color: colors.onFeature, marginTop: -8 }]}
        >
          {money(balance())}
        </Text>
        <Text
          style={[
            styles.muted,
            { color: colors.onFeatureMuted, marginTop: -8 },
          ]}
        >
          {t("mt.balanceNote")}
        </Text>
      </InkPanel>
      <Button icon="add" onPress={() => newPayment()}>
        {t("record.recordPayment")}
      </Button>
      {!data.payments.length && (
        <EmptyState
          icon="wallet-outline"
          title={t("mt.paymentsEmptyTitle")}
          description={t("mt.paymentsEmptyText")}
        />
      )}
      {data.payments.map((p) => {
        const person = data.students.find((s) => s.id === p.student_id);
        return (
          <Card key={p.id}>
            <View style={[styles.row, { flexWrap: "nowrap", gap: 12 }]}>
              <Avatar name={person?.name || "?"} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.h2} numberOfLines={1}>
                  {person?.name}
                </Text>
                <Text style={styles.caption}>
                  {dayLabel(p.received_on + "T12:00:00+03:00", {
                    year: "numeric",
                  })}{" "}
                  ·{" "}
                  {t(
                    p.method === "CASH" || p.method === "TRANSFER"
                      ? `payments.methods.${p.method}`
                      : "payments.methods.OTHER",
                  )}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 5 }}>
                <Text
                  style={[
                    styles.h2,
                    { fontVariant: ["tabular-nums"] },
                    !!p.voided_at && {
                      color: colors.muted,
                      textDecorationLine: "line-through",
                    },
                  ]}
                >
                  {money(p.amount_minor)}
                </Text>
                <Badge
                  tone={p.voided_at ? "neutral" : "success"}
                  icon={p.voided_at ? undefined : "checkmark"}
                >
                  {p.voided_at ? t("mt.voided") : t("payments.recorded")}
                </Badge>
              </View>
            </View>
            {!!p.reference && <Text style={styles.muted}>{p.reference}</Text>}
            {!p.voided_at && (
              <Button
                variant="danger"
                size="sm"
                icon="close"
                disabled={busy}
                style={{ alignSelf: "flex-start" }}
                onPress={() =>
                  confirmAction(
                    t("confirm.voidTitle"),
                    t("mt.voidBody"),
                    () =>
                      mutate({
                        action: "payment.void",
                        id: p.id,
                        version: p.version,
                      }),
                    setError,
                  )
                }
              >
                {t("payments.void")}
              </Button>
            )}
          </Card>
        );
      })}
    </>
  );
}
