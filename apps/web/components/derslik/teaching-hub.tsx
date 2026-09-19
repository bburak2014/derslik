"use client";
import { useState } from "react";
import type { WorkspaceData } from "@derslik/contracts";
import { LearningPanel } from "./learning-panel";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      <div className="teaching-student-bar">
        <div className="form-field">
          <Label htmlFor="teaching-student">Öğrenci</Label>
          <Select value={student.id} onValueChange={setSelected}>
            <SelectTrigger
              id="teaching-student"
              aria-label="İçerikleri gösterilecek öğrenci"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {students.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " · Arşivde"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="teaching-student-subject">{student.subject}</span>
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
