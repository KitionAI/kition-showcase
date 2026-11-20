// Builds the replays the website plays over a sample: a trace of beats, each with the picture the
// kit renders after it and the places it changed. Nothing in a kit changes: like kition-universe's
// scripts/build-replays.mjs, the kit's `showcase` example runs the sample's first N steps for a
// series of N, and each render is the kit's own. The places come from the pixel difference of
// consecutive renders (tools/trace-core.mjs), so an actor only ever goes where the document changed.
//
//   .trace/<kit>/<slug>/trace.json     the beats (format below); not committed
//   .trace/<kit>/<slug>/frames/NN.webp frame 00 is the document before its first step
//
//   trace.json: { format, id, size: [w, h] (document px of the rendered area), frameSize, commands,
//     beats: [{ at, commands[], kind, targets: [{ rect: [x, y, w, h] }], frame, caption, page?, base? }],
//     frame0, bytes, source (sha256 of showcase.yaml), kit: { repo, commit }, version, paged,
//     pages?, pageKind? }
//
// Slides and document pages: when the thumbnail shows one page of several (`$inspect.slides.N.area`,
// `$inspect.pages.N.area`), the trace follows the work across them: every prefix renders each page of
// the finished document, a beat is on the page its change is on (`page`, from 0), and a beat that
// moves to another page carries `base`, that page before the beat (the stage flips to it first).
//
//   node tools/trace.mjs               the default set: each kit's hero sample and every featured one
//   node tools/trace.mjs doc/ photo/x  the samples whose id starts with these
//   --default    with ids: only the samples of the default set among them
//   --force      rebuild traces that are up to date
//   --cargo      build each kit's runner first (else only the missing ones are built)
//   --jobs N     samples traced at once (default 3)
//
// tools/site.mjs copies the traces into the site as <kit>/<slug>/replay/.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";

import { buildRunner, git, prelude, run, runner } from "./build.mjs";
import { FONTS, KITION_ROOT, KITS, ROOT } from "./kits.mjs";
import { loadSamples } from "./samples.mjs";
import { pickHero } from "./site/lib.mjs";
import {
  MAX_PAGED_BEATS, TRACE_FORMAT, beatCaption, beatKind, diffCells, initialPrefixes, nextRefinement, planBeats, stepLines, targetsOf, unionRect,
} from "./trace-core.mjs";

export const TRACE_DIR = path.join(ROOT, ".trace");
// Bumped when the way traces are made changes, so every trace is rebuilt.
const VERSION = 3;
// Versions whose traces only need their words redone (captions, kinds): no render changed since.
const WORDS_ONLY = [1, 2];
const FRAME_MAX = 640;
const BUDGET = 400 * 1024; // every frame of one sample together
const RENDER_BUDGET = 56; // renders of one sample at most (the refinement stops there)
const PAGED_KITS = { slide: "slides", doc: "pages" }; // kits whose traces follow the work across pages
const PAGE_AREA = /^\$inspect\.(pages|slides)\.\d+\.area$/;
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// The samples traced by default: every kit's hero sample (the home page plays it) and the featured ones.
export function defaultSet(samples) {
  const built = samples.filter((s) => s.build);
  const ids = new Set(built.filter((s) => s.featured).map((s) => s.id));
  for (const kit of new Set(built.map((s) => s.kit))) {
    const own = built.filter((s) => s.kit === kit);
    ids.add(pickHero(own.map((s) => ({ s, featured: Boolean(s.featured), steps: s.steps.length, commands: s.build.commands, slug: s.slug }))).s.id);
  }
  return built.filter((s) => ids.has(s.id));
}

// The stored trace of a sample, when it was made from this showcase.yaml.
export function readTrace(sample) {
  const file = path.join(TRACE_DIR, sample.kit, sample.slug, "trace.json");
  if (!fs.existsSync(file)) return null;
  try {
    const trace = JSON.parse(fs.readFileSync(file, "utf8"));
    return trace.source === sha256(sample.source) && trace.format === TRACE_FORMAT ? trace : null;
  } catch {
    return null;
  }
}

