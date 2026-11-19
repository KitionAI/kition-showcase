// Exports the samples as plain files for a site that serves them beside the kits (kits.kition.ai
// `/samples/`): for the chosen kits, each sample's document, thumbnail and preview exactly as
// committed here, and `index.json` listing them with sizes, hashes and the commit they come from.
// No pages: the kits origin serves files only. Samples with no build, or whose document is larger
// than the limit, are left out and listed under `skipped`.
//
//   node tools/export.mjs --out <dir> [--kits sheet,slide,doc,photo,note] [--max-document-mb 20]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { KITS, ROOT } from "./kits.mjs";
import { loadSamples } from "./samples.mjs";

// What a browser is told each document is (the kits' saved formats, tools/kits.mjs extensions).
export const MIME = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".psd": "image/vnd.adobe.photoshop",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".html": "text/html",
  ".dxf": "image/vnd.dxf",
};

// PSDs are stored with Git LFS (.gitattributes); a checkout without it has these pointers instead.
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const size = (bytes) => (bytes >= 1048576 ? `${+(bytes / 1048576).toFixed(1)} MB` : `${bytes} bytes`);

function git(...args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// The commit the samples are exported from, and whether the exported kits differ from it.
export function sourceOf(kits) {
  const commit = git("rev-parse", "HEAD");
  if (!commit) return { repo: "kition-showcase", commit: null, dirty: null };
  return { repo: "kition-showcase", commit, dirty: Boolean(git("status", "--porcelain", "--", ...kits)) };
}

// Copies the samples' files under `out/<kit>/<slug>/` and answers the index (not written).
export function exportSamples(samples, { out, root = ROOT, maxDocumentBytes = Infinity, source = null }) {
  const index = { format: 1, source, kits: {}, samples: [], skipped: [] };
  for (const sample of samples) {
    const id = `${sample.kit}/${sample.slug}`;
    const kit = (index.kits[sample.kit] ??= { title: KITS[sample.kit]?.title ?? sample.kit, samples: 0, bytes: 0, skipped: 0 });
    const skip = (reason, bytes = null) => {
      index.skipped.push({ id, reason, bytes });
      kit.skipped += 1;
    };
    const build = sample.build;
    if (!build?.document) {
      skip("not built (no build.json)");
      continue;
    }
    const from = path.join(root, sample.kit, sample.slug);
    const documentFile = path.join(from, build.document.name);
    if (!fs.existsSync(documentFile)) {
      skip(`document ${build.document.name} missing`);
      continue;
    }
    const documentBytes = fs.readFileSync(documentFile);
    if (documentBytes.length > maxDocumentBytes) {
      skip(`document is ${size(documentBytes.length)}, over the ${size(maxDocumentBytes)} limit`, documentBytes.length);
      continue;
    }
    if (documentBytes.subarray(0, LFS_POINTER.length).toString() === LFS_POINTER) throw new Error(`${id}: ${build.document.name} is a Git LFS pointer, not the document (run git lfs pull)`);
    if (sha256(documentBytes) !== build.document.sha256) throw new Error(`${id}: ${build.document.name} does not match build.json (rebuild the sample)`);

    const files = [[build.document.name, documentBytes]];
    const thumbBytes = fs.readFileSync(path.join(from, build.thumbnail?.file ?? "thumb.png"));
    files.push(["thumb.png", thumbBytes]);
    let preview = null;
    if (build.preview) {
      const previewBytes = fs.readFileSync(path.join(from, build.preview.file));
      files.push([build.preview.file, previewBytes]);
      preview = { file: `${id}/${build.preview.file}`, frames: build.preview.frames ?? null, bytes: previewBytes.length, sha256: sha256(previewBytes) };
    }
    for (const [name, bytes] of files) {
      fs.mkdirSync(path.join(out, id), { recursive: true });
      fs.writeFileSync(path.join(out, id, name), bytes);
      kit.bytes += bytes.length;
    }
    kit.samples += 1;
    const [width, height] = build.thumbnail?.size ?? [null, null];
    index.samples.push({
      id,
      kit: sample.kit,
      slug: sample.slug,
      title: sample.title,
      summary: sample.summary,
      category: sample.category,
      tags: sample.tags ?? [],
      featured: Boolean(sample.featured),
      stats: build.stats ?? "",
      document: {
        file: `${id}/${build.document.name}`,
        name: build.document.name,
        bytes: documentBytes.length,
        sha256: build.document.sha256,
        mime: MIME[path.extname(build.document.name).toLowerCase()] ?? "application/octet-stream",
      },
      thumb: { file: `${id}/thumb.png`, width, height, bytes: thumbBytes.length, sha256: sha256(thumbBytes) },
      preview,
      built: { repo: build.kit?.repo ?? null, commit: build.kit?.commit ?? null },
    });
  }
  return index;
}

function main() {
  const args = process.argv.slice(2);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const outArg = value("--out");
  if (!outArg) throw new Error("usage: node tools/export.mjs --out <dir> [--kits sheet,slide] [--max-document-mb 20]");
  const out = path.resolve(outArg);
  const kits = value("--kits") ? value("--kits").split(",").map((kit) => kit.trim()).filter(Boolean) : Object.keys(KITS);
  for (const kit of kits) if (!KITS[kit]) throw new Error(`unknown kit ${kit} (kits: ${Object.keys(KITS).join(", ")})`);
  const maxMb = value("--max-document-mb");
  const maxDocumentBytes = maxMb ? Number(maxMb) * 1048576 : Infinity;

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // In the order the kits were asked for; each kit's samples by slug.
  const samples = loadSamples(kits.map((kit) => `${kit}/`)).sort((a, b) => kits.indexOf(a.kit) - kits.indexOf(b.kit));
  const index = exportSamples(samples, { out, maxDocumentBytes, source: sourceOf(kits) });
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
  for (const [kit, summary] of Object.entries(index.kits)) {
    console.log(`${kit}: ${summary.samples} samples, ${(summary.bytes / 1048576).toFixed(1)} MB${summary.skipped ? `, ${summary.skipped} skipped` : ""}`);
  }
  for (const skipped of index.skipped) console.log(`skipped ${skipped.id}: ${skipped.reason}`);
  console.log(`export: ${index.samples.length} samples in ${out} (kition-showcase ${index.source.commit?.slice(0, 10) ?? "?"}${index.source.dirty ? ", dirty" : ""})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
