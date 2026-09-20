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
    <div className="form-field">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
function Choice({
  id,
  value,
  onChange,
  options,
  placeholder = "Seçin",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full h-11">
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
    [subject, setSubject] = useState(existing?.subject || "Matematik"),
    [phone, setPhone] = useState(existing?.phone || ""),
    [email, setEmail] = useState(existing?.email || "");
  const [packageName, setPackageName] = useState("8 derslik paket"),
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
    [location, setLocation] = useState("Yüz yüze");
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
        ? "Öğrenciyi düzenle"
        : "Yeni öğrenci"
      : modal.type === "package"
        ? "Ders paketi ekle"
        : modal.type === "lesson"
          ? modal.makeupForId
            ? "Telafi dersi planla"
            : "Yeni ders planla"
          : modal.type === "payment"
            ? "Tahsilat kaydet"
            : "Ders tarihini değiştir";
  const description =
    modal.type === "student"
      ? "Öğrencinizin temel bilgilerini çalışma alanınıza kaydedin."
      : modal.type === "package"
        ? "Paket oluşturmak ders hakkı ve açık bakiye ekler."
        : modal.type === "lesson"
          ? "Ders tamamlandığında bağlı paketten 1 hak düşülür."
          : modal.type === "payment"
            ? "Öğrencinizden aldığınız ödemeyi manuel olarak kaydedin."
            : "Yalnızca seçtiğiniz dersin tarihi ve saati değişir.";
  const needsStudent = modal.type !== "student" && modal.type !== "reschedule";
  const noStudents = needsStudent && activeStudents.length === 0;
  const noPackage = modal.type === "lesson" && !selectedPackage && !noStudents;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    try {
      let command: Command;
      let message = "Kayıt kaydedildi.";
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
            ? "Öğrenci bilgileri güncellendi."
            : "Öğrenci eklendi. Şimdi ders paketi tanımlayabilirsiniz.";
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
          message = "Paket ve ders hakları eklendi.";
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
              ? "Ders planlandı."
              : weeks + " haftalık ders planı oluşturuldu.";
          break;
        case "reschedule":
          command = {
            action: "lesson.reschedule",
            id: modal.lesson.id,
            version: modal.lesson.version,
            startsAt: date + "T" + time + ":00+03:00",
            duration: Number(duration),
          };
          message = "Dersin tarihi güncellendi.";
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
          message = "Tahsilat kaydedildi.";
          break;
      }
      if (await mutate(command, message)) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Alanları kontrol edin.");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="record-dialog max-h-[90dvh] overflow-y-auto sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="record-form">
          {noStudents ? (
            <div className="form-notice">
              <Info size={20} />
              <p>Önce bir öğrenci ekleyerek başlayın.</p>
              <Button
                type="button"
                onClick={() => onSwitch({ type: "student" })}
              >
                <Plus /> Öğrenci ekle
              </Button>
            </div>
          ) : (
            <>
              {needsStudent && (
                <Field label="Öğrenci" id="student">
                  <Choice
                    id="student"
                    value={studentId}
                    onChange={setStudentId}
                    options={activeStudents.map((s) => ({
                      value: s.id,
                      label: s.name + (s.is_sample ? " · Örnek" : ""),
                    }))}
                  />
                </Field>
              )}
              {modal.type === "student" && (
                <>
                  <Field label="Ad soyad" id="student-name">
                    <Input
                      id="student-name"
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Örn. Deniz Aksoy"
                      autoComplete="name"
                      required
                      maxLength={120}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Ders" id="subject">
                      <Input
                        id="subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Matematik"
                        required
                        maxLength={120}
                      />
                    </Field>
                    <Field label="Sınıf / seviye" id="grade">
                      <Input
                        id="grade"
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        placeholder="11. sınıf"
                        maxLength={50}
                      />
                    </Field>
                  </div>
                  <Field label="Telefon · isteğe bağlı" id="phone">
                    <Input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="05XX XXX XX XX"
                      maxLength={30}
                    />
                  </Field>
                  <Field
                    label="E-posta · isteğe bağlı"
                    id="email"
                    hint="Bu kayıt e-posta veya davet göndermez."
                  >
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ornek@eposta.com"
                      maxLength={150}
                    />
                  </Field>
                </>
              )}
              {modal.type === "package" && (
                <>
                  <Field label="Paket adı" id="package-name">
                    <Input
                      id="package-name"
                      value={packageName}
                      onChange={(e) => setPackageName(e.target.value)}
                      required
                      maxLength={120}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Ders hakkı" id="granted">
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
                    <Field label="Toplam paket ücreti (TL)" id="price">
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
                  <Field
                    label="Son kullanım tarihi · isteğe bağlı"
                    id="expires"
                  >
                    <Input
                      id="expires"
                      type="date"
                      min={dateKey()}
                      value={expires}
                      onChange={(e) => setExpires(e.target.value)}
                    />
                  </Field>
                  <div className="inline-info">
                    <Info size={16} />
                    <p>
                      Paket ücreti açık bakiyeye eklenir. Aldığınız ödemeyi
                      ayrıca “Tahsilat ekle” ile kaydedin.
                    </p>
                  </div>
                </>
              )}
              {(modal.type === "lesson" || modal.type === "reschedule") && (
                <>
                  {modal.type === "lesson" && (
                    <>
                      <Field label="Ders konusu" id="topic">
                        <Input
                          id="topic"
                          required
                          maxLength={120}
                          placeholder="Örn. İkinci dereceden denklemler"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                        />
                      </Field>
                      <Field label="Bağlı ders paketi" id="lesson-package">
                        {noPackage ? (
                          <div className="inline-info flex-wrap">
                            <p>
                              Bu öğrenci için uygun tarihli, hakkı kalan bir
                              paket bulunamadı.
                            </p>
                            <Button
                              size="sm"
                              type="button"
                              variant="outline"
                              onClick={() =>
                                onSwitch({ type: "package", studentId })
                              }
                            >
                              <Plus /> Paket ekle
                            </Button>
                          </div>
                        ) : (
                          <Choice
                            id="lesson-package"
                            value={selectedPackage}
                            onChange={setPackageId}
                            options={eligiblePackages.map((p) => ({
                              value: p.id,
                              label: p.name + " · " + p.remaining + " hak",
                            }))}
                          />
                        )}
                      </Field>
                    </>
                  )}
                  <div className="form-grid">
                    <Field label="Ders tarihi" id="date">
                      <Input
                        id="date"
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Field>
                    <Field label="Başlangıç saati" id="time">
                      <Input
                        id="time"
                        type="time"
                        required
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="form-grid">
                    <Field label="Süre (dakika)" id="duration">
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
                      <Field label="Tekrar" id="weeks">
                        <Choice
                          id="weeks"
                          value={weeks}
                          onChange={setWeeks}
                          options={[
                            { value: "1", label: "Tek ders" },
                            { value: "4", label: "Haftalık · 4 ders" },
                            { value: "8", label: "Haftalık · 8 ders" },
                          ]}
                        />
                      </Field>
                    )}
                  </div>
                  {modal.type === "lesson" && (
                    <Field label="Konum / ders biçimi" id="location">
                      <Input
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        maxLength={100}
                        placeholder="Yüz yüze, çevrim içi…"
                      />
                    </Field>
                  )}
                  <p className="field-footnote">
                    Tüm saatler Türkiye saatiyle (İstanbul) kaydedilir.
                  </p>
                </>
              )}
              {modal.type === "payment" && (
                <>
                  <div className="balance-notice">
                    <span>Öğrencinin açık bakiyesi</span>
                    <strong>{money(balanceFor(data, studentId))}</strong>
                  </div>
                  <div className="form-grid">
                    <Field label="Alınan tutar (TL)" id="amount">
                      <Input
                        id="amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="2400,00"
                        required
                      />
                    </Field>
                    <Field label="Tahsilat tarihi" id="received">
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
                  <Field label="Ödeme yöntemi" id="method">
                    <Choice
                      id="method"
                      value={method}
                      onChange={setMethod}
                      options={[
                        { value: "TRANSFER", label: "Havale / EFT" },
                        { value: "CASH", label: "Nakit" },
                        { value: "OTHER", label: "Diğer" },
                      ]}
                    />
                  </Field>
                  <Field
                    label="Açıklama / referans · isteğe bağlı"
                    id="reference"
                  >
                    <Input
                      id="reference"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      maxLength={200}
                      placeholder="Örn. Eylül paketi ilk ödeme"
                    />
                  </Field>
                  <p className="field-footnote">
                    Bu işlem ödeme kaydı oluşturur. Öğrenciden otomatik para
                    çekilmez.
                  </p>
                </>
              )}
            </>
          )}
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Vazgeç
            </Button>
            <Button type="submit" disabled={busy || noStudents || noPackage}>
              {busy ? (
                <>
                  <Spinner /> Kaydediliyor
                </>
              ) : modal.type === "lesson" ? (
                "Dersi planla"
              ) : (
                "Kaydet"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
