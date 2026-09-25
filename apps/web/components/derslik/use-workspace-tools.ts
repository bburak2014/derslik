"use client";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { commandSchema } from "@/lib/domain/validation";
import type { WorkspaceData } from "@/lib/domain/types";
import type { Mutate } from "./workspace";
import type { ModalState } from "./record-dialog";
import { t } from "@derslik/contracts";

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useWorkspaceTools(
  data: WorkspaceData,
  mutate: Mutate,
  openForm: (m: ModalState) => void,
) {
  const latest = useRef({ data, mutate, openForm });
  latest.current = { data, mutate, openForm };
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContext["registerTool"]>[0]) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() =>
          console.warn("Derslik structured tool registration unavailable"),
        );
      } catch {
        console.warn("Derslik structured tool registration unavailable");
      }
    };
    register({
      name: "list_students",
      title: t("tools.listStudents"),
      description:
        "Return students and current lesson-package balances from the signed-in teacher's visible workspace. Does not return private notes or contact details.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        z.object({}).strict().parse(input);
        return latest.current.data.students.map((s) => ({
          id: s.id,
          name: s.name,
          subject: s.subject,
          grade: s.grade,
          active: !!s.active,
          isExample: !!s.is_sample,
          packages: latest.current.data.packages
            .filter((p) => p.student_id === s.id)
            .map((p) => ({
              id: p.id,
              name: p.name,
              remaining: p.remaining,
              expiresOn: p.expires_on,
            })),
        }));
      },
    });
    register({
      name: "create_student",
      title: t("tools.createStudent"),
      description:
        "Create and persist a student in the current teacher workspace using the same action as the student form. No invitation or message is sent.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          subject: { type: "string", minLength: 1, maxLength: 120 },
          grade: { type: "string", maxLength: 50 },
        },
        required: ["name", "subject"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const fields = z
          .object({
            name: z.string(),
            subject: z.string(),
            grade: z.string().optional(),
          })
          .strict()
          .parse(input);
        const command = commandSchema.parse({
          action: "student.create",
          ...fields,
          grade: fields.grade || "",
          phone: "",
          email: "",
        });
        const ok = await latest.current.mutate(
          command,
          t("tools.studentCreated"),
        );
        if (!ok) throw new Error(t("tools.studentCreateFailed"));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return { created: true };
      },
    });
    register({
      name: "start_lesson_planning",
      title: t("tools.openLessonForm"),
      description:
        "Open the visible lesson planning form for an existing student. This stages the form only; it does not create or complete a lesson.",
      inputSchema: {
        type: "object",
        properties: { studentId: { type: "string", format: "uuid" } },
        required: ["studentId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const { studentId } = z
          .object({ studentId: z.string().uuid() })
          .strict()
          .parse(input);
        if (
          !latest.current.data.students.some(
            (s) => s.id === studentId && s.active,
          )
        )
          throw new Error(t("tools.activeStudentNotFound"));
        latest.current.openForm({ type: "lesson", studentId });
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return { formOpened: true, lessonCreated: false };
      },
    });
    return () => lifecycle.abort();
  }, []);
}
