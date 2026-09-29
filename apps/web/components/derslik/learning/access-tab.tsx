"use client";
import { t } from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Copy, Mail, UserCheck, UserPlus } from "lucide-react";
import { WhatsappIcon } from "@/components/account/provider-icons";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { FormSuccess, ToneBadge } from "../feedback";
import { type LearningCtx } from "./use-learning-panel";
import {
  SectionHeading,
  EmptyNote,
  whatsappNumber,
  whatsappInviteUrl,
} from "./shared";

export function AccessTab({ ctx }: { ctx: LearningCtx }) {
  const {
    workspaceId,
    studentId,
    studentName,
    studentPhone,
    setConfirmation,
    setError,
    setForm,
    access,
    invite,
    accessReload,
    inviteSpec,
  } = ctx;
  return (
    <>
      <SectionHeading
        title={t("learn.accessTitle")}
        description={t("learn.accessText")}
      >
        <Button type="button" onClick={() => setForm(inviteSpec())}>
          <UserPlus /> {t("learn.createInvite")}
        </Button>
      </SectionHeading>
      {invite && (
        <Card className="gap-4 py-5">
          <CardContent className="grid gap-4 px-5">
            <FormSuccess>
              {invite.emailed
                ? t("learn.inviteEmailed", { email: invite.email })
                : t("learn.inviteNoEmail")}
            </FormSuccess>
            <div className="grid gap-2">
              <Label htmlFor="invite-url">{t("learn.inviteLink")}</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-url"
                  readOnly
                  value={invite.url}
                  className="text-ellipsis"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invite.url);
                    } catch {
                      setError(t("learn.copyManually"));
                    }
                  }}
                >
                  <Copy /> {t("learn.copy")}
                </Button>
              </div>
            </div>
            {whatsappNumber(studentPhone || "") && (
              <Button variant="outline" className="justify-self-start" asChild>
                <a
                  href={whatsappInviteUrl(
                    studentPhone || "",
                    studentName || "",
                    invite.url,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <WhatsappIcon /> {t("learn.sendWhatsapp")}
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      <ItemGroup className="gap-3">
        {access && !access.data?.length && !access.invitations?.length && (
          <EmptyNote
            role="listitem"
            icon={UserPlus}
            title={t("learn.noInvites")}
          >
            {t("learn.noInvitesHint")}
          </EmptyNote>
        )}
        {access?.data?.map((a) => (
          <Item
            role="listitem"
            variant="outline"
            className="bg-card"
            key={a.id}
          >
            <ItemMedia variant="icon">
              <UserCheck />
            </ItemMedia>
            <ItemContent className="min-w-36">
              <ItemTitle>
                {a.role === "STUDENT"
                  ? t("learn.studentAccess")
                  : t("learn.guardianAccess")}
              </ItemTitle>
            </ItemContent>
            <ItemActions className="ml-auto">
              <ToneBadge tone={a.revokedAt ? "muted" : "ok"}>
                {a.revokedAt ? t("learn.removed") : t("sub.status.active")}
              </ToneBadge>
              {!a.revokedAt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    setConfirmation({
                      title: t("learn.revokeTitle"),
                      description: t("learn.revokeBody"),
                      action: t("learn.remove"),
                      perform: async () => {
                        try {
                          await backend(
                            `/workspaces/${workspaceId}/students/${studentId}/access/revoke`,
                            { id: a.id, kind: "link" },
                          );
                          await accessReload();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      },
                    })
                  }
                >
                  {t("learn.revokeAccess")}
                </Button>
              )}
            </ItemActions>
          </Item>
        ))}
        {access?.invitations?.map((a) => {
          const expired = a.expiresAt < new Date().toISOString();
          return (
            <Item
              role="listitem"
              variant="outline"
              className="bg-card"
              key={a.id}
            >
              <ItemMedia variant="icon">
                <Mail />
              </ItemMedia>
              <ItemContent className="min-w-36">
                <ItemTitle className="max-w-full">
                  <span className="truncate">{a.email}</span>
                </ItemTitle>
                <ItemDescription>
                  {a.role === "GUARDIAN"
                    ? t("learn.guardianInvite")
                    : t("learn.studentInvite")}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <ToneBadge
                  tone={
                    a.acceptedAt
                      ? "ok"
                      : a.revokedAt || expired
                        ? "muted"
                        : "warn"
                  }
                >
                  {a.acceptedAt
                    ? t("learn.accepted")
                    : a.revokedAt
                      ? t("lesson.cancelled")
                      : expired
                        ? t("learn.expired")
                        : t("learn.invitePending")}
                </ToneBadge>
                {!a.acceptedAt && !a.revokedAt && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={async () => {
                      try {
                        await backend(
                          `/workspaces/${workspaceId}/students/${studentId}/access/revoke`,
                          { id: a.id, kind: "invitation" },
                        );
                        await accessReload();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {t("learn.cancelInvite")}
                  </Button>
                )}
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
    </>
  );
}
