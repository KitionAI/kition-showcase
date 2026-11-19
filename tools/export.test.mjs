import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { exportSamples } from "./export.mjs";
import { ROOT } from "./kits.mjs";
import { loadSamples } from "./samples.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A source tree with one sample per case: built, built with a preview, too large, not built.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-export-"));
  const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
    return Buffer.from(bytes);
  };
  const sample = (kit, slug, document, extra = {}) => {
    const bytes = write(`${kit}/${slug}/${document.name}`, document.bytes);
    write(`${kit}/${slug}/thumb.png`, "png");
    const build = {
      kit: { repo: `kition-${kit}`, commit: "abc1234" },
      stats: "1 sheet",
      document: { name: document.name, bytes: bytes.length, sha256: sha256(bytes) },
      thumbnail: { file: "thumb.png", size: [640, 400] },
      preview: null,
      ...extra,
    };
    return { kit, slug, title: slug, summary: `${slug}.`, category: "Tests", tags: ["t"], featured: slug === "budget", build };
  };
  write("photo/moving/preview.webp", "webp");
  const samples = [
    sample("sheet", "budget", { name: "budget.xlsx", bytes: "xlsx" }),
    sample("photo", "moving", { name: "moving.psd", bytes: "psd" }, { preview: { file: "preview.webp", frames: 30 } }),
    sample("photo", "huge", { name: "huge.psd", bytes: "x".repeat(64) }),
    { kit: "sheet", slug: "unbuilt", title: "Unbuilt", build: null },
  ];
  return { root, samples };
}

test("writes each sample's document, thumbnail and preview under <kit>/<slug>/ and indexes them", () => {
  const { root, samples } = fixture();
  const out = path.join(root, "out");
  const index = exportSamples(samples, { out, root, maxDocumentBytes: 16, source: { repo: "kition-showcase", commit: "c0ffee", dirty: false } });

  assert.deepEqual(index.samples.map((s) => s.id), ["sheet/budget", "photo/moving"]);
  assert.equal(fs.readFileSync(path.join(out, "sheet/budget/budget.xlsx"), "utf8"), "xlsx");
  assert.ok(fs.existsSync(path.join(out, "sheet/budget/thumb.png")));
  assert.ok(fs.existsSync(path.join(out, "photo/moving/preview.webp")));
  assert.ok(!fs.existsSync(path.join(out, "photo/huge")));

  const [budget, moving] = index.samples;
  assert.deepEqual(budget.document, {
    file: "sheet/budget/budget.xlsx",
    name: "budget.xlsx",
    bytes: 4,
    sha256: sha256("xlsx"),
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.equal(budget.featured, true);
  assert.deepEqual(budget.thumb, { file: "sheet/budget/thumb.png", width: 640, height: 400, bytes: 3, sha256: sha256("png") });
  assert.equal(budget.preview, null);
  assert.equal(moving.document.mime, "image/vnd.adobe.photoshop");
  assert.equal(moving.preview.file, "photo/moving/preview.webp");
  assert.equal(index.source.commit, "c0ffee");
  assert.deepEqual(index.kits.photo, { title: "Photo", samples: 1, bytes: 3 + 3 + 4, skipped: 1 });
});

test("lists what it leaves out, and why", () => {
  const { root, samples } = fixture();
  const index = exportSamples(samples, { out: path.join(root, "out"), root, maxDocumentBytes: 16 });
  assert.deepEqual(index.skipped, [
    { id: "photo/huge", reason: "document is 64 bytes, over the 16 bytes limit", bytes: 64 },
    { id: "sheet/unbuilt", reason: "not built (no build.json)", bytes: null },
  ]);
});

test("refuses a document that no longer matches its build", () => {
  const { root, samples } = fixture();
  fs.writeFileSync(path.join(root, "sheet/budget/budget.xlsx"), "changed");
  assert.throws(() => exportSamples(samples.slice(0, 1), { out: path.join(root, "out"), root }), /does not match build\.json/);
});

test("names a Git LFS pointer left in place of a document", () => {
  const { root, samples } = fixture();
  fs.writeFileSync(path.join(root, "photo/moving/moving.psd"), "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 3\n");
  assert.throws(() => exportSamples([samples[1]], { out: path.join(root, "out"), root }), /Git LFS pointer/);
});

test("every built sample in the tree has its document and thumbnail committed beside it", () => {
  for (const sample of loadSamples().filter((s) => s.build)) {
    const dir = path.join(ROOT, sample.kit, sample.slug);
    assert.ok(fs.existsSync(path.join(dir, sample.build.document.name)), `${sample.kit}/${sample.slug}: ${sample.build.document.name}`);
    assert.ok(fs.existsSync(path.join(dir, "thumb.png")), `${sample.kit}/${sample.slug}: thumb.png`);
  }
});