// A few runners at once: they are single-threaded but load fonts and render at full speed.
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const [work, resolve, reject] = queue.shift();
    work().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (work) => new Promise((resolve, reject) => { queue.push([work, resolve, reject]); next(); });
}
const runners = limiter(Math.max(2, Math.min(8, os.cpus().length - 2)));

// `$inspect.pages.0.area` (or an [x, y, w, h], or nothing) as the [x, y, w, h] the thumbnail shows.
function resolveArea(area, inspect, report) {
  let value = area;
  if (typeof area === "string" && area.startsWith("$inspect.")) {
    value = area.slice(9).split(".").reduce((at, key) => (at == null ? at : at[key]), inspect);
  }
  if (value == null) return [0, 0, report.width, report.height];
  const pick = (i, k) => Number(Array.isArray(value) ? value[i] : value[k]);
  const out = [pick(0, "x"), pick(1, "y"), pick(2, "width"), pick(3, "height")];
  if (out.some((n) => !Number.isFinite(n)) || out[2] <= 0 || out[3] <= 0) throw new Error(`area ${JSON.stringify(area)} resolves to ${JSON.stringify(value)}`);
  return out;
}

function makeRenderer(sample, work) {
  const kit = KITS[sample.kit];
  const thumbnail = sample.thumbnail ?? {};
  const seek = thumbnail.at === undefined || !kit.seek ? [] : [{ command: kit.seek, params: { [kit.seekParam ?? "seconds"]: thumbnail.at } }];
  const epoch = String(Math.floor(Date.parse(`${sample.since}T00:00:00Z`) / 1000));
  const before = prelude(sample);
  const pending = [];
  const render = (upto, options = {}) => {
    const job = attempt(upto, options);
    pending.push(job.catch(() => {}));
    return job;
  };
  render.settled = () => Promise.all(pending);
  return render;
  function attempt(upto, { area, areas, inspect = false } = {}) { return runners(async () => {
    // A view step naming something a later step makes cannot run yet: the kit shows its default view.
    const steps = [...before, ...sample.steps.slice(0, upto)];
    const made = new Set(steps.map((step) => step.as).filter(Boolean));
    const viewSteps = (thumbnail.steps ?? []).filter((step) => [...JSON.stringify(step).matchAll(/\$([A-Za-z_][\w-]*)/g)].every((m) => made.has(m[1])));
    const file = path.join(work, `p${String(upto).padStart(4, "0")}.png`);
    const pageFile = (i) => path.join(work, `p${String(upto).padStart(4, "0")}-${i}.png`);
    const request = {
      create: { name: sample.document.name, width: sample.document.width, height: sample.document.height },
      fonts: (sample.fonts ?? kit.defaultFonts ?? []).map((font) => path.join(FONTS, font)),
      steps,
      save: path.join(work, `doc-${upto}-${sample.document.name}`),
      renders: areas
        ? areas.map((a, i) => ({ file: pageFile(i), max: thumbnail.max ?? FRAME_MAX, area: a, steps: [] }))
        : [{ file, max: thumbnail.max ?? FRAME_MAX, area: area ?? thumbnail.area ?? kit.thumbnailArea ?? null, steps: [...seek, ...viewSteps] }],
      frames: null,
      inspect: path.join(work, `inspect-${upto}.json`),
    };
    const requestFile = path.join(work, `request-${upto}.json`);
    fs.writeFileSync(requestFile, JSON.stringify(request));
    const report = await run(runner(sample.kit), requestFile, { SOURCE_DATE_EPOCH: epoch, ...kit.env });
    if (report.error) throw new Error(`render after ${upto} steps: ${report.error}`);
    fs.rmSync(request.save, { force: true });
    if (areas) {
      // A paged render: one picture per page, each kept as its own file for the encoder.
      const pages = areas.map((_, i) => { const f = pageFile(i); const png = PNG.sync.read(fs.readFileSync(f)); return { file: f, width: png.width, height: png.height, data: png.data }; });
      return { upto, pages, width: pages[0].width, height: pages[0].height, report };
    }
    const png = PNG.sync.read(fs.readFileSync(file));
    const out = { upto, file, width: png.width, height: png.height, data: png.data, report };
    if (inspect) out.inspect = JSON.parse(fs.readFileSync(request.inspect, "utf8"));
    fs.rmSync(request.inspect, { force: true });
    return out;
  }); }
}

