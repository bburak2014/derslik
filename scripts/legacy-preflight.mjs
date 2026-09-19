// Read-only migration preflight. Never connects to or alters a live database.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tables = [
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
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function integer(value) {
  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^-?\d+$/.test(value))
  )
    return BigInt(value);
  throw new Error("Kayıpsız tam sayı gerekli.");
}
export async function preflight(snapshot, objects) {
  if (
    snapshot.format !== "derslik-d1-v4" ||
    snapshot.complete !== true ||
    snapshot.writesPaused !== true
  )
    throw new Error(
      "Tam, yazımlar durdurulmuş bir v4 dışa aktarımı gerekli. Kısaltılmış tablo görüntüsü kullanmayın.",
    );
  for (const name of tables)
    if (!Array.isArray(snapshot.tables?.[name]))
      throw new Error(`Eksik tablo: ${name}`);
  const data = snapshot.tables;
  const blockers = [],
    warnings = [],
    assets = [];
  const students = new Map(data.students.map((r) => [r.id, r]));
  const workspaces = new Set(data.workspaces.map((r) => r.id));
  for (const name of tables.filter(
    (n) => !["teaching_parts", "commands"].includes(n),
  )) {
    const ids = new Set();
    for (const row of data[name]) {
      if (!uuid.test(row.id) || ids.has(row.id))
        blockers.push(`${name}: geçersiz/tekrarlanan kimlik ${row.id}`);
      ids.add(row.id);
      if (name !== "workspaces" && !workspaces.has(row.workspace_id))
        blockers.push(`${name}/${row.id}: çalışma alanı eksik`);
      if (
        row.student_id &&
        students.get(row.student_id)?.workspace_id !== row.workspace_id
      )
        blockers.push(`${name}/${row.id}: öğrenci bağlantısı uyumsuz`);
    }
  }
  for (const p of data.packages) {
    const movement = data.credit_entries
      .filter((c) => c.package_id === p.id)
      .reduce((n, c) => n + integer(c.delta), 0n);
    if (integer(p.granted) + movement !== integer(p.remaining))
      blockers.push(
        `packages/${p.id}: ders hakkı hareketleri ile kalan hak uyuşmuyor`,
      );
  }
  for (const a of data.teaching_assignments)
    if (!a.due_on)
      warnings.push(
        `teaching_assignments/${a.id}: teslim tarihi boş; PostgreSQL due_on alanında null olarak koruyun`,
      );
  for (const s of data.students) {
    const charges = data.packages
      .filter((p) => p.student_id === s.id)
      .reduce((n, p) => n + integer(p.price_minor), 0n);
    const paid = data.payments
      .filter((p) => p.student_id === s.id && !p.voided_at)
      .reduce((n, p) => n + integer(p.amount_minor), 0n);
    if (paid > charges)
      blockers.push(
        `students/${s.id}: tahsilat borçtan fazla; hedef tahsilat dağıtımı incelenmeli`,
      );
  }
  for (const f of data.teaching_files) {
    if (f.state === "DELETED") continue;
    if (f.state !== "READY") {
      blockers.push(
        `teaching_files/${f.id}: ${f.state} yüklemesini eski uygulamada tamamlayın veya iptal edin`,
      );
      continue;
    }
    if (!uuid.test(f.id) || !uuid.test(f.workspace_id)) continue;
    const key = `teaching/${f.workspace_id}/${f.id}`;
    try {
      const file = resolve(objects, key);
      const info = await stat(file);
      if (!info.isFile() || BigInt(info.size) !== integer(f.size))
        throw new Error("Boyut eşleşmiyor");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      assets.push({
        id: f.id,
        workspaceId: f.workspace_id,
        studentId: f.student_id,
        kind: f.kind,
        sourceKey: key,
        sizeBytes: String(info.size),
        sha256: hash.digest("hex"),
        target:
          f.kind === "video"
            ? "Cloudflare Stream (private, signed URLs)"
            : `${f.workspace_id}/${f.student_id}/${f.id}`,
      });
    } catch (e) {
      blockers.push(
        `teaching_files/${f.id}: dosya yedeği eksik veya tutarsız (${e.message})`,
      );
    }
  }
  return {
    format: "derslik-migration-preflight-v1",
    databaseWrites: 0,
    counts: Object.fromEntries(tables.map((t) => [t, data[t].length])),
    blockers,
    warnings,
    assets,
    sourceValidated: blockers.length === 0,
    cutoverReady: false,
    next: "Kimlik eşlemesi, PostgreSQL aktarımı ve hedef dosya/video doğrulaması ayrıca tamamlanmalıdır.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [snapshotFile, objectDirectory, reportFile] = process.argv.slice(2);
    if (!snapshotFile || !objectDirectory || !reportFile)
      throw new Error(
        "Kullanım: pnpm migration:check snapshot.json objects rapor.json",
      );
    const result = await preflight(
      JSON.parse(await readFile(snapshotFile, "utf8")),
      objectDirectory,
    );
    await writeFile(reportFile, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      `Ön kontrol: ${result.blockers.length} engel, ${result.assets.length} dosya. Veritabanına yazılmadı.`,
    );
    process.exitCode = result.sourceValidated ? 0 : 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
