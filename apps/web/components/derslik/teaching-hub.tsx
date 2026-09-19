"use client";
import { useState } from "react";
import type { WorkspaceData } from "@derslik/contracts";
import { LearningPanel } from "./learning-panel";

export type TeachingView = "assignments" | "files" | "videos";
export function isTeachingView(view: string): view is TeachingView {
  return ["assignments", "files", "videos"].includes(view);
}
export function TeachingHub({
  workspaceId,
  data,
  view,
}: {
  workspaceId: string;
  data: WorkspaceData;
  view: TeachingView;
}) {
  const [selected, setSelected] = useState("");
  const students = [...data.students].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "tr"),
  );
  const student = students.find((s) => s.id === selected) || students[0];
  if (!student)
    return (
      <div className="learning-panel learning-empty">
        Öğrenciler bölümünden bir öğrenci ekleyin. Ödevleri, PDF dosyalarını ve
        ders videolarını burada paylaşabilirsiniz.
      </div>
    );
  return (
    <section>
      <div className="learning-panel learning-heading">
        <label>
          Öğrenci
          <select
            className="rounded-lg border px-3 py-2 ml-3 max-w-full"
            aria-label="İçerikleri gösterilecek öğrenci"
            value={student.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " · Arşivde"}
              </option>
            ))}
          </select>
        </label>
        <span>{student.subject}</span>
      </div>
      <LearningPanel
        key={`${workspaceId}:${student.id}`}
        workspaceId={workspaceId}
        studentId={student.id}
        view={view}
      />
    </section>
  );
}
