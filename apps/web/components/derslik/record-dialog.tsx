"use client";
import { useState, type FormEvent } from "react";
import { Info, Plus } from "lucide-react";
import { Spinner } from "@/components/derslik/loading";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dateKey,
  timeLabel,
  money,
  parseLira,
  type WorkspaceData,
  type Student,
  type Lesson,
} from "@/lib/domain/types";
import type { Command } from "@/lib/domain/validation";
import type { Mutate } from "./workspace";
import { balanceFor } from "./views";
import { FormError } from "./feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { t } from "@derslik/contracts";

export type ModalState =
  | { type: "student"; student?: Student }
  | { type: "package" | "payment"; studentId?: string }
  | { type: "lesson"; studentId?: string; date?: string; makeupForId?: string }
  | { type: "reschedule"; lesson: Lesson };
function Field({
  label,
  id,
  children,
  hint,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
function Choice({
  id,
  value,
  onChange,
  options,
  placeholder = t("common.choose"),
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RecordDialog({
  modal,
  data,
  onClose,
  onSwitch,
  mutate,
  busy,
}: {
  modal: ModalState;
  data: WorkspaceData;
  onClose: () => void;
  onSwitch: (m: ModalState) => void;
  mutate: Mutate;
  busy: boolean;
}) {
  const existing = modal.type === "student" ? modal.student : undefined;
  const lesson = modal.type === "reschedule" ? modal.lesson : undefined;
  const activeStudents = data.students.filter(
    (s) =>
      (s.active || modal.type === "payment") &&
      (modal.type !== "lesson" ||
        !modal.makeupForId ||
        s.id === modal.studentId),
  );
  const [studentId, setStudentId] = useState(
    "studentId" in modal && modal.studentId
      ? modal.studentId
      : lesson?.student_id || activeStudents[0]?.id || "",
  );
  const [name, setName] = useState(existing?.name || ""),
    [grade, setGrade] = useState(existing?.grade || ""),
    [subject, setSubject] = useState(
      existing?.subject || t("record.defaultSubject"),
    ),
    [phone, setPhone] = useState(existing?.phone || ""),
    [email, setEmail] = useState(existing?.email || "");
  const [packageName, setPackageName] = useState(t("record.defaultPackage")),
    [granted, setGranted] = useState("8"),
    [price, setPrice] = useState(""),
    [expires, setExpires] = useState("");
  const [date, setDate] = useState(
    lesson
      ? dateKey(lesson.starts_at)
      : modal.type === "lesson"
        ? modal.date || dateKey()
        : dateKey(),
  );
  const [time, setTime] = useState(
      lesson ? timeLabel(lesson.starts_at) : "15:00",
    ),
    [duration, setDuration] = useState(
      lesson
        ? String(
            (Date.parse(lesson.ends_at) - Date.parse(lesson.starts_at)) / 60000,
          )
        : "60",
    ),
    [weeks, setWeeks] = useState("1"),
    [topic, setTopic] = useState(
      modal.type === "lesson" && modal.makeupForId
        ? data.lessons.find((l) => l.id === modal.makeupForId)?.topic || ""
        : "",
    ),
    [location, setLocation] = useState(t("record.defaultLocation"));
  const eligiblePackages = data.packages.filter(
    (p) =>
      p.student_id === studentId &&
      p.remaining > 0 &&
      (!p.expires_on || p.expires_on >= date),
  );
  const [packageId, setPackageId] = useState(eligiblePackages[0]?.id || "");
  const selectedPackage = eligiblePackages.some((p) => p.id === packageId)
    ? packageId
    : eligiblePackages[0]?.id || "";
  const [amount, setAmount] = useState(""),
    [received, setReceived] = useState(dateKey()),
    [method, setMethod] = useState("TRANSFER"),
    [reference, setReference] = useState(""),
    [error, setError] = useState("");
  const title =
    modal.type === "student"
      ? existing
        ? t("record.editStudent")
        : t("record.newStudent")
      : modal.type === "package"
        ? t("record.addPackage")
        : modal.type === "lesson"
          ? modal.makeupForId
            ? t("lesson.planMakeup")
            : t("record.newLesson")
          : modal.type === "payment"
            ? t("record.recordPayment")
            : t("record.reschedule");
  const description =
    modal.type === "student"
      ? t("record.studentHint")
      : modal.type === "package"
        ? t("record.packageHint")
        : modal.type === "lesson"
          ? t("record.lessonHint")
          : modal.type === "payment"
            ? t("record.paymentHint")
            : t("record.rescheduleHint");
  const needsStudent = modal.type !== "student" && modal.type !== "reschedule";
  const noStudents = needsStudent && activeStudents.length === 0;
  const noPackage = modal.type === "lesson" && !selectedPackage && !noStudents;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    try {
      let command: Command;
      let message = t("record.saved");
      switch (modal.type) {
        case "student":
          command = existing
            ? {
                action: "student.update",
                id: existing.id,
                version: existing.version,
                name,
                grade,
                subject,
                phone,
                email,
              }
            : { action: "student.create", name, grade, subject, phone, email };
          message = existing
            ? t("record.studentUpdated")
            : t("record.studentAdded");
          break;
        case "package":
          command = {
            action: "package.create",
            studentId,
            name: packageName,
            granted: Number(granted),
            priceMinor: parseLira(price),
            expiresOn: expires || null,
          };
          message = t("record.packageAdded");
          break;
        case "lesson":
          command = {
            action: "lesson.create",
            studentId,
            packageId: selectedPackage,
            topic,
            startsAt: date + "T" + time + ":00+03:00",
            duration: Number(duration),
            location,
            weeks: Number(weeks),
            ...(modal.makeupForId ? { makeupForId: modal.makeupForId } : {}),
          };
          message =
            weeks === "1"
              ? t("record.lessonPlanned")
              : t("record.seriesPlanned", { count: Number(weeks) });
          break;
        case "reschedule":
          command = {
            action: "lesson.reschedule",
            id: modal.lesson.id,
            version: modal.lesson.version,
            startsAt: date + "T" + time + ":00+03:00",
            duration: Number(duration),
          };
          message = t("record.rescheduled");
          break;
        case "payment":
          command = {
            action: "payment.create",
            studentId,
            amountMinor: parseLira(amount),
            receivedOn: received,
            method: method as "TRANSFER" | "CASH" | "OTHER",
            reference,
          };
          message = t("record.paymentSaved");
          break;
      }
      if (await mutate(command, message)) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("record.checkFields"));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {noStudents ? (
            <Alert>
              <Info />
              <AlertTitle>{t("record.noStudents")}</AlertTitle>
              <AlertDescription>
                <p>{t("record.noStudentsHint")}</p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  onClick={() => onSwitch({ type: "student" })}
                >
                  <Plus /> {t("ws.addStudent")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {needsStudent && (
                <Field label={t("common.student")} id="student">
                  <Choice
                    id="student"
                    value={studentId}
                    onChange={setStudentId}
                    options={activeStudents.map((s) => ({
                      value: s.id,
                      label:
                        s.name +
                        (s.is_sample ? " · " + t("common.sample") : ""),
                    }))}
                  />
                </Field>
              )}
              {modal.type === "student" && (
                <>
                  <Field label={t("record.fullName")} id="student-name">
                    <Input
                      id="student-name"
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("record.namePlaceholder")}
                      autoComplete="name"
                      required
                      maxLength={120}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("record.subject")} id="subject">
                      <Input
                        id="subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={t("record.defaultSubject")}
                        required
                        maxLength={120}
                      />
                    </Field>
                    <Field label={t("record.grade")} id="grade">
                      <Input
                        id="grade"
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        placeholder={t("record.gradePlaceholder")}
                        maxLength={50}
                      />
                    </Field>
                  </div>
                  <Field label={t("record.phoneOptional")} id="phone">
                    <Input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t("record.phonePlaceholder")}
                      maxLength={30}
                    />
                  </Field>
                  <Field
                    label={t("record.emailOptional")}
                    id="email"
                    hint={t("record.emailHint")}
                  >
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("auth.emailPlaceholder")}
                      maxLength={150}
                    />
                  </Field>
                </>
              )}
              {modal.type === "package" && (
                <>
                  <Field label={t("record.packageName")} id="package-name">
                    <Input
                      id="package-name"
                      value={packageName}
                      onChange={(e) => setPackageName(e.target.value)}
                      required
                      maxLength={120}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("record.granted")} id="granted">
                      <Input
                        id="granted"
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        required
                        value={granted}
                        onChange={(e) => setGranted(e.target.value)}
                      />
                    </Field>
                    <Field label={t("record.price")} id="price">
                      <Input
                        id="price"
                        inputMode="decimal"
                        required
                        placeholder="4800,00"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label={t("record.expiresOptional")} id="expires">
                    <Input
                      id="expires"
                      type="date"
                      min={dateKey()}
                      value={expires}
                      onChange={(e) => setExpires(e.target.value)}
                    />
                  </Field>
                  <Alert>
                    <Info />
                    <AlertDescription>
                      {t("record.packageNote")}
                    </AlertDescription>
                  </Alert>
                </>
              )}
              {(modal.type === "lesson" || modal.type === "reschedule") && (
                <>
                  {modal.type === "lesson" && (
                    <>
                      <Field label={t("record.topic")} id="topic">
                        <Input
                          id="topic"
                          required
                          maxLength={120}
                          placeholder={t("record.topicPlaceholder")}
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                        />
                      </Field>
                      <Field
                        label={t("record.linkedPackage")}
                        id="lesson-package"
                      >
                        {noPackage ? (
                          <Alert>
                            <Info />
                            <AlertDescription>
                              <p>{t("record.noEligiblePackage")}</p>
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                className="mt-2"
                                onClick={() =>
                                  onSwitch({ type: "package", studentId })
                                }
                              >
                                <Plus /> {t("overview.addPackage")}
                              </Button>
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <Choice
                            id="lesson-package"
                            value={selectedPackage}
                            onChange={setPackageId}
                            options={eligiblePackages.map((p) => ({
                              value: p.id,
                              label:
                                p.name +
                                " · " +
                                t("common.creditCount", { count: p.remaining }),
                            }))}
                          />
                        )}
                      </Field>
                    </>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("record.date")} id="date">
                      <Input
                        id="date"
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Field>
                    <Field label={t("record.time")} id="time">
                      <Input
                        id="time"
                        type="time"
                        required
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("record.duration")} id="duration">
                      <Input
                        id="duration"
                        type="number"
                        min={15}
                        max={180}
                        step={1}
                        required
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                      />
                    </Field>
                    {modal.type === "lesson" && !modal.makeupForId && (
                      <Field label={t("record.repeat")} id="weeks">
                        <Choice
                          id="weeks"
                          value={weeks}
                          onChange={setWeeks}
                          options={[
                            { value: "1", label: t("record.single") },
                            {
                              value: "4",
                              label: t("record.weekly", { count: 4 }),
                            },
                            {
                              value: "8",
                              label: t("record.weekly", { count: 8 }),
                            },
                          ]}
                        />
                      </Field>
                    )}
                  </div>
                  {modal.type === "lesson" && (
                    <Field label={t("record.location")} id="location">
                      <Input
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        maxLength={100}
                        placeholder={t("record.locationPlaceholder")}
                      />
                    </Field>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {t("record.timezoneNote")}
                  </p>
                </>
              )}
              {modal.type === "payment" && (
                <>
                  <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
                    <span className="text-muted-foreground">
                      {t("record.studentBalance")}
                    </span>
                    <strong className="font-semibold tabular-nums">
                      {money(balanceFor(data, studentId))}
                    </strong>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("record.amount")} id="amount">
                      <Input
                        id="amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="2400,00"
                        required
                      />
                    </Field>
                    <Field label={t("record.received")} id="received">
                      <Input
                        id="received"
                        type="date"
                        required
                        max={dateKey()}
                        value={received}
                        onChange={(e) => setReceived(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label={t("record.method")} id="method">
                    <Choice
                      id="method"
                      value={method}
                      onChange={setMethod}
                      options={[
                        {
                          value: "TRANSFER",
                          label: t("payments.methods.TRANSFER"),
                        },
                        { value: "CASH", label: t("payments.methods.CASH") },
                        { value: "OTHER", label: t("payments.methods.OTHER") },
                      ]}
                    />
                  </Field>
                  <Field label={t("record.referenceOptional")} id="reference">
                    <Input
                      id="reference"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      maxLength={200}
                      placeholder={t("record.referencePlaceholder")}
                    />
                  </Field>
                  <p className="text-muted-foreground text-xs">
                    {t("record.paymentNote")}
                  </p>
                </>
              )}
            </>
          )}
          {error && <FormError>{error}</FormError>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || noStudents || noPackage}>
              {busy ? (
                <>
                  <Spinner /> {t("common.saving")}
                </>
              ) : modal.type === "lesson" ? (
                t("record.planSubmit")
              ) : (
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
