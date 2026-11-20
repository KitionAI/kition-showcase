// Writes the showcase as a static website, one pre-rendered page per URL, meant to be served
// under a path of kition.ai (`--base /showcase`, the default) by any static file server:
//
//   <base>                    index.html            every sample, the hero and the kit row
//   <base>/<kit>              <kit>/index.html      one kit's samples, by category
//   <base>/<kit>/<slug>       <kit>/<slug>/index.html  one sample: picture, spec, steps, checks
//   404.html, sitemap.xml, assets/ (hashed CSS and JS, icons, share images), fonts/
//
// Page URLs carry no trailing slash; every link is root-relative under the base. Each sample's
// thumbnail, preview and document sit next to its page. Every page is complete without
// JavaScript; tools/site/site.js adds search, filters, the hero animation and previews. The
// templates are in tools/site/pages.mjs, the pure helpers in tools/site/lib.mjs.
//
//   node tools/site.mjs [--out dist] [--base /showcase] [--origin https://kition.ai] [--no-documents]

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { KITS, ROOT } from "./kits.mjs";

// The site lists the kits in the order of the kition.ai home page (its kit row), not the README order.
const SITE_KIT_ORDER = ["motion", "film", "photo", "slide", "vector", "layout", "design", "scene", "board", "cad", "sheet", "table", "pdf", "doc", "note", "html"];
const byKitOrder = (a, b) => SITE_KIT_ORDER.indexOf(a) - SITE_KIT_ORDER.indexOf(b);
import { loadSamples } from "./samples.mjs";
import {
  HERO_CALLS, KIT_REEL, MIME, extOf, hashName, homeDescription, homeLd, homeTitle, kitDescription, kitLd, kitTitle, newest,
  pickHero, pngSize, rankReplays, sampleDescription, sampleLd, sampleTitle, sitemap, urls,
} from "./site/lib.mjs";
import { TRACE_FORMAT } from "./trace-core.mjs";
import { homeMain, kitMain, notFoundMain, sampleMain, shell } from "./site/pages.mjs";
import { githubStarsAtBuild } from "./site/github.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = path.resolve(opt("--out", path.join(ROOT, "dist")));
const DOCUMENTS = !args.includes("--no-documents");
const SITE = path.join(ROOT, "tools", "site");
const u = urls({ base: opt("--base", "/showcase"), origin: opt("--origin", "https://kition.ai") });

