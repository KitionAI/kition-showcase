// Builds the showcase samples: each `<kit>/<slug>/showcase.yaml` runs through its kit's
// `showcase` example (the kit's own commands and renderer), which writes the document, the
// thumbnail and, for kits with time, the frames of an animated preview. Then the sample's
// `expected` checks run, and `build.json` and the sample's README are written.
//
//   node tools/build.mjs                 build every sample, then the galleries
//   node tools/build.mjs photo/poster    build the samples whose id starts with these
//   node tools/build.mjs --check         build into a temporary folder and compare with what is
//                                        committed: thumbnails within the `render` tolerance and
//                                        every `expected` check; nothing in the repository changes
//   --no-cargo                           use the kits' examples as built
//   --jobs N                             samples built at once (default 4)

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { checkExpected } from "./expect.mjs";
import { cargoEnv, FONTS, KITION_ROOT, KITS, ROOT } from "./kits.mjs";
import { comparePng } from "./png.mjs";
import { renderSampleReadme, writeGalleries } from "./gallery.mjs";
import { loadSamples } from "./samples.mjs";

const REQUIRED = ["format", "id", "title", "summary", "category", "tags", "features", "document", "steps", "since"];

function kitFeatures(kit) {
  const file = path.join(KITION_ROOT, KITS[kit].repo, "features.yaml");
  return new Set(YAML.parse(fs.readFileSync(file, "utf8")).features.map((feature) => feature.id));
}

