"use client";
import { useState } from "react";
import {
  CalendarDays,
  Users,
  Wallet,
  Check,
  ArrowUpRight,
  ArrowRight,
  Clock3,
  MapPin,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Plus,
  BookOpen,
  CircleCheck,
  Undo2,
  CalendarClock,
  X,
  FlaskConical,
  Search,
  Package,
  Banknote,
  ArrowDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  money,
  dateKey,
  timeLabel,
  dayLabel,
  addDays,
  type WorkspaceData,
  type Lesson,
  type Student,
  type View,
} from "@/lib/domain/types";
import type { Actions } from "./workspace";

export function balanceFor(data: WorkspaceData, id: string) {
  return (
    data.packages
      .filter((p) => p.student_id === id)
      .reduce((a, p) => a + Number(p.price_minor), 0) -
    data.payments
      .filter((p) => p.student_id === id && !p.voided_at)
      .reduce((a, p) => a + Number(p.amount_minor), 0)
  );
}
export function creditsFor(data: WorkspaceData, id: string) {
  return data.packages
    .filter(
      (p) =>
        p.student_id === id && (!p.expires_on || p.expires_on >= dateKey()),
    )
    .reduce((a, p) => a + p.remaining, 0);
}
export function StudentAvatar({
  student,
  large = false,
}: {
  student: Student;
  large?: boolean;
}) {
  const colors = ["sage", "peach", "lavender", "blue"];
  const idx =
    Array.from(student.name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  return (
    <span className={`avatar ${colors[idx]} ${large ? "avatar-large" : ""}`}>
      {student.name
        .split(" ")
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toLocaleUpperCase("tr")}
    </span>
  );
}
export function Status({ status }: { status: Lesson["status"] }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {status === "COMPLETED" ? (
        <Check size={12} />
      ) : (
        <span className="status-dot" />
      )}
      {status === "COMPLETED"
        ? "Tamamlandı"
        : status === "CANCELLED"
          ? "İptal edildi"
          : "Planlandı"}
    </span>
  );
}
export function Empty({
  icon: Icon = CalendarDays,
  title,
  text,
  action,
}: {
  icon?: typeof CalendarDays;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function LessonRows({
  lessons,
  data,
  actions,
  busy = false,
  showDate = false,
}: {
  lessons: Lesson[];
  data: WorkspaceData;
  actions: Actions;
  busy?: boolean;
  showDate?: boolean;
}) {
  return (
    <div className="lesson-list">
      {lessons.map((l) => {
        const student = data.students.find((s) => s.id === l.student_id);
        if (!student) return null;
        const pack = data.packages.find((p) => p.id === l.package_id);
        return (
          <div
            className={`lesson-row ${l.status === "CANCELLED" ? "lesson-cancelled" : ""}`}
            key={l.id}
          >
            <div className="lesson-time">
              <strong>{timeLabel(l.starts_at)}</strong>
              <span>{timeLabel(l.ends_at)}</span>
              {showDate && (
                <small>{dayLabel(l.starts_at, { month: "short" })}</small>
              )}
            </div>
            <div className="lesson-accent" />
            <StudentAvatar student={student} />
            <div className="lesson-info">
              <button
                className="student-name"
                onClick={() => actions.openStudent(student.id)}
              >
                {student.name}
                <ArrowUpRight size={13} />
              </button>
              <p>{l.topic}</p>
              <div className="lesson-meta">
                <span>
                  <MapPin size={12} />
                  {l.location || "Konum belirtilmedi"}
                </span>
                <span className="meta-credit">
                  {pack?.remaining ?? 0} hak kaldı
                </span>
              </div>
            </div>
            <div className="lesson-actions">
              <Status status={l.status} />
              {l.status === "SCHEDULED" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="complete-button"
                  onClick={() => actions.complete(l)}
                  disabled={busy}
                >
                  <Check size={14} />
                  <span>Tamamla</span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${student.name} ders işlemleri`}
                    disabled={busy}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => actions.openStudent(student.id)}
                  >
                    <Users /> Öğrenciye git
                  </DropdownMenuItem>
                  {l.status === "SCHEDULED" && (
                    <>
                      <DropdownMenuItem onClick={() => actions.reschedule(l)}>
                        <CalendarClock /> Tarihi değiştir
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => actions.cancel(l)}
                        className="text-destructive"
                      >
                        <X /> Dersi iptal et
                      </DropdownMenuItem>
                    </>
                  )}
                  {l.status === "CANCELLED" && actions.makeup && (
                    <DropdownMenuItem onClick={() => actions.makeup?.(l)}>
                      <CalendarClock /> Telafi dersi planla
                    </DropdownMenuItem>
                  )}
                  {l.status === "COMPLETED" && (
                    <DropdownMenuItem onClick={() => actions.reverse(l)}>
                      <Undo2 /> Tamamlamayı geri al
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Overview({
  data,
  actions,
  onNavigate,
  onAddStudent,
  onSeed,
  busy,
}: {
  data: WorkspaceData;
  actions: Actions;
  onNavigate: (v: View) => void;
  onAddStudent: () => void;
  onSeed?: () => void;
  busy: boolean;
}) {
  const today = dateKey(),
    todayLessons = data.lessons.filter((l) => dateKey(l.starts_at) === today),
    next = data.lessons.filter(
      (l) => l.status === "SCHEDULED" && l.ends_at >= new Date().toISOString(),
    );
  const collected = data.payments
    .filter((p) => !p.voided_at && p.received_on.startsWith(today.slice(0, 7)))
    .reduce((sum, p) => sum + Number(p.amount_minor), 0);
  const outstanding = data.students.reduce(
      (sum, s) => sum + balanceFor(data, s.id),
      0,
    ),
    active = data.students.filter((s) => s.active);
  const lowPackages = data.packages
    .filter(
      (p) =>
        p.remaining <= 2 &&
        data.students.some((s) => s.id === p.student_id && s.active) &&
        (!p.expires_on || p.expires_on >= today),
    )
    .slice(0, 3);
  const shown = todayLessons.length ? todayLessons : next.slice(0, 4);
  // Azalan paket ve açık bakiye tek listede, aciliyete göre: önce hakkı biten,
  // sonra en büyük bakiye.
  const attention = [
    ...lowPackages.map((p) => {
      const student = data.students.find((s) => s.id === p.student_id)!;
      return {
        key: "pkg-" + p.id,
        kind: "package" as const,
        student,
        note: `${p.name} · ${p.remaining} / ${p.granted} hak kaldı`,
        badge: p.remaining + " hak",
        rank: p.remaining,
        actionLabel: "Paket ekle",
        action: () => actions.newPackage(student.id),
      };
    }),
    ...active
      .map((student) => ({ student, balance: balanceFor(data, student.id) }))
      .filter((x) => x.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 4)
      .map(({ student, balance }) => ({
        key: "bal-" + student.id,
        kind: "balance" as const,
        student,
        note: "Paket ücretlerinden kalan",
        badge: money(balance),
        rank: 100,
        actionLabel: "Tahsilat",
        action: () => actions.newPayment(student.id),
      })),
  ]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 6);
  return (
    <>
      {data.students.length === 0 ? (
        <section className="onboarding">
          <div className="onboarding-copy">
            <p className="eyebrow">Derslik'e hoş geldiniz</p>
            <h2>
              İyi bir dersin başlangıcı,
              <br />
              düzenli bir çalışma alanı.
            </h2>
            <p>
              Öğrencinizi ekleyin, ders paketini tanımlayın ve ilk dersinizi
              planlayın. Gerisini takvimden takip edin.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={onAddStudent}>
                <Plus /> İlk öğrencimi ekle
              </Button>
              <Button
                size="lg"
                variant="outline"
                hidden={!onSeed}
                onClick={onSeed}
                disabled={busy}
              >
                <FlaskConical /> Örneklerle keşfet
              </Button>
            </div>
            <span hidden={!onSeed} className="onboarding-note">
              Örneklerle keşfet seçeneği kurgusal kayıtlar ekler.
            </span>
          </div>
          <div className="setup-steps">
            {[
              {
                icon: Users,
                num: "01",
                title: "Öğrencinizi ekleyin",
                text: "Hesap açmasını beklemeden başlayın.",
              },
              {
                icon: Package,
                num: "02",
                title: "Paketini tanımlayın",
                text: "Ders hakları ve ücret bir arada.",
              },
              {
                icon: CalendarDays,
                num: "03",
                title: "İlk dersi planlayın",
                text: "Tamamlandığında hak otomatik düşer.",
              },
            ].map(({ icon: Icon, num, title, text }) => (
              <div className="setup-step" key={num}>
                <span>
                  <Icon size={19} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
                <small>{num}</small>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {/* Gün şeridi: öğretmenin ilk sorusu "bugün ne var". Sayılar dört ayrı
              karta değil, tarihin yanındaki tek bir deftere satırına toplandı. */}
          <section className="day-panel">
            <header className="day-panel-head">
              <div className="day-panel-date">
                <span className="date-tile">
                  <small>
                    {dayLabel(today + "T12:00:00+03:00", {
                      month: "short",
                      day: undefined,
                    }).toLocaleUpperCase("tr")}
                  </small>
                  <strong>{Number(today.slice(-2))}</strong>
                </span>
                <div>
                  <h2>Bugün</h2>
                  <p>
                    {dayLabel(today + "T12:00:00+03:00", {
                      weekday: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <dl className="day-figures">
                <div>
                  <dt>Ders</dt>
                  <dd>
                    {todayLessons.filter((l) => l.status !== "CANCELLED").length}
                  </dd>
                </div>
                <div>
                  <dt>Tamamlanan</dt>
                  <dd>
                    {todayLessons.filter((l) => l.status === "COMPLETED").length}
                  </dd>
                </div>
                <div>
                  <dt>Aktif öğrenci</dt>
                  <dd>{active.length}</dd>
                </div>
                <div>
                  <dt>Bekleyen tahsilat</dt>
                  <dd>{money(outstanding)}</dd>
                </div>
              </dl>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate("calendar")}
              >
                Takvime git <ArrowUpRight size={14} />
              </Button>
            </header>
            {shown.length ? (
              <LessonRows
                lessons={shown}
                data={data}
                actions={actions}
                busy={busy}
                showDate={!todayLessons.length}
              />
            ) : (
              /* Tam sayfa boş durum yerine tek satırlık istem: sayfanın
                 yarısını kaplamasın. */
              <div className="day-empty">
                <span>
                  <CalendarDays size={17} />
                  Bugün planlanmış ders yok.
                </span>
                <Button size="sm" onClick={() => actions.newLesson()}>
                  <Plus size={15} /> Ders planla
                </Button>
              </div>
            )}
          </section>

          <div className="focus-grid">
            {/* Dikkat gerektirenler: azalan paket ve açık bakiye eskiden iki
                ayrı kartta duruyordu; ikisi de "kim ilgi bekliyor" sorusunun
                cevabı olduğu için tek sıralı listede birleştirildi. */}
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Dikkat gerektirenler</h2>
                  <p>Azalan paketler ve açık bakiyeler</p>
                </div>
                <Package size={17} className="text-muted-foreground" />
              </div>
              {attention.length ? (
                <ul className="attention-list">
                  {attention.map((item) => (
                    <li className="attention-row" key={item.key}>
                      <StudentAvatar student={item.student} />
                      <div className="attention-body">
                        <button
                          className="student-name"
                          onClick={() => actions.openStudent(item.student.id)}
                        >
                          {item.student.name}
                        </button>
                        <small>{item.note}</small>
                      </div>
                      <span
                        className={
                          "status " +
                          (item.kind === "package"
                            ? "status-warning"
                            : "status-neutral")
                        }
                      >
                        {item.badge}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={item.action}
                      >
                        {item.actionLabel}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="small-empty">
                  <CircleCheck size={23} />
                  <p>Bekleyen bir şey yok.</p>
                  <span>
                    Azalan paketler ve açık bakiyeler burada toplanır.
                  </span>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Öğrencileriniz</h2>
                  <p>{active.length} aktif</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onNavigate("students")}
                >
                  Tümü <ArrowRight size={14} />
                </Button>
              </div>
              <ul className="student-list">
                {active.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <button
                      className="student-row"
                      onClick={() => actions.openStudent(s.id)}
                    >
                      <StudentAvatar student={s} />
                      <span className="student-row-body">
                        <strong>{s.name}</strong>
                        <small>{s.subject}</small>
                      </span>
                      <span className="student-row-credit">
                        {creditsFor(data, s.id)} ders
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function CalendarView({
  data,
  actions,
  selectedDay,
  onSelectDay,
  busy,
}: {
  data: WorkspaceData;
  actions: Actions;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState("day"),
    today = dateKey();
  const dayOfWeek = new Date(selectedDay + "T12:00:00+03:00").getUTCDay();
  const start = addDays(selectedDay, -((dayOfWeek + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const visible = data.lessons.filter((l) =>
    mode === "week"
      ? dateKey(l.starts_at) >= start && dateKey(l.starts_at) <= days[6]
      : dateKey(l.starts_at) === selectedDay,
  );
  return (
    <section className="panel calendar-panel">
      <div className="calendar-toolbar">
        <div className="calendar-month">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Önceki hafta"
            onClick={() => onSelectDay(addDays(selectedDay, -7))}
          >
            <ChevronLeft />
          </Button>
          <h2>
            {dayLabel(start + "T12:00:00+03:00", {
              day: undefined,
              month: "long",
              year: "numeric",
            })}
          </h2>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Sonraki hafta"
            onClick={() => onSelectDay(addDays(selectedDay, 7))}
          >
            <ChevronRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSelectDay(today)}>
            Bugün
          </Button>
        </div>
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            <TabsTrigger value="day">Gün</TabsTrigger>
            <TabsTrigger value="week">Hafta</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="week-strip">
        {days.map((d) => {
          const count = data.lessons.filter(
            (l) => dateKey(l.starts_at) === d && l.status !== "CANCELLED",
          ).length;
          return (
            <button
              key={d}
              className={`day-button ${d === selectedDay ? "selected" : ""} ${d === today ? "today" : ""}`}
              onClick={() => {
                onSelectDay(d);
                setMode("day");
              }}
              aria-pressed={d === selectedDay}
            >
              <span>
                {dayLabel(d + "T12:00:00+03:00", {
                  weekday: "short",
                  day: undefined,
                  month: undefined,
                })}
              </span>
              <strong>{Number(d.slice(-2))}</strong>
              <small>{count ? `${count} ders` : "—"}</small>
            </button>
          );
        })}
      </div>
      <div className="section-heading">
        <div>
          <h2>
            {mode === "week"
              ? "Bu haftanın dersleri"
              : dayLabel(selectedDay + "T12:00:00+03:00", { weekday: "long" })}
          </h2>
          <p>{visible.length} ders kaydı · Türkiye saati</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => actions.newLesson()}>
          <Plus /> Ders ekle
        </Button>
      </div>
      {visible.length ? (
        <LessonRows
          lessons={visible}
          data={data}
          actions={actions}
          busy={busy}
          showDate={mode === "week"}
        />
      ) : (
        <Empty
          title="Bu aralıkta dersiniz yok."
          text="Ders ekleyebilir veya takvimden başka bir gün seçebilirsiniz."
          action={
            <Button variant="outline" onClick={() => actions.newLesson()}>
              <Plus /> Ders planla
            </Button>
          }
        />
      )}
    </section>
  );
}

export function StudentsView({
  data,
  actions,
  search,
  onAdd,
}: {
  data: WorkspaceData;
  actions: Actions;
  search: string;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState("active");
  const shown = data.students.filter(
    (s) =>
      (filter === "active" ? s.active : !s.active) &&
      `${s.name} ${s.grade} ${s.subject}`
        .toLocaleLowerCase("tr")
        .includes(search.toLocaleLowerCase("tr")),
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="active">Aktif öğrenciler</TabsTrigger>
            <TabsTrigger value="archive">Arşiv</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-sm text-muted-foreground">
          {shown.length} öğrenci
        </span>
      </div>
      {shown.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Öğrenci</TableHead>
              <TableHead>Ders / sınıf</TableHead>
              <TableHead>Kalan hak</TableHead>
              <TableHead>Açık bakiye</TableHead>
              <TableHead>Sıradaki ders</TableHead>
              <TableHead>
                <span className="sr-only">İşlemler</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((s) => {
              const next = data.lessons.find(
                (l) =>
                  l.student_id === s.id &&
                  l.status === "SCHEDULED" &&
                  l.ends_at >= new Date().toISOString(),
              );
              return (
                <TableRow key={s.id}>
                  <TableCell className="pl-6">
                    <button
                      className="student-cell"
                      onClick={() => actions.openStudent(s.id)}
                    >
                      <StudentAvatar student={s} />
                      <span>
                        <strong>{s.name}</strong>
                        {s.is_sample === 1 && (
                          <small className="sample-label">Örnek</small>
                        )}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="table-primary">{s.subject}</span>
                    <small className="table-secondary">
                      {s.grade || "Sınıf belirtilmedi"}
                    </small>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`credit-pill ${creditsFor(data, s.id) <= 2 ? "low" : ""}`}
                    >
                      {creditsFor(data, s.id)} ders
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    {money(balanceFor(data, s.id))}
                  </TableCell>
                  <TableCell>
                    {next ? (
                      <>
                        <span className="table-primary">
                          {dayLabel(next.starts_at, { month: "short" })}
                        </span>
                        <small className="table-secondary">
                          {timeLabel(next.starts_at)}
                        </small>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Planlanmadı</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${s.name} detaylarını aç`}
                      onClick={() => actions.openStudent(s.id)}
                    >
                      <ArrowUpRight />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <Empty
          icon={search ? Search : Users}
          title={
            search
              ? "Aramanızla eşleşen öğrenci yok."
              : filter === "archive"
                ? "Arşiviniz henüz boş."
                : "İlk öğrencinizle başlayın."
          }
          text={
            search
              ? "İsmin bir bölümünü, dersini veya sınıfını aramayı deneyin."
              : filter === "archive"
                ? "Arşivlediğiniz öğrencilerin geçmiş kayıtları burada saklanır."
                : "Öğrencinin hesap açmasına gerek yok. Bilgilerini eklemeniz yeterli."
          }
          action={
            !search && filter === "active" ? (
              <Button onClick={onAdd}>
                <Plus /> Öğrenci ekle
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}

export function PaymentsView({
  data,
  actions,
  busy,
}: {
  data: WorkspaceData;
  actions: Actions;
  busy: boolean;
}) {
  const due = data.students
    .filter((s) => balanceFor(data, s.id) > 0)
    .sort((a, b) => balanceFor(data, b.id) - balanceFor(data, a.id));
  const total = data.payments
    .filter((p) => !p.voided_at)
    .reduce((sum, p) => sum + Number(p.amount_minor), 0);
  const all = data.packages.reduce((sum, p) => sum + Number(p.price_minor), 0);
  return (
    <>
      <div className="finance-stats">
        <div>
          <span>Toplam paket tutarı</span>
          <strong>{money(all)}</strong>
        </div>
        <div>
          <span>
            <ArrowDownLeft size={14} /> Tahsil edilen
          </span>
          <strong className="text-primary">{money(total)}</strong>
        </div>
        <div>
          <span>Bekleyen tahsilat</span>
          <strong>{money(all - total)}</strong>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="panel self-start">
          <div className="section-heading">
            <div>
              <h2>Tahsilat geçmişi</h2>
              <p>Aldığınız ödemelerin manuel kayıtları</p>
            </div>
            <span className="subtle-badge">
              <Banknote size={13} /> Manuel
            </span>
          </div>
          {data.payments.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Öğrenci / tarih</TableHead>
                  <TableHead>Yöntem</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>
                    <span className="sr-only">İşlem</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => {
                  const s = data.students.find((s) => s.id === p.student_id)!;
                  return (
                    <TableRow
                      key={p.id}
                      className={p.voided_at ? "opacity-60" : ""}
                    >
                      <TableCell className="pl-6">
                        <button
                          className="student-name"
                          onClick={() => actions.openStudent(s.id)}
                        >
                          {s.name}
                        </button>
                        <small className="table-secondary">
                          {dayLabel(p.received_on + "T12:00:00+03:00", {
                            year: "numeric",
                          })}
                        </small>
                        {p.reference && (
                          <small
                            className="payment-reference"
                            title={p.reference}
                          >
                            {p.reference}
                          </small>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.method === "TRANSFER"
                          ? "Havale / EFT"
                          : p.method === "CASH"
                            ? "Nakit"
                            : "Diğer"}
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        {money(p.amount_minor)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`status ${p.voided_at ? "status-cancelled" : "status-completed"}`}
                        >
                          {p.voided_at ? "İptal" : "Kaydedildi"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {!p.voided_at && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={busy}
                                aria-label={`${s.name} tahsilat işlemleri`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => actions.voidPayment(p)}
                              >
                                <Undo2 /> Kaydı iptal et
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Empty
              icon={Wallet}
              title="Henüz tahsilat kaydı yok."
              text="Öğrencinizden aldığınız ödemeyi ekleyin; açık bakiye otomatik güncellensin."
              action={
                <Button variant="outline" onClick={() => actions.newPayment()}>
                  <Plus /> Tahsilat ekle
                </Button>
              }
            />
          )}
        </section>
        <aside className="panel self-start">
          <div className="section-heading">
            <h2>Açık bakiyeler</h2>
            <span className="subtle-badge">{due.length} öğrenci</span>
          </div>
          {due.length ? (
            <div className="due-list">
              {due.map((s) => (
                <div className="due-item" key={s.id}>
                  <div className="flex gap-3 items-center">
                    <StudentAvatar student={s} />
                    <div>
                      <button
                        className="student-name"
                        onClick={() => actions.openStudent(s.id)}
                      >
                        {s.name}
                      </button>
                      <small>{money(balanceFor(data, s.id))}</small>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${s.name} tahsilat ekle`}
                    onClick={() => actions.newPayment(s.id)}
                    disabled={busy}
                  >
                    <Plus />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <CircleCheck size={25} />
              <p>Bekleyen tahsilat yok.</p>
              <span>Paketlerden kalan ödemeler burada görünür.</span>
            </div>
          )}
        </aside>
      </div>
      <p className="finance-note">
        Bu ekran ödeme kaydı tutar; banka işlemi, karttan tahsilat veya fatura
        düzenleme yapmaz.
      </p>
    </>
  );
}
