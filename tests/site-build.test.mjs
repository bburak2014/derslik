import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sites } from "../build/sites-vite-plugin.ts";

async function fixture(t, command = "build") {
  const root = await mkdtemp(join(tmpdir(), "derslik-site-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = sites({ mockAuth: false });
  plugin.configResolved({ root, command });
  return { root, build: () => plugin.closeBundle() };
}

test("portable build without hosting metadata removes stale deployment metadata", async (t) => {
  const { root, build } = await fixture(t);
  await mkdir(join(root, "dist", ".openai"), { recursive: true });
  await writeFile(join(root, "dist", ".openai", "hosting.json"), "stale");
  await build();
  await assert.rejects(access(join(root, "dist", ".openai")), {
    code: "ENOENT",
  });
});

test("configured build preserves hosting metadata and migration history", async (t) => {
  const { root, build } = await fixture(t);
  await mkdir(join(root, ".openai"));
  await mkdir(join(root, "drizzle"));
  const metadata = JSON.stringify({ site_id: "test-site" });
  await writeFile(join(root, ".openai", "hosting.json"), metadata);
  await writeFile(join(root, "drizzle", "0000.sql"), "select 1;");
  await build();
  assert.equal(
    await readFile(join(root, "dist", ".openai", "hosting.json"), "utf8"),
    metadata,
  );
  assert.equal(
    await readFile(
      join(root, "dist", ".openai", "drizzle", "0000.sql"),
      "utf8",
    ),
    "select 1;",
  );
});

test("development server does not alter build metadata", async (t) => {
  const { root, build } = await fixture(t, "serve");
  await mkdir(join(root, "dist", ".openai"), { recursive: true });
  await writeFile(join(root, "dist", ".openai", "hosting.json"), "preserved");
  await build();
  assert.equal(
    await readFile(join(root, "dist", ".openai", "hosting.json"), "utf8"),
    "preserved",
  );
});
