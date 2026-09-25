"use client";
import { useState } from "react";
import type { WorkspaceData } from "@derslik/contracts";
import { Users } from "lucide-react";
import { LearningPanel, type NoticeFocus } from "./learning-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
  focus,
}: {
  workspaceId: string;
  data: WorkspaceData;
  view: TeachingView;
  /** Bildirimden gelindiyse o öğrenci seçilir, kayıt vurgulanır. */
  focus?: NoticeFocus | null;
}) {
  const [selected, setSelected] = useState(focus?.studentId ?? ""),
    [appliedFocus, setAppliedFocus] = useState(focus?.at ?? 0);
  if (focus && focus.at !== appliedFocus) {
    setAppliedFocus(focus.at);
    setSelected(focus.studentId);
  }
  const students = [...data.students].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "tr"),
  );
  const student = students.find((s) => s.id === selected) || students[0];
  if (!student)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users />
          </EmptyMedia>
          <EmptyTitle className="text-base">
            Önce bir öğrenci ekleyin
          </EmptyTitle>
          <EmptyDescription>
            Öğrenciler bölümünden bir öğrenci ekleyin. Ödevleri, PDF dosyalarını
            ve ders videolarını burada paylaşabilirsiniz.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <section className="grid grid-cols-1 gap-6">
      <Card className="flex-row flex-wrap items-end justify-between gap-4 px-5 py-4">
        <div className="grid w-full max-w-xs gap-2">
          <Label htmlFor="teaching-student">Öğrenci</Label>
          <Select value={student.id} onValueChange={setSelected}>
            <SelectTrigger
              id="teaching-student"
              className="w-full"
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
        {student.subject && (
          <Badge variant="secondary">{student.subject}</Badge>
        )}
      </Card>
      <LearningPanel
        key={`${workspaceId}:${student.id}`}
        workspaceId={workspaceId}
        studentId={student.id}
        view={view}
        focus={
          focus?.studentId === student.id
            ? { id: focus.itemId, at: focus.at }
            : undefined
        }
      />
    </section>
  );
}
