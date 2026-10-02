"use client";
import {
  type Assignment,
  type Material,
  type Submission,
} from "@derslik/api-client";
import { dayLabel, dateKey, canEditSubmission, t } from "@derslik/contracts";
import { Button } from "@/components/ui/button";
import {
  ClipboardList,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
} from "lucide-react";
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
import { ToneBadge, type Tone } from "../feedback";
import { type LearningCtx } from "./use-learning-panel";
import { SectionHeading, EmptyNote, FilePicker } from "./shared";

export function AssignmentsTab({ ctx }: Readonly<{ ctx: LearningCtx }>) {
  const {
    view,
    owner,
    student,
    capabilities,
    data,
    busy,
    simple,
    attach,
    download,
    today,
    refresh,
  } = ctx;
  return (
    <>
      <SectionHeading
        title={t("learn.assignmentsTitle")}
        description={t("learn.assignmentsText")}
      >
        {view && refresh}
        {owner && (
          <Button
            type="button"
            onClick={() =>
              simple(
                t("notice.assignmentNew"),
                [
                  { name: "title", label: t("learn.title") },
                  {
                    name: "instructions",
                    label: t("learn.instructions"),
                    type: "textarea",
                    required: false,
                  },
                  {
                    name: "dueOn",
                    label: t("learn.dueOn"),
                    required: false,
                    type: "date",
                    value: dateKey(),
                  },
                ],
                (v) => ({ action: "assignment.create", ...v }),
              )
            }
          >
            <Plus /> {t("learn.assign")}
          </Button>
        )}
      </SectionHeading>
      <ItemGroup className="gap-3">
        {!data.assignments.length && (
          <EmptyNote
            role="listitem"
            icon={ClipboardList}
            title={t("learn.noAssignments")}
          >
            {t("learn.noAssignmentsHint")}
          </EmptyNote>
        )}
        {data.assignments.map((a) => {
          const sub = data.submissions.find((s) => s.assignment_id === a.id);
          const state = assignmentState(a, sub, today);
          const files = data.materials.filter((m) => m.assignment_id === a.id);
          const editable = canEditSubmission(a, !!sub, today);
          return (
            <Item
              role="listitem"
              variant="outline"
              className="bg-card items-start"
              key={a.id}
              data-notice-target={a.id}
            >
              <ItemMedia variant="icon">
                <ClipboardList />
              </ItemMedia>
              <ItemContent className="min-w-36">
                <ItemTitle>{a.title}</ItemTitle>
                <ItemDescription>
                  {a.due_on
                    ? t("learn.dueDate", {
                        date: dayLabel(a.due_on + "T12:00:00+03:00"),
                      })
                    : t("learn.noDueDate")}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <ToneBadge tone={state[0]}>{state[1]}</ToneBadge>
              </ItemActions>
              {(a.instructions || sub || files.length > 0) && (
                <div className="grid basis-full gap-3 text-sm">
                  {a.instructions && (
                    <p className="leading-relaxed whitespace-pre-line">
                      {a.instructions}
                    </p>
                  )}
                  {sub && (
                    <div className="bg-muted/50 grid gap-3 rounded-md border p-3">
                      <div className="grid gap-1">
                        <span className="text-muted-foreground text-xs font-medium">
                          {t("learn.studentSubmission")}
                        </span>
                        <p className="leading-relaxed whitespace-pre-line">
                          {sub.body}
                        </p>
                      </div>
                      {sub.feedback && (
                        <div className="grid gap-1 border-t pt-3">
                          <span className="text-muted-foreground text-xs font-medium">
                            {t("learn.teacherFeedback")}
                          </span>
                          <p className="leading-relaxed whitespace-pre-line">
                            {sub.feedback}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {files.map((m) => (
                        <Button
                          key={m.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="max-w-full"
                          disabled={m.status !== "READY" || m.delete_requested}
                          onClick={() => void download(m)}
                        >
                          <Paperclip />
                          <span className="truncate">{m.name}</span>
                          <span className="text-muted-foreground font-normal">
                            {fileLabel(m)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <ItemFooter className="flex-wrap justify-start border-t pt-4">
                {owner && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      simple(
                        t("learn.editAssignment"),
                        [
                          {
                            name: "title",
                            label: t("learn.title"),
                            value: a.title,
                          },
                          {
                            name: "instructions",
                            label: t("learn.instructions"),
                            type: "textarea",
                            value: a.instructions,
                            required: false,
                          },
                          {
                            name: "dueOn",
                            label: t("learn.dueOn"),
                            type: "date",
                            value: a.due_on || "",
                            required: false,
                          },
                          {
                            name: "status",
                            label: t("common.status"),
                            value: a.status,
                            options: [
                              {
                                value: "OPEN",
                                label: t("learn.inProgress"),
                              },
                              {
                                value: "COMPLETED",
                                label: t("lesson.completed"),
                              },
                              {
                                value: "CANCELLED",
                                label: t("lesson.cancelled"),
                              },
                            ],
                          },
                        ],
                        (v) => ({
                          action: "assignment.update",
                          assignmentId: a.id,
                          version: a.version,
                          ...v,
                        }),
                      )
                    }
                  >
                    <Pencil /> {t("common.edit")}
                  </Button>
                )}
                {student && editable && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      simple(
                        sub
                          ? t("learn.editSubmission")
                          : t("learn.submitTitle"),
                        [
                          {
                            name: "body",
                            label: t("learn.yourAnswer"),
                            type: "textarea",
                            value: sub?.body || "",
                          },
                        ],
                        (v) => ({
                          action: "assignment.submit",
                          assignmentId: a.id,
                          body: v.body,
                          version: sub?.version || 0,
                        }),
                      )
                    }
                  >
                    <Send />{" "}
                    {sub ? t("learn.editSubmission") : t("learn.submit")}
                  </Button>
                )}
                {owner && sub && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      simple(
                        t("learn.reviewTitle"),
                        [
                          {
                            name: "feedback",
                            label: t("learn.feedback"),
                            type: "textarea",
                            value: sub.feedback,
                          },
                        ],
                        (v) => ({
                          action: "assignment.review",
                          submissionId: sub.id,
                          feedback: v.feedback,
                          version: sub.version,
                        }),
                      )
                    }
                  >
                    <MessageSquare /> {t("learn.writeFeedback")}
                  </Button>
                )}
                {student &&
                  sub &&
                  a.status === "OPEN" &&
                  (editable ? (
                    a.due_on && (
                      <span className="text-muted-foreground text-xs">
                        {t("learn.editableUntil", {
                          date: dayLabel(a.due_on + "T12:00:00+03:00"),
                        })}
                      </span>
                    )
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {t("learn.locked")}
                    </span>
                  ))}
                {(owner || (student && editable)) && (
                  <FilePicker
                    busy={busy}
                    disabled={busy || !capabilities?.files}
                    onPick={(file) => void attach(a.id, file)}
                  />
                )}
                <span className="text-muted-foreground ml-auto text-xs">
                  {t("learn.fileLimits")}
                </span>
              </ItemFooter>
            </Item>
          );
        })}
      </ItemGroup>
    </>
  );
}

function assignmentState(
  a: Assignment,
  sub: Submission | undefined,
  today: string,
): [Tone, string] {
  if (a.status === "CANCELLED") return ["muted", t("lesson.cancelled")];
  if (a.status === "COMPLETED") return ["ok", t("lesson.completed")];
  if (sub) return submissionState(sub);
  if (a.due_on && a.due_on < today) return ["danger", t("learn.late")];
  return ["warn", t("learn.awaiting")];
}

function submissionState(sub: Submission): [Tone, string] {
  if (sub.status === "REVIEWED") return ["ok", t("learn.reviewed")];
  return ["info", t("learn.submitted")];
}

function fileLabel(m: Material) {
  if (m.status !== "READY") return t("learn.uploadPending");
  if (m.purpose === "SUBMISSION") return t("learn.fileSubmission");
  return t("learn.fileResource");
}
