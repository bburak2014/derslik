import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Command } from "../../../../packages/contracts/src/validation.js";
import type { MutationResult } from "../common/command.service.js";
import { lockStudent } from "../students/students.service.js";
import { istanbulDay } from "../lessons/lessons.service.js";

export async function openCharges(tx: PoolClient, ws: string, student: string) {
  return (
    await tx.query(
      `SELECT c.*, c.amount_minor - COALESCE((
       SELECT SUM(a.amount_minor) FROM derslik.payment_allocations a
       JOIN derslik.payments p ON p.workspace_id=a.workspace_id AND p.id=a.payment_id AND p.voided_at IS NULL
       WHERE a.workspace_id=c.workspace_id AND a.charge_id=c.id
     ),0)::bigint AS outstanding_minor
     FROM derslik.charges c WHERE c.workspace_id=$1 AND c.student_id=$2 ORDER BY c.created_at,c.id`,
      [ws, student],
    )
  ).rows;
}

@Injectable()
export class BillingService {
  async mutate(
    tx: PoolClient,
    ws: string,
    c: Command,
  ): Promise<MutationResult> {
    if (c.action === "package.create") {
      await lockStudent(tx, ws, c.studentId, true);
      const pack = (
        await tx.query(
          "INSERT INTO derslik.packages (workspace_id,student_id,name,granted,remaining,price_minor,expires_on) VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING *",
          [ws, c.studentId, c.name, c.granted, c.priceMinor, c.expiresOn],
        )
      ).rows[0];
      const charge = (
        await tx.query(
          "INSERT INTO derslik.charges (workspace_id,student_id,package_id,amount_minor) VALUES ($1,$2,$3,$4) RETURNING *",
          [ws, c.studentId, pack.id, c.priceMinor],
        )
      ).rows[0];
      return {
        data: { ...pack, charge },
        audit: { chargeId: charge.id, priceMinor: c.priceMinor },
      };
    }
    if (c.action === "payment.create") {
      await lockStudent(tx, ws, c.studentId);
      if (c.receivedOn > istanbulDay(new Date()))
        throw new ConflictException("api.paymentDateFuture");
      const charges = await openCharges(tx, ws, c.studentId);
      const outstanding = charges.reduce(
        (sum: bigint, row) => sum + BigInt(row.outstanding_minor),
        0n,
      );
      let unallocated = BigInt(c.amountMinor);
      if (unallocated > outstanding)
        throw new ConflictException("api.paymentExceedsBalance");
      const payment = (
        await tx.query(
          "INSERT INTO derslik.payments (workspace_id,student_id,amount_minor,received_on,method,reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [ws, c.studentId, c.amountMinor, c.receivedOn, c.method, c.reference],
        )
      ).rows[0];
      const allocations = [];
      for (const charge of charges) {
        if (unallocated === 0n) break;
        const due = BigInt(charge.outstanding_minor);
        if (due <= 0n) continue;
        const amount = due < unallocated ? due : unallocated;
        allocations.push(
          (
            await tx.query(
              "INSERT INTO derslik.payment_allocations (workspace_id,student_id,payment_id,charge_id,amount_minor) VALUES ($1,$2,$3,$4,$5) RETURNING *",
              [ws, c.studentId, payment.id, charge.id, amount.toString()],
            )
          ).rows[0],
        );
        unallocated -= amount;
      }
      return {
        data: { ...payment, allocations },
        audit: {
          amountMinor: c.amountMinor,
          allocationCount: allocations.length,
        },
      };
    }
    if (c.action === "payment.void") {
      const lookup = (
        await tx.query(
          "SELECT student_id FROM derslik.payments WHERE workspace_id=$1 AND id=$2",
          [ws, c.id],
        )
      ).rows[0];
      if (!lookup) throw new NotFoundException("api.paymentNotFound");
      await lockStudent(tx, ws, lookup.student_id);
      const payment = (
        await tx.query(
          "SELECT * FROM derslik.payments WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [ws, c.id],
        )
      ).rows[0];
      if (payment.version !== c.version || payment.voided_at)
        throw new ConflictException("api.paymentChanged");
      const data = (
        await tx.query(
          "UPDATE derslik.payments SET voided_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
          [ws, c.id],
        )
      ).rows[0];
      // Immutable allocations stay as history; balances exclude voided payments.
      return { data, audit: { amountMinor: payment.amount_minor } };
    }
    throw new Error("Unsupported billing action");
  }
}
