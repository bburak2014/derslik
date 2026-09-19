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
