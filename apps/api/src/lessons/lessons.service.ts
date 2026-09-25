import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Command } from "../../../../packages/contracts/src/validation.js";
import type { MutationResult } from "../common/command.service.js";
import { lockStudent } from "../students/students.service.js";

export function istanbulDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function calendarLock(tx: PoolClient, ws: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `calendar:${ws}`,
  ]);
}

function checkExpiry(expiresOn: string | null, start: Date) {
  if (expiresOn && expiresOn < istanbulDay(start))
    throw new ConflictException("api.lessonAfterPackageExpiry");
}

@Injectable()
export class LessonsService {
  async mutate(
    tx: PoolClient,
    ws: string,
    c: Command,
  ): Promise<MutationResult> {
    if (c.action === "lesson.create") {
      await calendarLock(tx, ws);
      await lockStudent(tx, ws, c.studentId, true);
      const pack = (
        await tx.query(
          "SELECT * FROM derslik.packages WHERE workspace_id=$1 AND id=$2 AND student_id=$3 FOR UPDATE",
          [ws, c.packageId, c.studentId],
        )
      ).rows[0];
      if (!pack) throw new NotFoundException("api.packageNotFound");
      if (pack.remaining < 1)
        throw new ConflictException("api.packageNoCredits");
      if (c.makeupForId) {
        if (c.weeks !== 1) throw new ConflictException("api.makeupSingle");
        const original = (
          await tx.query(
            "SELECT id FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND status='CANCELLED'",
            [ws, c.studentId, c.makeupForId],
          )
        ).rows[0];
        if (!original) throw new ConflictException("api.makeupPickCancelled");
      }
      const series = c.weeks > 1 ? randomUUID() : null;
      const lessons = [];
      for (let week = 0; week < c.weeks; week++) {
        // Europe/Istanbul uses UTC+3; the workspace timezone is fixed in this release.
        const start = new Date(Date.parse(c.startsAt) + week * 7 * 86_400_000);
        const end = new Date(start.getTime() + c.duration * 60_000);
        checkExpiry(pack.expires_on, start);
        lessons.push(
          (
            await tx.query(
              `INSERT INTO derslik.lessons (workspace_id,student_id,package_id,topic,starts_at,ends_at,location,series_id,makeup_for_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
              [
                ws,
                c.studentId,
                c.packageId,
                c.topic,
                start,
                end,
                c.location,
                series,
                c.makeupForId || null,
              ],
            )
          ).rows[0],
        );
      }
      return {
        data: { id: lessons[0].id, lessons },
        audit: { count: lessons.length, seriesId: series },
      };
    }

    if (!(
      c.action === "lesson.complete" ||
      c.action === "lesson.reverse" ||
      c.action === "lesson.cancel" ||
      c.action === "lesson.reschedule"
    ))
      throw new Error("Unsupported lesson action");
    if (c.action === "lesson.reschedule") await calendarLock(tx, ws);
    const lookup = (
      await tx.query(
        "SELECT student_id FROM derslik.lessons WHERE workspace_id=$1 AND id=$2",
        [ws, c.id],
      )
    ).rows[0];
    if (!lookup) throw new NotFoundException("api.lessonNotFound");
    // All student mutations take this lock first, including archive and payments.
    await lockStudent(
      tx,
      ws,
      lookup.student_id,
      c.action === "lesson.reverse" || c.action === "lesson.reschedule",
    );
    const lesson = (
      await tx.query(
        "SELECT * FROM derslik.lessons WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [ws, c.id],
      )
    ).rows[0];
    if (lesson.version !== c.version)
      throw new ConflictException("api.lessonChanged");
    const expected = c.action === "lesson.reverse" ? "COMPLETED" : "SCHEDULED";
    if (lesson.status !== expected)
      throw new ConflictException("api.lessonStateInvalid");
    if (c.action === "lesson.cancel") {
      const data = (
        await tx.query(
          "UPDATE derslik.lessons SET status='CANCELLED',version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
          [ws, c.id],
        )
      ).rows[0];
      return { data, audit: { previousStatus: lesson.status } };
    }
    const pack = (
      await tx.query(
        "SELECT * FROM derslik.packages WHERE workspace_id=$1 AND id=$2 AND student_id=$3 FOR UPDATE",
        [ws, lesson.package_id, lesson.student_id],
      )
    ).rows[0];
    if (c.action === "lesson.reschedule") {
      const start = new Date(c.startsAt),
        end = new Date(start.getTime() + c.duration * 60_000);
      checkExpiry(pack.expires_on, start);
      const data = (
        await tx.query(
          "UPDATE derslik.lessons SET starts_at=$3,ends_at=$4,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
          [ws, c.id, start, end],
        )
      ).rows[0];
      return {
        data,
        audit: { previousStartsAt: lesson.starts_at, startsAt: start },
      };
    }
    const delta = c.action === "lesson.complete" ? -1 : 1;
    let reversesId: string | null = null;
    if (delta === -1) {
      if (pack.remaining < 1)
        throw new ConflictException("api.packageCreditsUsedUp");
      checkExpiry(pack.expires_on, lesson.starts_at);
    } else {
      const debit = (
        await tx.query(
          "SELECT id FROM derslik.credit_entries WHERE workspace_id=$1 AND lesson_id=$2 AND revision=$3 AND delta=-1",
          [ws, c.id, lesson.version - 1],
        )
      ).rows[0];
      if (!debit) throw new ConflictException("api.creditToReturnNotFound");
      reversesId = debit.id;
    }
    const entry = (
      await tx.query(
        `INSERT INTO derslik.credit_entries (workspace_id,student_id,package_id,lesson_id,revision,delta,reason,reverses_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          ws,
          lesson.student_id,
          lesson.package_id,
          c.id,
          lesson.version,
          delta,
          delta === -1 ? "LESSON_COMPLETED" : "COMPLETION_REVERSED",
          reversesId,
        ],
      )
    ).rows[0];
    const balance = (
      await tx.query(
        "UPDATE derslik.packages SET remaining=remaining+$3 WHERE workspace_id=$1 AND id=$2 RETURNING remaining",
        [ws, pack.id, delta],
      )
    ).rows[0];
    const data = (
      await tx.query(
        "UPDATE derslik.lessons SET status=$3,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
        [ws, c.id, delta === -1 ? "COMPLETED" : "SCHEDULED"],
      )
    ).rows[0];
    return {
      data: { ...data, remaining: balance.remaining, creditEntry: entry },
      audit: { delta, creditEntryId: entry.id },
    };
  }
}
