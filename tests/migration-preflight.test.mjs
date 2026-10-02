import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { preflight } from "../scripts/legacy-preflight.mjs";

test("legacy preflight requires complete data, checks ledger and every ready asset, never claims cutover", async () => {
  const directory = await mkdtemp(`${tmpdir()}/derslik-migration-`);
  try {
    const ws = randomUUID(),
      student = randomUUID(),
      pack = randomUUID(),
      file = randomUUID();
    const tables = Object.fromEntries(
      [
        "workspaces",
        "students",
        "packages",
        "lessons",
        "credit_entries",
        "payments",
        "private_notes",
        "commands",
        "teaching_assignments",
        "teaching_files",
        "teaching_parts",
      ].map((t) => [t, []]),
    );
    tables.workspaces = [{ id: ws }];
    tables.students = [{ id: student, workspace_id: ws }];
    tables.packages = [
      {
        id: pack,
        workspace_id: ws,
        student_id: student,
        granted: 3,
        remaining: 3,
        price_minor: "12345",
      },
    ];
    tables.teaching_files = [
      {
        id: file,
        workspace_id: ws,
        student_id: student,
        state: "READY",
        kind: "document",
        size: 8,
      },
    ];
    const snapshot = {
      format: "derslik-d1-v4",
      complete: true,
      writesPaused: true,
      tables,
    };
    await assert.rejects(
      preflight({ ...snapshot, complete: false }, directory),
      /Tam/,
    );
    assert.equal((await preflight(snapshot, directory)).sourceValidated, false);
    await mkdir(`${directory}/teaching/${ws}`, { recursive: true });
    await writeFile(`${directory}/teaching/${ws}/${file}`, "%PDF-1.7");
    const result = await preflight(snapshot, directory);
    assert.equal(result.sourceValidated, true);
    assert.equal(result.cutoverReady, false);
    assert.equal(result.databaseWrites, 0);
    assert.match(result.assets[0].sha256, /^[0-9a-f]{64}$/);
    tables.packages[0].remaining = 2;
    assert.match(
      (await preflight(snapshot, directory)).blockers.join(" "),
      /ders hakkı/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy preflight reports identity, ledger, email, payment and upload problems in a stable order", async () => {
  const directory = await mkdtemp(`${tmpdir()}/derslik-migration-`);
  try {
    const [ws, other, student, stranger, pack, assignment] = Array.from(
      { length: 6 },
      () => randomUUID(),
    );
    const [ready, video, pending, deleted, odd] = Array.from(
      { length: 5 },
      () => randomUUID(),
    );
    const tables = Object.fromEntries(
      [
        "workspaces",
        "students",
        "packages",
        "lessons",
        "credit_entries",
        "payments",
        "private_notes",
        "commands",
        "teaching_assignments",
        "teaching_files",
        "teaching_parts",
      ].map((t) => [t, []]),
    );
    tables.workspaces = [{ id: ws }, { id: "bad-id" }];
    tables.students = [
      { id: student, workspace_id: ws, email: " A@x.com " },
      { id: stranger, workspace_id: other, email: "a@x.com" },
      { id: randomUUID(), workspace_id: ws, email: "A@X.COM" },
      { id: randomUUID(), workspace_id: ws, email: 5 },
    ];
    tables.packages = [
      {
        id: pack,
        workspace_id: ws,
        student_id: student,
        granted: "2",
        remaining: 2,
        price_minor: 100,
      },
    ];
    tables.credit_entries = [
      { id: randomUUID(), workspace_id: ws, package_id: pack, delta: "-1" },
    ];
    tables.payments = [
      {
        id: randomUUID(),
        workspace_id: ws,
        student_id: student,
        amount_minor: 150,
      },
      {
        id: randomUUID(),
        workspace_id: ws,
        student_id: student,
        amount_minor: 900,
        voided_at: "2024-01-01",
      },
    ];
    tables.lessons = [
      { id: randomUUID(), workspace_id: ws, student_id: stranger },
    ];
    tables.teaching_assignments = [
      { id: assignment, workspace_id: ws, student_id: student, due_on: null },
    ];
    const file = (id, state, kind, size) => ({
      id,
      workspace_id: ws,
      student_id: student,
      state,
      kind,
      size,
    });
    tables.teaching_files = [
      file(ready, "READY", "document", 3),
      file(video, "READY", "video", 3),
      file(pending, "UPLOADING", "document", 3),
      file(deleted, "DELETED", "document", 3),
      file(odd, "READY", "document", 9),
      { ...file("not-a-uuid", "READY", "document", 3) },
    ];
    await mkdir(`${directory}/teaching/${ws}`, { recursive: true });
    for (const id of [ready, video, odd])
      await writeFile(`${directory}/teaching/${ws}/${id}`, "abc");
    const snapshot = {
      format: "derslik-d1-v4",
      complete: true,
      writesPaused: true,
      tables,
    };
    const result = await preflight(snapshot, directory);
    assert.deepEqual(result.blockers, [
      "workspaces: geçersiz/tekrarlanan kimlik bad-id",
      `students/${stranger}: çalışma alanı eksik`,
      `lessons/${tables.lessons[0].id}: öğrenci bağlantısı uyumsuz`,
      "teaching_files: geçersiz/tekrarlanan kimlik not-a-uuid",
      `packages/${pack}: ders hakkı hareketleri ile kalan hak uyuşmuyor`,
      `students/${student}: tahsilat borçtan fazla; hedef tahsilat dağıtımı incelenmeli`,
      `teaching_files/${pending}: UPLOADING yüklemesini eski uygulamada tamamlayın veya iptal edin`,
      `teaching_files/${odd}: dosya yedeği eksik veya tutarsız (Boyut eşleşmiyor)`,
    ]);
    assert.deepEqual(result.warnings, [
      `teaching_assignments/${assignment}: teslim tarihi boş; PostgreSQL due_on alanında null olarak koruyun`,
      `students/${tables.students[2].id}: aynı öğretmende students/${student} ile aynı e-posta; aktarımda birinin e-postası boş bırakılmalı`,
    ]);
    assert.deepEqual(
      result.assets.map(({ id, target, sizeBytes }) => ({
        id,
        target,
        sizeBytes,
      })),
      [
        { id: ready, target: `${ws}/${student}/${ready}`, sizeBytes: "3" },
        {
          id: video,
          target: "Cloudflare Stream (private, signed URLs)",
          sizeBytes: "3",
        },
      ],
    );
    assert.equal(result.sourceValidated, false);
    assert.equal(result.counts.students, 4);
    await assert.rejects(
      preflight(
        {
          ...snapshot,
          tables: {
            ...tables,
            packages: [{ ...tables.packages[0], granted: 1.5 }],
          },
        },
        directory,
      ),
      /Kayıpsız tam sayı gerekli/,
    );
    await assert.rejects(
      preflight(
        { ...snapshot, tables: { ...tables, payments: undefined } },
        directory,
      ),
      /Eksik tablo: payments/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
