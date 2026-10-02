"use client";
import { dayLabel, dateKey, t } from "@derslik/contracts";
import { Button } from "@/components/ui/button";
import { NotebookPen, Pencil, Plus, Sparkles } from "lucide-react";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ToneBadge } from "../feedback";
import { type LearningCtx } from "./use-learning-panel";
import { SectionHeading, EmptyNote } from "./shared";

export function NotesTab({ ctx }: Readonly<{ ctx: LearningCtx }>) {
  const { view, owner, data, simple, refresh } = ctx;
  return (
    <>
      <SectionHeading
        title={t("learn.notesTitle")}
        description={t("learn.notesText")}
      >
        {view && refresh}
        {owner && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                simple(
                  t("learn.summaryTitle"),
                  [
                    {
                      name: "weekOn",
                      label: t("learn.weekStart"),
                      type: "date",
                      value: dateKey(),
                    },
                  ],
                  (v) => ({ action: "summary.draft", weekOn: v.weekOn }),
                )
              }
            >
              <Sparkles /> {t("learn.draftSummary")}
            </Button>
            <Button
              type="button"
              onClick={() =>
                simple(
                  t("learn.shareNote"),
                  [
                    {
                      name: "body",
                      label: t("learn.yourNote"),
                      type: "textarea",
                    },
                    {
                      name: "audience",
                      label: t("learn.audience"),
                      value: "BOTH",
                      options: [
                        { value: "BOTH", label: t("learn.audienceBoth") },
                        {
                          value: "STUDENT",
                          label: t("learn.audienceStudent"),
                        },
                      ],
                    },
                  ],
                  (v) => ({ action: "note.publish", ...v }),
                )
              }
            >
              <Plus /> {t("learn.shareNote")}
            </Button>
          </>
        )}
      </SectionHeading>
      <ItemGroup className="gap-3">
        {!data.notes.length && !data.summaries.length && (
          <EmptyNote
            role="listitem"
            icon={NotebookPen}
            title={t("learn.noNotes")}
          >
            {t("learn.noNotesHint")}
          </EmptyNote>
        )}
        {data.summaries.map((s) => (
          <Item
            role="listitem"
            variant="outline"
            className="bg-card items-start"
            key={s.id}
            data-notice-target={s.id}
          >
            <ItemMedia variant="icon">
              <Sparkles />
            </ItemMedia>
            <ItemContent className="min-w-36">
              <ItemTitle>
                {t("learn.weekOf", {
                  date: dayLabel(s.week_on + "T12:00:00+03:00"),
                })}
              </ItemTitle>
              <ItemDescription>{t("learn.weeklySummary")}</ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <ToneBadge tone={s.status === "DRAFT" ? "warn" : "ok"}>
                {s.status === "DRAFT" ? t("learn.draft") : t("learn.shared")}
              </ToneBadge>
            </ItemActions>
            <p className="basis-full text-sm leading-relaxed whitespace-pre-line">
              {s.body}
            </p>
            {owner && (
              <ItemFooter className="justify-start border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    simple(
                      t("learn.reviewSummary"),
                      [
                        {
                          name: "body",
                          label: t("learn.summary"),
                          type: "textarea",
                          value: s.body,
                        },
                      ],
                      (v) => ({
                        action: "summary.publish",
                        summaryId: s.id,
                        body: v.body,
                        version: s.version,
                      }),
                    )
                  }
                >
                  <Pencil />
                  {s.status === "DRAFT"
                    ? t("learn.editApprove")
                    : t("learn.updateSummary")}
                </Button>
              </ItemFooter>
            )}
          </Item>
        ))}
        {data.notes.map((n) => (
          <Item
            role="listitem"
            variant="outline"
            className="bg-card items-start"
            key={n.id}
          >
            <ItemMedia variant="icon">
              <NotebookPen />
            </ItemMedia>
            <ItemContent className="min-w-36">
              <ItemTitle>{t("learn.teacherNote")}</ItemTitle>
              <ItemDescription>{dayLabel(n.created_at)}</ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <ToneBadge tone="muted">
                {n.audience === "BOTH"
                  ? t("learn.audienceBoth")
                  : t("roles.STUDENT")}
              </ToneBadge>
            </ItemActions>
            <p className="basis-full text-sm leading-relaxed whitespace-pre-line">
              {n.body}
            </p>
          </Item>
        ))}
      </ItemGroup>
    </>
  );
}