// WebP frames within the budget: lower quality first, then smaller frames.
function encodeFrames(pngs, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const attempts = [[80, 1], [72, 1], [64, 1], [56, 1], [48, 1], [40, 1], [40, 0.85], [34, 0.72], [30, 0.6]];
  let bytes = 0;
  for (const [q, scale] of attempts) {
    bytes = 0;
    pngs.forEach(({ file, width, height }, i) => {
      const out = path.join(dir, `${String(i).padStart(2, "0")}.webp`);
      const resize = scale < 1 ? ["-resize", String(Math.round(width * scale)), String(Math.round(height * scale))] : [];
      execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-af", ...resize, file, "-o", out]);
      bytes += fs.statSync(out).size;
    });
    if (bytes <= BUDGET) return { bytes, quality: q, scale };
  }
  return { bytes, quality: 30, scale: 0.6 };
}

// The pages a paged trace follows: the finished document's page areas, when the thumbnail shows one
// of several equal pages and has no view steps of its own; else null (the trace shows the thumbnail's area).
export function pagesOf(sample, inspect) {
  const key = PAGED_KITS[sample.kit];
  const spec = sample.thumbnail?.area ?? KITS[sample.kit].thumbnailArea;
  if (!key || typeof spec !== "string" || !PAGE_AREA.test(spec) || spec.split(".")[1] !== key || sample.thumbnail?.steps?.length) return null;
  const list = (inspect?.[key] ?? []).map((p) => p?.area).filter(Boolean).map((a) => [a.x, a.y, a.width, a.height].map(Number));
  if (list.length < 2 || list.some((a) => a.some((n) => !Number.isFinite(n)) || a[2] !== list[0][2] || a[3] !== list[0][3])) return null;
  return list;
}