// Each kit's colour (kition.ai's dark-theme kit colours) and the word the page's headline rolls
// through for it: what the kit makes.
const LOOK = {
  note: { color: "#8b7cf0", word: "Notes." },
  table: { color: "#3fd1bf", word: "Tables." },
  board: { color: "#ffd04d", word: "Boards." },
  doc: { color: "#6b9bff", word: "Docs." },
  sheet: { color: "#4fd17b", word: "Sheets." },
  slide: { color: "#ff9a55", word: "Slides." },
  pdf: { color: "#ff7a6b", word: "PDFs." },
  html: { color: "#ff986b", word: "Pages." },
  photo: { color: "#4ccbf0", word: "Posters." },
  vector: { color: "#a6d64a", word: "Artwork." },
  layout: { color: "#f57bbd", word: "Layouts." },
  design: { color: "#02da96", word: "Screens." },
  film: { color: "#a3a7b8", word: "Films." },
  motion: { color: "#d27cf0", word: "Titles." },
  cad: { color: "#8eabc8", word: "Plans." },
  scene: { color: "#e3a46b", word: "Scenes." },
};
const RELATED = 4;
const OG_SIZE = [1200, 630];

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// The `steps:` section exactly as showcase.yaml has it (comments and compact flow style kept);
// re-serialised when the file writes it some other way.
function stepsSource(sample) {
  const lines = sample.source.split("\n");
  const start = lines.findIndex((line) => /^steps:\s*(#.*)?$/.test(line));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === "" || /^[\s#-]/.test(lines[end]))) end++;
    return lines.slice(start, end).join("\n").trimEnd();
  }
  return YAML.stringify({ steps: sample.steps }, { lineWidth: 0 }).trimEnd();
}

// The checks a build makes: every expected value, the kit's diagnostics, and reopening the saved
// document with its thumbnail compared (the sample page lists the same).
const checkCount = (sample) => (sample.expected ?? []).reduce((n, e) => n + Object.keys(e.values ?? {}).length, 0) + 2;

// A step's parameters as a short hint, e.g. `(heading, body)`.
function hint(step) {
  const keys = Object.keys(step.params ?? {});
  if (!keys.length) return "";
  const text = keys.join(", ");
  return text.length > 26 ? `${text.slice(0, 25)}…` : text;
}

// The sample's trace in .trace/ (tools/trace.mjs), when it was made from the current showcase.yaml
// and has enough to watch: a build that shows in fewer than MIN_REPLAY_BEATS beats offers no replay.
const TRACES = path.join(ROOT, ".trace");
const MIN_REPLAY_BEATS = 3;
function replayOf(sample) {
  const file = path.join(TRACES, sample.kit, sample.slug, "trace.json");
  if (!fs.existsSync(file)) return null;
  try {
    const trace = JSON.parse(fs.readFileSync(file, "utf8"));
    const source = crypto.createHash("sha256").update(sample.source).digest("hex");
    return trace.format === TRACE_FORMAT && trace.source === source && trace.beats.length >= MIN_REPLAY_BEATS ? trace : null;
  } catch {
    return null;
  }
}

// Everything a page needs about one sample.
function view(sample, kit) {
  const ext = extOf(sample.build.document.name);
  const replay = replayOf(sample);
  return {
    id: sample.id,
    kit: sample.kit,
    slug: sample.slug,
    title: sample.title,
    summary: sample.summary,
    description: sample.description ?? "",
    category: sample.category,
    tags: sample.tags,
    features: sample.features,
    featured: Boolean(sample.featured),
    since: sample.since ?? null,
    stats: sample.build.stats,
    ext,
    format: MIME[ext] ?? null,
    documentName: sample.build.document.name,
    documentBytes: sample.build.document.bytes,
    documentUrl: DOCUMENTS ? u.file(sample, sample.build.document.name) : null,
    path: u.sample(sample),
    thumbUrl: u.file(sample, "thumb.png"),
    thumbSize: pngSize(path.join(sample.dir, "thumb.png")),
    previewUrl: sample.preview ? u.file(sample, "preview.webp") : null,
    // A replay when tools/trace.mjs made one from this very showcase.yaml.
    replayUrl: replay ? `${u.file(sample, "replay")}/` : null,
    replayBeats: replay ? replay.beats.length : 0,
    alt: `${sample.title} — ${kit.title} sample rendered by Kition`,
    built: { repo: sample.build.kit.repo, commit: sample.build.kit.commit, commands: sample.build.commands, ms: sample.build.built_ms },
    prelude: sample.prelude ?? null,
    steps: stepsSource(sample),
    expected: sample.expected ?? [],
    diagnostics: sample.diagnostics ?? [],
    commands: sample.build.commands,
    raw: sample,
  };
}

// Per kit, one sample for the page's agent panel: the best one with a replay (featured first, then
// the most beats), else the featured sample with the most commands (the richest build), or the
// kit's busiest sample when none is featured.
function heroOf(own) {
  const best = rankReplays(own, 1)[0]
    ?? pickHero(own.map((s) => ({ s, featured: s.featured, steps: s.raw.steps.length, commands: s.commands, slug: s.slug }))).s;
  return { ...stageEntry(best), calls: best.raw.steps.slice(0, HERO_CALLS).map((step) => [step.command, hint(step)]) };
}
// What a hero stage needs about one sample (the home page adds its first commands).
function stageEntry(s) {
  return {
    title: s.title, path: s.path, thumbUrl: s.thumbUrl, thumbSize: s.thumbSize, alt: s.alt,
    document: s.documentName, commands: s.commands, ms: s.built.ms, replay: s.replayUrl,
  };
}
// The kit page's stage: up to KIT_REEL samples with a replay, best first; without any, the kit's
// hero alone (shown still).
function reelOf(own, hero) {
  const list = rankReplays(own, KIT_REEL);
  return list.length ? list.map(stageEntry) : [(({ calls, ...rest }) => rest)(hero)];
}

// Up to RELATED samples for a sample page: the same category first, then the kit's samples
// sharing the most tags.
function relatedOf(s, own) {
  const others = own.filter((x) => x.id !== s.id);
  const shared = (x) => x.tags.filter((t) => s.tags.includes(t)).length;
  return [...others].sort((a, b) => (b.category === s.category) - (a.category === s.category) || shared(b) - shared(a) || a.slug.localeCompare(b.slug)).slice(0, RELATED);
}

async function main() {
  // The header's GitHub badge: the star count at build time (tools/site/github.mjs).
  const stars = await githubStarsAtBuild();
  const loaded = loadSamples().filter((sample) => sample.build);
  fs.rmSync(OUT, { recursive: true, force: true });

  const kits = Object.entries(KITS)
    .filter(([id]) => loaded.some((sample) => sample.kit === id))
    .sort(([a], [b]) => byKitOrder(a, b))
    .map(([id, kit], index) => ({ id, index, title: kit.title, tagline: kit.tagline, color: LOOK[id]?.color ?? "#8b7cf0", word: LOOK[id]?.word ?? `${kit.title}.`, path: u.kit(id) }));
  const kitById = Object.fromEntries(kits.map((k) => [k.id, k]));
  const samples = loaded
    .sort((a, b) => byKitOrder(a.kit, b.kit) || a.slug.localeCompare(b.slug))
    .map((sample) => view(sample, kitById[sample.kit]));
  for (const kit of kits) {
    const own = samples.filter((s) => s.kit === kit.id);
    const exts = [...new Set(own.map((s) => s.ext))];
    Object.assign(kit, { count: own.length, ext: exts.join("/"), hero: heroOf(own), since: newest(own.map((s) => s.since)) });
    kit.reel = reelOf(own, kit.hero);
  }
  const totals = {
    samples: samples.length,
    kits: kits.length,
    commands: samples.reduce((n, s) => n + s.commands, 0),
    checks: loaded.reduce((n, sample) => n + checkCount(sample), 0),
    animated: samples.filter((s) => s.previewUrl).length,
    replays: samples.filter((s) => s.replayUrl).length,
  };

  // Shared assets: CSS and JS under content-hashed names, the fonts, icons and share images.
  const read = (name) => fs.readFileSync(path.join(SITE, name), "utf8");
  const css = read("site.css");
  const js = read("site.js");
  const assetName = (name, content) => {
    const hashed = hashName(name, content);
    write(path.join(OUT, "assets", hashed), content);
    return u.asset(`assets/${hashed}`);
  };
  const logoSvg = read("logo.svg").trim();
  const assets = {
    css: assetName("site.css", css),
    js: assetName("site.js", js),
    stage: assetName("stage.js", read("stage.js")),
    icon: assetName("icon.svg", logoSvg.replace(/ class="mark"| aria-hidden="true"| focusable="false"/g, "")),
    touchIcon: assetName("icon-180.png", fs.readFileSync(path.join(SITE, "icon-180.png"))),
  };
  for (const font of fs.readdirSync(path.join(SITE, "fonts"))) copy(path.join(SITE, "fonts", font), path.join(OUT, "fonts", font));
  const ogImage = (file, alt) => ({ url: u.abs(assetName(path.basename(file), fs.readFileSync(file))), width: OG_SIZE[0], height: OG_SIZE[1], alt });
  const homeOg = ogImage(path.join(SITE, "og", "og.jpg"), "Kition Showcase: documents built by commands");
  for (const kit of kits) {
    const file = path.join(SITE, "og", `${kit.id}.jpg`);
    kit.og = fs.existsSync(file) ? ogImage(file, `${kit.title} samples in the Kition Showcase`) : homeOg;
  }

  // The samples' own files, next to their pages.
  for (const s of samples) {
    const dir = path.join(OUT, s.kit, s.slug);
    copy(path.join(s.raw.dir, "thumb.png"), path.join(dir, "thumb.png"));
    if (s.previewUrl) copy(path.join(s.raw.dir, "preview.webp"), path.join(dir, "preview.webp"));
    if (DOCUMENTS) copy(path.join(s.raw.dir, s.documentName), path.join(dir, s.documentName));
    if (s.replayUrl) fs.cpSync(path.join(TRACES, s.kit, s.slug), path.join(dir, "replay"), { recursive: true });
  }

  const heroData = {
    prefix: u.prefix,
    kits: kits.map((k) => ({ id: k.id, title: k.title, color: k.color, word: k.word, count: k.count, hero: k.hero })),
  };
  const ctx = { u, assets, logo: logoSvg, kits, kitById, samples, totals, heroData, stars };
  const homeUrl = u.abs(u.home);
  const pages = [];
  const page = (file, html) => { write(path.join(OUT, file), html); pages.push(file); };

  // Home. Old `#/<kit>` and `#/<kit>/<slug>` links move to the pages that replaced them.
  const redirect = `<script>(function(m,k){if(m&&k.indexOf(m[1])>=0)location.replace(${JSON.stringify(u.prefix)}+"/"+m[1]+(m[2]?"/"+m[2]:""))})(location.hash.match(/^#\\/?([a-z]+)(?:\\/([a-z0-9-]+))?\\/?$/),${JSON.stringify(kits.map((k) => k.id))})</script>`;
  const home = { title: homeTitle(totals), description: homeDescription(totals) };
  page("index.html", shell(ctx, {
    ...home, canonical: homeUrl, image: homeOg,
    jsonLd: homeLd({ url: homeUrl, ...home, kits: kits.map((k) => ({ title: k.title, url: u.abs(k.path) })) }),
  }, { page: "home", main: homeMain(ctx), headExtra: redirect, stage: kits.some((k) => k.hero.replay) }));

  // Kits.
  for (const kit of kits) {
    const own = samples.filter((s) => s.kit === kit.id);
    const url = u.abs(kit.path);
    const seo = { title: kitTitle(kit), description: kitDescription(kit) };
    page(`${kit.id}/index.html`, shell(ctx, {
      ...seo, canonical: url, image: kit.og,
      jsonLd: kitLd({ url, ...seo, homeUrl, crumbs: [["Showcase", homeUrl], [kit.title, url]], samples: own.map((s) => ({ title: s.title, url: u.abs(s.path) })) }),
    }, { page: "kit", main: kitMain(ctx, kit), stage: kit.reel.some((h) => h.replay) }));
  }

  // Samples.
  for (const kit of kits) {
    const own = samples.filter((s) => s.kit === kit.id);
    own.forEach((s, at) => {
      const url = u.abs(s.path);
      const image = { url: u.abs(s.thumbUrl), width: s.thumbSize[0], height: s.thumbSize[1], alt: s.alt };
      const seo = { title: sampleTitle(s, kit.title), description: sampleDescription(s) };
      const jsonLd = sampleLd({
        crumbs: [["Showcase", homeUrl], [kit.title, u.abs(kit.path)], [s.title, url]],
        sample: {
          title: s.title, summary: s.summary, tags: s.tags, category: s.category, since: s.since, url, image,
          preview: s.previewUrl && u.abs(s.previewUrl), format: s.format, ext: s.ext, kitTitle: `${kit.title}`, kitUrl: u.abs(kit.path),
          document: s.documentUrl && u.abs(s.documentUrl), documentName: s.documentName,
        },
      });
      const main = sampleMain(ctx, s, { prev: own[(at - 1 + own.length) % own.length], next: own[(at + 1) % own.length], related: relatedOf(s, own) });
      page(`${s.kit}/${s.slug}/index.html`, shell(ctx, { ...seo, canonical: url, image, type: "article", jsonLd }, { page: "sample", main, stage: Boolean(s.replayUrl) }));
    });
  }

  // Not found: no canonical, not indexed.
  write(path.join(OUT, "404.html"), shell(ctx, {
    title: `Page not found | Kition Showcase`, description: "This page is not in the Kition Showcase. Every sample is listed on the showcase's front page.",
    robots: "noindex, follow", image: homeOg,
  }, { page: "404", main: notFoundMain(ctx) }));

  // The sitemap: every page; a kit or the home page dates from its newest sample.
  const entries = [
    { loc: homeUrl, lastmod: newest(kits.map((k) => k.since)) },
    ...kits.map((k) => ({ loc: u.abs(k.path), lastmod: k.since })),
    ...samples.map((s) => ({ loc: u.abs(s.path), lastmod: s.since, images: [{ loc: u.abs(s.thumbUrl), title: s.title }] })),
  ];
  write(path.join(OUT, "sitemap.xml"), sitemap(entries));

  const bytes = fs.statSync(path.join(OUT, "index.html")).size;
  console.log(`site: ${pages.length} pages (${samples.length} samples, ${totals.replays} with a replay, ${kits.length} kits) under ${u.home} in ${path.relative(process.cwd(), OUT) || "."}; home page ${Math.round(bytes / 1024)} KB${DOCUMENTS ? "" : " (no documents)"}`);
}

await main();