export function validate(sample, features) {
  const problems = REQUIRED.filter((key) => sample[key] === undefined).map((key) => `missing ${key}`);
  if (sample.format !== 1) problems.push(`format must be 1`);
  if (sample.id !== `${sample.kit}/${sample.slug}`) problems.push(`id must be ${sample.kit}/${sample.slug}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(sample.slug) || sample.slug.length > 40) problems.push(`slug: lowercase words joined by -, at most 40 characters`);
  if (typeof sample.since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sample.since)) problems.push(`since: a quoted YYYY-MM-DD`);
  const extension = path.extname(sample.document?.name ?? "");
  if (!KITS[sample.kit].extensions.includes(extension)) problems.push(`document.name: one of ${KITS[sample.kit].extensions.join(", ")}`);
  for (const feature of sample.features ?? []) if (!features.has(feature)) problems.push(`feature ${feature} is not in ${KITS[sample.kit].repo}/features.yaml`);
  if (!Array.isArray(sample.tags) || sample.tags.some((tag) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag))) problems.push(`tags: lowercase words joined by -`);
  if (sample.prelude && !KITS[sample.kit].preludes?.[sample.prelude]) problems.push(`prelude: ${sample.kit} has ${Object.keys(KITS[sample.kit].preludes ?? {}).join(", ") || "none"}`);
  if (sample.preview && !KITS[sample.kit].seek) problems.push(`preview: ${sample.kit} has no time to preview`);
  return problems;
}

export function git(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function runner(kit) {
  return path.join(KITION_ROOT, KITS[kit].repo, "target", "release", "examples", "showcase");
}

export function buildRunner(kit) {
  const { cargo, env } = cargoEnv();
  console.log(`building ${KITS[kit].package} --example showcase`);
  execFileSync(cargo, ["build", "--quiet", "--release", "-p", KITS[kit].package, "--example", "showcase"], { cwd: path.join(KITION_ROOT, KITS[kit].repo), env, stdio: "inherit" });
}

export function run(binary, request, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(binary, [request], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      let report;
      try {
        report = JSON.parse(stdout.trim().split("\n").at(-1));
      } catch {
        report = { error: `no report (exit ${code}): ${stderr.trim().split("\n").slice(-5).join(" / ")}` };
      }
      resolve(report);
    });
  });
}

export function prelude(sample) {
  return sample.prelude ? KITS[sample.kit].preludes?.[sample.prelude] ?? [] : [];
}

function request(sample, out, work) {
  const kit = KITS[sample.kit];
  const thumbnail = sample.thumbnail ?? {};
  const seekTo = (seconds) => (seconds === undefined || !kit.seek ? [] : [{ command: kit.seek, params: { [kit.seekParam ?? "seconds"]: seconds } }]);
  return {
    create: { name: sample.document.name, width: sample.document.width, height: sample.document.height },
    fonts: (sample.fonts ?? kit.defaultFonts ?? []).map((font) => path.join(FONTS, font)),
    steps: [...prelude(sample), ...sample.steps],
    save: path.join(out, sample.document.name),
    renders: [{ file: path.join(out, "thumb.png"), max: thumbnail.max ?? 640, area: thumbnail.area ?? kit.thumbnailArea ?? null, steps: [...seekTo(thumbnail.at), ...(thumbnail.steps ?? [])] }],
    frames: sample.preview
      ? { dir: path.join(work, "frames"), seek: kit.seek, param: kit.seekParam ?? "seconds", from: sample.preview.from ?? 0, to: sample.preview.to, fps: sample.preview.fps ?? 10, max: sample.preview.max ?? 400 }
      : null,
    inspect: path.join(work, "inspect.json"),
  };
}

function encodePreview(sample, work, out) {
  const frames = fs.readdirSync(path.join(work, "frames")).filter((name) => name.endsWith(".png")).sort().map((name) => path.join(work, "frames", name));
  const delay = Math.round(1000 / (sample.preview.fps ?? 10));
  execFileSync("img2webp", ["-loop", "0", "-lossy", "-q", String(sample.preview.quality ?? 70), "-d", String(delay), ...frames, "-o", path.join(out, "preview.webp")], { stdio: "ignore" });
}

async function buildSample(sample, { check, kitInfo }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `showcase-${sample.slug}-`));
  const out = check ? path.join(work, "out") : sample.dir;
  fs.mkdirSync(out, { recursive: true });
  const requestFile = path.join(work, "request.json");
  fs.writeFileSync(requestFile, JSON.stringify(request(sample, out, work), null, 2));
  // Saved times come from the sample's date, so a document's bytes are the same on every build.
  const epoch = String(Math.floor(Date.parse(`${sample.since}T00:00:00Z`) / 1000));
  const report = await run(runner(sample.kit), requestFile, { SOURCE_DATE_EPOCH: epoch, ...KITS[sample.kit].env });
  if (report.error) return { sample, problems: [`build: ${report.error}`] };

  const inspect = JSON.parse(fs.readFileSync(path.join(work, "inspect.json"), "utf8"));
  if (sample.preview) encodePreview(sample, work, out);
  const problems = checkExpected(sample, { report, inspect });

  const documentFile = path.join(out, sample.document.name);
  const build = {
    id: sample.id,
    kit: kitInfo,
    size: [report.width, report.height],
    stats: KITS[sample.kit].stats ? KITS[sample.kit].stats(inspect) : report.summary,
    commands: report.steps - prelude(sample).length,
    document: { name: sample.document.name, bytes: fs.statSync(documentFile).size, sha256: sha256(documentFile) },
    thumbnail: { file: "thumb.png", size: report.renders[0].size, sha256: sha256(path.join(out, "thumb.png")) },
    preview: sample.preview ? { file: "preview.webp", frames: report.frames, bytes: fs.statSync(path.join(out, "preview.webp")).size } : null,
    diagnostics: report.diagnostics,
    built_ms: report.built_ms,
  };

  if (check) {
    const committed = path.join(sample.dir, "build.json");
    if (!fs.existsSync(committed)) problems.push("never built: run node tools/build.mjs first");
    else {
      const compared = comparePng(path.join(out, "thumb.png"), path.join(sample.dir, "thumb.png"), sample.tolerance ?? "render");
      if (!compared.ok) problems.push(`thumbnail differs: ${compared.problems.join(", ")}`);
      const before = JSON.parse(fs.readFileSync(committed, "utf8"));
      if (before.stats !== build.stats) problems.push(`stats changed: "${before.stats}" → "${build.stats}"`);
    }
  } else {
    fs.writeFileSync(path.join(sample.dir, "build.json"), `${JSON.stringify(build, null, 2)}\n`);
    fs.writeFileSync(path.join(sample.dir, "README.md"), renderSampleReadme(sample, build));
  }
  fs.rmSync(work, { recursive: true, force: true });
  return { sample, build, problems };
}

async function pool(items, jobs, work) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const cargo = !args.includes("--no-cargo");
  const jobsAt = args.indexOf("--jobs");
  const jobs = jobsAt >= 0 ? Number(args[jobsAt + 1]) : 4;
  const filters = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--jobs");

  const samples = loadSamples(filters);
  if (!samples.length) throw new Error(`no samples match ${filters.join(" ") || "anything"}`);
  const kits = [...new Set(samples.map((sample) => sample.kit))];
  const kitInfo = {};
  let invalid = 0;
  for (const kit of kits) {
    const repo = path.join(KITION_ROOT, KITS[kit].repo);
    const features = kitFeatures(kit);
    for (const sample of samples.filter((s) => s.kit === kit)) {
      const problems = validate(sample, features);
      if (problems.length) {
        invalid += 1;
        console.error(`✗ ${sample.kit}/${sample.slug}: ${problems.join("; ")}`);
      }
    }
    if (cargo) buildRunner(kit);
    kitInfo[kit] = { repo: KITS[kit].repo, commit: git(repo, "rev-parse", "--short=10", "HEAD"), dirty: Boolean(git(repo, "status", "--porcelain", "--untracked-files=no")) };
  }
  if (invalid) process.exit(1);

  const started = Date.now();
  const results = await pool(samples, jobs, (sample) => buildSample(sample, { check, kitInfo: kitInfo[sample.kit] }));
  let failed = 0;
  for (const { sample, build, problems } of results) {
    if (problems.length) {
      failed += 1;
      console.error(`✗ ${sample.id}\n    ${problems.join("\n    ")}`);
    } else {
      console.log(`✓ ${sample.id}  ${build.stats}`);
    }
  }
  console.log(`${results.length - failed}/${results.length} samples ${check ? "match" : "built"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (!check) writeGalleries();
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