async function traceSample(sample, kitInfo) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `trace-${sample.slug}-`));
  const render = makeRenderer(sample, work);
  try {
    const total = sample.steps.length;
    // The finished document first: its inspection fixes the area every frame shows.
    const full = await render(total, { inspect: true });
    const pageAreas = pagesOf(sample, full.inspect);
    const paged = Boolean(pageAreas);
    const area = paged ? pageAreas[0] : resolveArea(sample.thumbnail?.area ?? KITS[sample.kit].thumbnailArea ?? null, full.inspect, full.report);
    // A prefix the kit cannot show yet (film's playhead before a sequence exists) has no frame; the
    // replay starts at the first one it can.
    const frames = new Map();
    const get = (upto) => {
      if (!frames.has(upto)) frames.set(upto, render(upto, paged ? { areas: pageAreas } : { area }).catch(() => null));
      return frames.get(upto);
    };
    const last = await get(total);
    if (!last) throw new Error(`the finished document does not render with the area ${JSON.stringify(area)}`);
    const [fw, fh] = [last.width, last.height];
    const usable = async (p) => { const f = await get(p); return Boolean(f && f.width === fw && f.height === fh && (!paged || f.pages.every((x) => x.width === fw && x.height === fh))); };
    const prefixes = [];
    const firsts = initialPrefixes(total);
    await Promise.all(firsts.map(get));
    for (const p of firsts) if (await usable(p)) prefixes.push(p);
    // Every render is done before the plan, so differences are worked out synchronously, on demand.
    // Paged: the change between two prefixes is on the page that changed most (a tie: the later page).
    const done = new Map();
    const diffs = new Map();
    const diffOf = (from, to) => {
      const key = `${from}:${to}`;
      if (!diffs.has(key)) {
        let grid, page;
        if (paged) {
          done.get(from).pages.forEach((a, i) => {
            const g = diffCells(a.data, done.get(to).pages[i].data, fw, fh);
            if (!grid || g.changed >= grid.changed) { grid = g; page = i; }
          });
        } else grid = diffCells(done.get(from).data, done.get(to).data, fw, fh);
        const found = targetsOf(grid);
        diffs.set(key, { changed: grid.changed, cover: grid.cover, structure: found.structure, rects: found.rects, box: found.structure ? [0, 0, fw, fh] : unionRect(found.rects), ...(paged ? { page } : {}) });
      }
      return diffs.get(key);
    };
    const settle = async (list) => { for (const p of list) done.set(p, await get(p)); };
    // Segments between rendered prefixes; refine the widest-changing ones while renders are left.
    let rendered = [...prefixes];
    await settle(rendered);
    const segmentsOf = () => rendered.slice(1).map((to, i) => ({ from: rendered[i], to, ...diffOf(rendered[i], to) }));
    let segments = segmentsOf();
    const unsplit = new Set();
    while (frames.size < RENDER_BUDGET) {
      if (segments.filter((s) => s.changed).length >= (paged ? 30 : 24)) break;
      const mid = nextRefinement(segments.filter((x) => !unsplit.has(x.from)));
      if (mid === null) break;
      if (!(await usable(mid))) { unsplit.add(segments.find((x) => x.from < mid && mid < x.to).from); continue; }
      await settle([mid]);
      rendered = [...new Set([...rendered, mid])].sort((a, b) => a - b);
      segments = segmentsOf();
    }
    const beats = planBeats(segments, diffOf, paged ? { max: MAX_PAGED_BEATS } : {});
    if (!beats.length) throw new Error("no visible change between the first and the last render");

    const lines = stepLines(sample.source);
    const steps = sample.steps.map((_, i) => lines[i] ?? null);
    const sx = area[2] / fw, sy = area[3] / fh;
    const doc = (r) => [Math.round(r[0] * sx), Math.round(r[1] * sy), Math.round(r[2] * sx), Math.round(r[3] * sy)];
    const out = path.join(TRACE_DIR, sample.kit, `${sample.slug}.tmp`);
    fs.rmSync(out, { recursive: true, force: true });
    // The frames in order: before the first beat, then each beat's (a beat on a new page first
    // brings that page as it was before the beat).
    const pick = async (upto, page) => { const f = await get(upto); return paged ? f.pages[page] : f; };
    const pngs = [await pick(rendered[0], paged ? beats[0].page : 0)];
    const names = [];
    const name = () => `frames/${String(pngs.length - 1).padStart(2, "0")}.webp`;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      let base = null;
      if (paged && i > 0 && b.page !== beats[i - 1].page) { pngs.push(await pick(b.from, b.page)); base = name(); }
      pngs.push(await pick(b.to, paged ? b.page : 0));
      names.push({ frame: name(), base });
    }
    const encoded = encodeFrames(pngs, path.join(out, "frames"));
    const trace = {
      format: TRACE_FORMAT,
      id: sample.id,
      size: [Math.round(area[2]), Math.round(area[3])],
      frameSize: [fw, fh],
      commands: total,
      frame0: "frames/00.webp",
      paged,
      ...(paged ? { pages: pageAreas.length, pageKind: sample.kit === "slide" ? "slide" : "page" } : {}),
      beats: beats.map((b, i) => {
        const commands = sample.steps.slice(i === 0 ? 0 : b.from, b.to).map((s) => s.command);
        return {
          at: b.to,
          commands,
          kind: b.structure ? "structure" : beatKind(commands),
          targets: b.structure ? [] : b.rects.map((r) => ({ rect: doc(r) })),
          frame: names[i].frame,
          caption: beatCaption(steps, i === 0 ? 0 : b.from, b.to, commands),
          ...(paged ? { page: b.page } : {}),
          ...(names[i].base ? { base: names[i].base } : {}),
        };
      }),
      bytes: encoded.bytes,
      quality: encoded.quality,
      renders: frames.size,
      source: sha256(sample.source),
      kit: kitInfo,
      version: VERSION,
    };
    fs.writeFileSync(path.join(out, "trace.json"), `${JSON.stringify(trace, null, 1)}\n`);
    const dir = path.join(TRACE_DIR, sample.kit, sample.slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(out, dir);
    return trace;
  } finally {
    await render.settled();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const cargo = args.includes("--cargo");
  const jobsAt = args.indexOf("--jobs");
  const jobs = jobsAt >= 0 ? Number(args[jobsAt + 1]) : 3;
  const filters = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--jobs");
  const all = loadSamples();
  // Ids pick samples; with --default only those in the default set.
  const pool = filters.length && !args.includes("--default") ? all.filter((s) => s.build) : defaultSet(all);
  const samples = filters.length ? pool.filter((s) => filters.some((f) => s.id.startsWith(f))) : pool;
  if (!samples.length) throw new Error(`no built samples match ${filters.join(" ")}`);

  const kitInfo = {};
  const broken = {};
  for (const kit of [...new Set(samples.map((s) => s.kit))]) {
    const repo = path.join(KITION_ROOT, KITS[kit].repo);
    kitInfo[kit] = { repo: KITS[kit].repo, commit: git(repo, "rev-parse", "--short=10", "HEAD") };
    const todo = samples.filter((s) => s.kit === kit && (force || !upToDate(s, kitInfo[kit])));
    if (!todo.length) continue;
    if (cargo || !fs.existsSync(runner(kit))) {
      try {
        buildRunner(kit);
      } catch (error) {
        broken[kit] = `cannot build the runner: ${error.message.split("\n")[0]}`;
      }
    }
  }

  const started = Date.now();
  const results = { built: [], fresh: [], failed: [] };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, samples.length) }, async () => {
    while (next < samples.length) {
      const sample = samples[next++];
      if (!force && upToDate(sample, kitInfo[sample.kit])) { results.fresh.push(sample.id); continue; }
      if (!force && reword(sample, kitInfo[sample.kit])) { results.built.push(sample.id); console.log(`✓ ${sample.id}  captions and kinds redone`); continue; }
      if (broken[sample.kit]) { results.failed.push([sample.id, broken[sample.kit]]); continue; }
      const t = Date.now();
      try {
        const trace = await traceSample(sample, kitInfo[sample.kit]);
        results.built.push(sample.id);
        const kinds = trace.beats.map((b) => b.kind[0]).join("");
        const paging = trace.paged ? `  ${trace.pages} ${trace.pageKind}s, on ${new Set(trace.beats.map((b) => b.page)).size}` : "";
        console.log(`✓ ${sample.id}  ${trace.beats.length} beats [${kinds}]${paging}  ${trace.renders} renders  ${Math.round(trace.bytes / 1024)} KB q${trace.quality}  ${((Date.now() - t) / 1000).toFixed(1)} s`);
      } catch (error) {
        results.failed.push([sample.id, error.message]);
        console.error(`✗ ${sample.id}: ${error.message}`);
      }
    }
  }));
  for (const [id, why] of results.failed) console.error(`✗ ${id}: ${why}`);
  console.log(`traces: ${results.built.length} built, ${results.fresh.length} up to date, ${results.failed.length} left out, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  // Exits 0 with traces left out (the site simply has no replay for them); --strict makes it fail.
  process.exit(results.failed.length && args.includes("--strict") ? 1 : 0);
}

// A trace whose frames still hold but whose captions and kinds come from an older version of the
// rules gets them again from its beats.
function reword(sample, kit) {
  const trace = readTrace(sample);
  if (!trace || !WORDS_ONLY.includes(trace.version) || trace.kit?.commit !== kit.commit) return false;
  const lines = stepLines(sample.source);
  const steps = sample.steps.map((_, i) => lines[i] ?? null);
  let from = 0;
  for (const beat of trace.beats) {
    beat.commands = sample.steps.slice(from, beat.at).map((s) => s.command);
    if (beat.kind !== "structure") beat.kind = beatKind(beat.commands);
    beat.caption = beatCaption(steps, from, beat.at, beat.commands);
    from = beat.at;
  }
  trace.version = VERSION;
  fs.writeFileSync(path.join(TRACE_DIR, sample.kit, sample.slug, "trace.json"), `${JSON.stringify(trace, null, 1)}\n`);
  return true;
}

// A trace of a kit whose traces can follow pages (PAGED_KITS) predates paging when it does not say
// whether it is paged; it is made again.
function upToDate(sample, kit) {
  const trace = readTrace(sample);
  if (trace && PAGED_KITS[sample.kit] && trace.paged === undefined) return false;
  return Boolean(trace && trace.version === VERSION && trace.kit?.commit === kit.commit && fs.existsSync(path.join(TRACE_DIR, sample.kit, sample.slug, trace.beats.at(-1).frame)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
}
