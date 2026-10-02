"use client";
import { money, dayLabel, t } from "@derslik/contracts";
import { Package, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ToneBadge } from "../feedback";
import { type LearningCtx } from "./use-learning-panel";
import { SectionHeading } from "./shared";

export function PaymentsTab({ ctx }: Readonly<{ ctx: LearningCtx }>) {
  const { view, data, refresh } = ctx;
  if (!("packages" in data)) return null;
  return (
    <>
      <SectionHeading
        title={t("learn.paymentsTitle")}
        description={t("portal.balanceGuardian")}
      >
        {view && refresh}
      </SectionHeading>
      <ItemGroup className="gap-3">
        <Card role="listitem" className="gap-1 py-5">
          <CardHeader className="px-5">
            <CardDescription>{t("students.openBalance")}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {money(
                data.packages.reduce((n, p) => n + Number(p.price_minor), 0) -
                  data.payments
                    .filter((p) => !p.voided_at)
                    .reduce((n, p) => n + Number(p.amount_minor), 0),
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground px-5 text-sm">
            {t("learn.balanceBasis")}
          </CardContent>
        </Card>
        {data.packages.map((p) => (
          <Item
            role="listitem"
            variant="outline"
            className="bg-card"
            key={p.id}
          >
            <ItemMedia variant="icon">
              <Package />
            </ItemMedia>
            <ItemContent className="min-w-36">
              <ItemTitle>{p.name}</ItemTitle>
              <ItemDescription>
                {t("learn.creditsOf", {
                  remaining: p.remaining,
                  count: p.granted,
                })}{" "}
                · {money(p.price_minor)}
              </ItemDescription>
            </ItemContent>
          </Item>
        ))}
        {data.payments.map((p) => (
          <Item
            role="listitem"
            variant="outline"
            className="bg-card"
            key={p.id}
          >
            <ItemMedia variant="icon">
              <Wallet />
            </ItemMedia>
            <ItemContent className="min-w-36">
              <ItemTitle className="tabular-nums">
                {money(p.amount_minor)}
              </ItemTitle>
              <ItemDescription>
                {dayLabel(p.received_on + "T12:00:00+03:00")}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <ToneBadge tone={p.voided_at ? "muted" : "ok"}>
                {p.voided_at ? t("lesson.cancelled") : t("learn.paid")}
              </ToneBadge>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </>
  );
}
