// The showcase's pages as HTML strings: the shared shell (head, header, footer) and the home, kit,
// sample and not-found pages. Every page is complete without JavaScript; site.js only enhances.
// All sample text goes through `esc`; every URL comes from `u` (lib.mjs `urls`).

import { esc, fmt, jsonLdScript, kb, pad, plural, SITE_NAME } from "./lib.mjs";
import { formatStars, GITHUB_STARS_FALLBACK, GITHUB_STARS_URL, starsLabel } from "./github.mjs";
import { stepLines } from "../trace-core.mjs";

const GITHUB = "https://github.com/KitionAI/kition-showcase";
// Where the replay effect setting is kept (site.js reads the same key).
export const FX_KEY = "kition:stage-skin";

// ---------- Shell ----------

// Runs before the first paint: `js` turns on the enhanced styles, `filtered` (with `search`) hides
// the hero when the page opens on a shared search. `data-fx` is the replay effect (site.js FX): the
// visitor's choice, else off with reduced motion.
const bootScript = (search) => `<script>(function(d){d.classList.add("js");${search ? `if(/[?&](q|tag|cat)=/.test(location.search))d.classList.add("filtered");` : ""}var f;try{f=localStorage.getItem("${FX_KEY}")}catch(e){}if(!/^(cursors|spider|squid|off)$/.test(f||""))f=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches?"off":"cursors";d.setAttribute("data-fx",f)})(document.documentElement)</script>`;

// `seo`: title, description, canonical (absolute), image {url, width, height, alt}, type, robots,
// jsonLd. `ctx`: u, assets {css, js, logo, icon}, logo (inline svg), kitIds.
export function shell(ctx, seo, { page, main, headExtra = "", stage = false }) {
  const { u, assets } = ctx;
  const og = seo.image;
  const meta = [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}">`,
    seo.canonical ? `<link rel="canonical" href="${esc(seo.canonical)}">` : "",
    seo.robots ? `<meta name="robots" content="${esc(seo.robots)}">` : "",
    `<meta property="og:type" content="${esc(seo.type ?? "website")}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:title" content="${esc(seo.title)}">`,
    `<meta property="og:description" content="${esc(seo.description)}">`,
    seo.canonical ? `<meta property="og:url" content="${esc(seo.canonical)}">` : "",
    og ? `<meta property="og:image" content="${esc(og.url)}">\n<meta property="og:image:type" content="${/\.jpe?g$/.test(og.url) ? "image/jpeg" : "image/png"}">\n<meta property="og:image:width" content="${og.width}">\n<meta property="og:image:height" content="${og.height}">\n<meta property="og:image:alt" content="${esc(og.alt)}">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(seo.title)}">`,
    `<meta name="twitter:description" content="${esc(seo.description)}">`,
    og ? `<meta name="twitter:image" content="${esc(og.url)}">\n<meta name="twitter:image:alt" content="${esc(og.alt)}">` : "",
  ].filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${bootScript(true)}${headExtra}
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#07070c">
${meta}
<link rel="icon" href="${assets.icon}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${assets.touchIcon}">
<link rel="preload" href="${u.asset("fonts/archivo-latin-wdth-normal.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${u.asset("fonts/inter-tight-latin-wght-normal.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
${seo.jsonLd ? jsonLdScript(seo.jsonLd) : ""}
</head>
<body data-page="${page}" data-home="${esc(u.home)}"${stage && assets.stage ? ` data-stage="${esc(assets.stage)}" data-colors="${esc(ctx.kits.map((k) => k.color).join(","))}"` : ""}>
<a class="skip" href="#main">Skip to the content</a>
${header(ctx, page)}
<main id="main" tabindex="-1">
${main}
</main>
${footer(ctx)}
</body>
</html>
`;
}

// kition.ai's own header (portal app/components/marketing/Header.tsx, CHROME.ai in
// app/data/site-nav.ts), so a visitor moving between kition.ai and the showcase sees the same one.
// site.js fills in the account label, the platform's download label and a newer star count, and
// opens the mobile menu.
// `null` is the showcase's own item: its home under the build's base, lit on every showcase page.
export const SITE_NAV = [
  ["Kits", "https://kition.ai/kits"],
  ["Showcase", null],
  ["Kition One", "https://one.kition.ai/"],
  ["Developers", "https://developer.kition.ai/"],
  ["KHP", "https://kition.ai/khp"],
  ["Pricing", "https://kition.ai/pricing"],
  ["Universe", "https://universe.kition.ai/"],
];
const ICON = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`;

// The GitHub badge's glyphs, as the portal draws them (app/components/GithubMark.tsx and the star in
// app/components/marketing/GithubStars.tsx).
const GITHUB_MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.5 4.5 0 0 0 -1 -3.5c3 0 6 -2 6 -5.5c0 -1.5 -0.5 -2.5 -1 -3.5c0.5 -1 0.5 -2.5 0 -3.5c0 0 -1 0 -3 1.5c-2.5 -0.5 -5.5 -0.5 -8 0c-2 -1.5 -3 -1.5 -3 -1.5c-0.5 1 -0.5 2.5 0 3.5c-0.5 1 -1 2 -1 3.5c0 3.5 3 5.5 6 5.5c-0.5 0.5 -1 1.5 -1 3.5v4"/><path d="M9 18c-4.5 2 -5 -2 -7 -2"/></svg>`;
const STAR = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M12 3L14.5 9.5H21L15.5 13.5L17.5 20L12 16.5L6.5 20L8.5 13.5L3 9.5H9.5z"/></svg>`;

// The badge in the bar (from 640px) and its row in the mobile menu (under 640px). `data-stars`
// marks what site.js updates with a newer count.
function githubBadge(stars) {
  const attrs = `href="${GITHUB_STARS_URL}" target="_blank" rel="noopener" aria-label="${esc(starsLabel(stars))}" data-stars-link`;
  return {
    bar: `<a class="hd-gh" ${attrs}>${GITHUB_MARK}<span class="hd-gh-c">${STAR}<span class="hd-gh-n" data-stars>${formatStars(stars)}</span></span></a>`,
    menu: `<a class="hd-mgh" ${attrs}>${GITHUB_MARK}<span>GitHub</span><span class="hd-gh-c">${STAR}<span data-stars>${formatStars(stars)}</span></span></a>`,
  };
}

export function header(ctx, page) {
  const { logo, u } = ctx;
  const gh = githubBadge(ctx.stars ?? GITHUB_STARS_FALLBACK);
  const links = (cls) => SITE_NAV.map(([label, href]) => href
    ? `<a class="${cls}" href="${href}">${label}</a>`
    : `<a class="${cls} on" href="${esc(u.home)}"${page === "home" ? ` aria-current="page"` : ""}>${label}</a>`).join("");
  return `<header class="top" id="top">
  <div class="kc top-in">
    <a class="hd-brand" href="https://kition.ai/" aria-label="Kition">${logo}<span>Kition</span></a>
    <nav class="hd-nav" aria-label="primary">${links("hd-link")}</nav>
    <div class="hd-acts">
      ${gh.bar}
      <a class="hd-link hd-acct" href="https://kition.ai/app" data-account>Sign in</a>
      <a class="btn-download" href="https://kition.ai/download" id="get"><span id="get-label">Download free</span><span class="arr" aria-hidden="true">&darr;</span></a>
      <button type="button" class="hd-burger" id="burger" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><span class="i-open">${ICON(["M4 5h16", "M4 12h16", "M4 19h16"])}</span><span class="i-close">${ICON(["M6 6l12 12", "M18 6L6 18"])}</span></button>
    </div>
  </div>
  <div class="hd-menu" id="mobile-menu" hidden>
    <div class="kc hd-menu-in">
      <nav class="hd-menu-nav" aria-label="mobile">${links("hd-mlink")}</nav>
      <a class="hd-macct" href="https://kition.ai/app" data-account>Sign in</a>
      ${gh.menu}
    </div>
  </div>
</header>`;
}

// The search over the listed cards, in the filter bar of the home and kit pages.
function searchForm(ctx, action) {
  return `<form class="search" role="search" action="${esc(action)}" method="get">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <label class="sr" for="q">Search samples</label>
      <input id="q" name="q" type="search" placeholder="Search ${fmt(ctx.totals.samples)} samples" autocomplete="off" spellcheck="false">
      <kbd aria-hidden="true">/</kbd>
    </form>`;
}

function footer(ctx) {
  const { u, logo } = ctx;
  return `<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <a class="brand" href="https://kition.ai/">${logo}<b>Kition</b></a>
      <p>The Kition Showcase: sample documents for every kit, built from the kit's own engine commands and rendered by its own engine. Every sample doubles as a regression test.</p>
    </div>
    <nav aria-label="Footer">
      <a href="${esc(u.home)}">Showcase</a>
      <a href="https://kition.ai/">kition.ai</a>
      <a href="https://developer.kition.ai">Developer docs</a>
      <a href="${GITHUB}" rel="noopener">GitHub</a>
      <a href="${GITHUB}/blob/main/CONTRIBUTING.md" rel="noopener">Contributing</a>
      <a href="${GITHUB}/blob/main/LICENSE" rel="noopener">Apache-2.0 licence</a>
    </nav>
  </div>
  <div class="wrap foot-low">
    <span>Samples and code under the Apache License 2.0. Fonts: Archivo, Inter Tight and JetBrains Mono, SIL Open Font License 1.1.</span>
    <span class="label">Built by the kits</span>
  </div>
</footer>`;
}

// ---------- Shared parts ----------

const kitStyle = (kit) => `--c:${kit.color}`;

export function crumbs(items) {
  return `<nav class="crumbs label" aria-label="Breadcrumb"><ol>${items.map(([name, href], i) =>
    `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(name)}</span>` : `<a href="${esc(href)}">${esc(name)}</a>`}</li>`).join("")}</ol></nav>`;
}

// One sample card. `load`: "eager", "high" (eager, fetchpriority=high) or "lazy".
export function card(ctx, s, load = "lazy") {
  const kit = ctx.kitById[s.kit];
  const [w, h] = s.thumbSize;
  const attrs = [
    `class="card"`,
    `style="${kitStyle(kit)}"`,
    `data-cat="${esc(s.category)}"`,
    `data-tags="${esc(s.tags.join("|"))}"`,
    `data-s="${esc([kit.title, ...s.features].join(" "))}"`,
  ];
  if (s.previewUrl) attrs.push(`data-preview="${esc(s.previewUrl)}"`, `data-thumb="${esc(s.thumbUrl)}"`);
  const imgLoad = load === "lazy" ? `loading="lazy"` : load === "high" ? `fetchpriority="high"` : "";
  return `<article ${attrs.join(" ")}>`
    + `<a class="stage" href="${esc(s.path)}" tabindex="-1" aria-hidden="true">`
    + (s.previewUrl ? `<span class="badge">animated</span>` : "")
    + (s.replayUrl ? `<span class="badge rp" title="Has a replay of its build">replay</span>` : "")
    + `<span class="fit"><img src="${esc(s.thumbUrl)}" width="${w}" height="${h}" style="--r:${(w / h).toFixed(4)}" ${imgLoad} decoding="async" alt="${esc(s.alt)}"></span></a>`
    + `<div class="card-body"><div class="meta"><span class="kchip">${esc(s.kit)}</span><span class="cat">${esc(s.category)}</span></div>`
    + `<h3><a href="${esc(s.path)}">${esc(s.title)}</a></h3>`
    + `<p>${esc(s.summary)}</p>`
    + `<div class="st" title="${esc(s.stats)}">${esc(s.stats)}</div>`
    + `<div class="tags">${s.tags.map((t) => `<button type="button" class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>`
    + `</div></article>`;
}

// The row of kit cards; `current` is the kit whose page this is.
function kitRow(ctx, current, allCurrent = !current) {
  const { kits, u } = ctx;
  const step = Math.min(0.05, 0.8 / kits.length);
  return `<section class="kits wrap" aria-labelledby="kits-h"><h2 class="sr" id="kits-h">Kits</h2>
  <div class="blocks${current ? " picked" : ""}" id="blocks" style="--cols:${kits.length}">`
    + kits.map((k, i) => `<div class="blk" style="--d:${(0.35 + i * step).toFixed(3)}s"><a class="kcard" data-kit="${k.id}" href="${esc(k.path)}" style="${kitStyle(k)}" aria-label="${esc(k.title)}: ${plural(k.count, "sample")}"${current === k.id ? ` aria-current="page"` : ""}>`
      + `<span class="top2"><span>${pad(i + 1)}</span><span>${k.count}</span></span><span class="nm">${esc(k.id)}</span></a></div>`).join("")
    + `</div>
  <div class="blocks-cap label"><a class="all" id="all" href="${esc(u.home)}"${allCurrent ? ` aria-current="page"` : ""}>All kits &middot; ${fmt(ctx.totals.samples)}</a><span class="sync" id="sync" aria-hidden="true"></span></div>
</section>`;
}

// ---------- Home ----------

function heroHtml(ctx) {
  const { kits, totals } = ctx;
  const first = kits[0];
  const h = first.hero;
  let i = 0;
  const chars = ["built", "by", "commands."].map((word, w) => `<span class="wd">${[...word].map((ch) =>
    `<span class="ch${w === 2 && ch !== "." ? " em" : ""}" style="--i:${i++}">${esc(ch)}</span>`).join("")}</span>`).join(" ");
  return `<section class="hero wrap" id="hero" aria-labelledby="hero-title"><div class="hero-in"><div class="hero-copy">`
    + `<p class="hud label"><span class="ok">Showcase</span><span>${fmt(totals.samples)} samples</span><span>${totals.kits} kits</span><span>${fmt(totals.commands)} commands</span></p>`
    + `<h1 class="headline" id="hero-title"><span class="sr">Kition Showcase: ${fmt(totals.samples)} sample documents built by the kits' own commands.</span>`
    + `<span class="row1" aria-hidden="true"><span class="slot" id="slot" style="${kitStyle(first)}"><span class="reel" id="reel"><span data-first="">${esc(first.word)}</span></span></span>`
    + `<span class="tick" id="tick" style="${kitStyle(first)}"><i></i><b id="tick-n">01 / ${pad(kits.length)}</b><span id="tick-kit">${esc(first.id)} kit</span><span id="tick-count">${esc(plural(first.count, "sample"))}<span class="tcur"></span></span></span></span>`
    + `<span class="row2" aria-hidden="true">${chars}</span></h1>`
    + `<p class="lede">Every sample is a list of the kit's own engine commands, <b>the same commands an AI agent calls</b>. The kit runs them, then saves and renders the document with its own engine, so you see exactly what Kition draws. Every sample doubles as a regression test.</p>`
    + stripHtml(first, h)
    + `</div>`
    + stageHtml(first, h)
    + `</div></section>`;
}

// A sample's first commands as the hero shows them before (or without) its replay.
const callsHtml = (h) => h.calls.map(([cmd, hint]) => `<li class="call"><b></b><code>${esc(cmd)}${hint ? `<i>(${esc(hint)})</i>` : ""}</code></li>`).join("");
const restLabel = (h) => {
  const rest = h.commands - h.calls.length;
  return rest > 0 ? `+ ${plural(rest, "more command")} · ${fmt(h.ms)} ms` : `${fmt(h.ms)} ms`;
};
// The commands strip (home and kit pages): sample `h`'s first commands; while its replay plays,
// site.js shows the commands of the beat on the stage instead.
function stripHtml(kit, h) {
  return `<div class="strip" id="strip" style="${kitStyle(kit)}" role="group" aria-label="The sample's commands"><span class="strip-h label"><span id="run-label">agent &middot; <b>${esc(kit.id)}</b> kit</span><span class="strip-n" id="strip-n">${restLabel(h)}</span></span>`
    + `<ol class="calls" id="calls">${callsHtml(h)}</ol></div>`;
}

// The hero's stage (home and kit pages): sample `h` of kit `kit`, its finished picture, which
// site.js swaps for its replay (stage.js) when the effect is on. `of`: on a kit page, how many
// samples the stage takes turns with (shown as "01 / 05").
export function stageHtml(kit, h, of = 0) {
  const [w, hh] = h.thumbSize;
  return `<div class="hstage" id="run" style="${kitStyle(kit)}">`
    + `<div class="hs-top" id="hs-top"><a class="hs-k" id="shot-link" href="${esc(h.path)}">${of > 1 ? `<span class="hs-n label" id="hs-n">01 / ${pad(of)}</span>` : ""}<b id="shot-title">${esc(h.title)}</b><span class="hs-open">Open &rarr;</span></a></div>`
    + `<div class="hs-panel" id="run-panel"><a class="hs-box" id="shot" href="${esc(h.path)}" aria-label="Open ${esc(h.title)}"><img id="shot-img" src="${esc(h.thumbUrl)}" width="${w}" height="${hh}" style="--r:${(w / hh).toFixed(4)}" fetchpriority="high" decoding="async" alt="${esc(h.alt)}"></a>`
    + `<div class="hs-hud" id="hs-hud"></div></div>`
    + `<div class="hs-cap" id="hs-cap"></div>`
    + `<p class="hs-foot label"><span class="saved" id="run-saved">saved &rarr; ${esc(h.document)} ✓</span><span id="run-stat">${plural(h.commands, "command")} &middot; ${fmt(h.ms)} ms</span></p>`
    + `</div>`;
}

// The data site.js reads for the hero, in a JSON script element.
const heroDataScript = (data) => `<script type="application/json" id="hero-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

function statsHtml(totals) {
  const rows = [["Samples", totals.samples], ["Kits", totals.kits], ["Commands run", totals.commands], ["Checks per build", totals.checks], ["Animated", totals.animated]];
  return `<section class="wrap" id="stats-wrap" aria-labelledby="stats-h"><h2 class="sr" id="stats-h">In numbers</h2><dl class="stats">${rows.map(([label, n]) =>
    `<div class="stat"><dt class="label">${esc(label)}</dt><dd><b data-n="${n}">${fmt(n)}</b></dd></div>`).join("")}</dl></section>`;
}

const EAGER_CARDS = 4;

export function homeMain(ctx) {
  const { samples, totals } = ctx;
  return `<div id="list">
${heroHtml(ctx)}
${kitRow(ctx, null)}
${statsHtml(totals)}
<div class="bar" id="bar"><div class="wrap bar-in" id="bar-in"><span class="bar-kit"><i class="all-sq"></i><b>All kits</b></span><span class="query mute" id="bar-q">Every sample in every kit. Pick a kit above to see its own page.</span>${searchForm(ctx, ctx.u.home)}<span class="count label"><b id="count">${totals.samples}</b> samples</span></div></div>
<section class="wrap" id="samples" aria-labelledby="samples-h"><h2 class="sr" id="samples-h">All samples</h2>
<div class="grid" id="grid">${samples.map((s, i) => card(ctx, s, i < EAGER_CARDS ? "eager" : "lazy")).join("")}</div>
<div id="empty" hidden></div>
</section>
</div>
${heroDataScript(ctx.heroData)}`;
}

// ---------- Kit ----------

export const catId = (category) => `c-${String(category).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export function kitMain(ctx, kit) {
  const own = ctx.samples.filter((s) => s.kit === kit.id);
  const reel = kit.reel?.length ? kit.reel : [kit.hero];
  const cats = [...new Set(own.map((s) => s.category))].sort();
  const animated = own.filter((s) => s.previewUrl).length;
  let n = 0;
  const sections = cats.map((c) => {
    const list = own.filter((s) => s.category === c);
    return `<section class="cat-sec" id="${catId(c)}" data-cat="${esc(c)}" aria-labelledby="${catId(c)}-h"><h2 class="cat-h label" id="${catId(c)}-h">${esc(c)} <small>${list.length}</small></h2>`
      + `<div class="grid">${list.map((s) => card(ctx, s, n++ < EAGER_CARDS ? "eager" : "lazy")).join("")}</div></section>`;
  }).join("\n");
  return `<div id="list">
<section class="khead wrap" id="khead" style="${kitStyle(kit)}"><div class="khead-in"><div class="khead-copy">
${crumbs([["Showcase", ctx.u.home], [kit.title, null]])}
<p class="label">Kit ${pad(kit.index + 1)} / ${pad(ctx.kits.length)} &middot; ${plural(own.length, "sample")} &middot; ${plural(cats.length, "category", "categories")}${animated ? ` &middot; ${animated} animated` : ""}</p>
<h1 class="d"><i aria-hidden="true"></i>${esc(kit.title)}<span class="sr"> samples</span></h1><p>${esc(kit.tagline)}</p>
</div>
${stageHtml(kit, reel[0], reel.length)}
${stripHtml(kit, reel[0])}
</div></section>
${kitRow(ctx, kit.id)}
<div class="bar" id="bar"><div class="wrap bar-in" id="bar-in"><span class="bar-kit" style="${kitStyle(kit)}"><i></i><b>${esc(kit.title)}</b></span>`
    + `<nav class="chips" aria-label="Categories" style="${kitStyle(kit)}"><a class="chip" href="#samples" data-cat="" aria-current="true">All <small>${own.length}</small></a>`
    + cats.map((c) => `<a class="chip" href="#${catId(c)}" data-cat="${esc(c)}">${esc(c)} <small>${own.filter((s) => s.category === c).length}</small></a>`).join("")
    + `</nav>${searchForm(ctx, kit.path)}<span class="count label"><b id="count">${own.length}</b> samples</span></div></div>
<div class="wrap" id="samples" style="${kitStyle(kit)}">
${sections}
<div id="empty" hidden></div>
</div>
</div>
${heroDataScript({ prefix: ctx.u.prefix, kit: kit.id, color: kit.color, reel })}`;
}

// ---------- Embed ----------

// A kit's stage alone, for a same-origin iframe (kition.ai's home page shows a few of these): the
// kit page's rotation of replays filling the frame, the beat's commands on one line and a thin
// progress line under it. No header, footer or search; a click anywhere opens the kit page in the
// top window. Not indexed (its canonical is the kit page) and not in the sitemap. Without the
// script, with reduced motion or with the effect off, it shows the first sample's picture.
export function embedPage(ctx, kit) {
  const { u, assets } = ctx;
  const reel = kit.reel?.length ? kit.reel : [kit.hero];
  const h = reel[0];
  const [w, hh] = h.thumbSize;
  const stage = reel.some((x) => x.replay) && assets.stage;
  const title = `${kit.title} replays | ${SITE_NAME}`;
  return `<!doctype html>
<html lang="en" class="emb-doc">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${bootScript(false)}
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(u.abs(kit.path))}">
<link rel="icon" href="${assets.icon}" type="image/svg+xml">
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
</head>
<body data-page="embed" data-home="${esc(u.home)}"${stage ? ` data-stage="${esc(assets.stage)}" data-colors="${esc(ctx.kits.map((k) => k.color).join(","))}"` : ""}>
<a class="emb" id="run" href="${esc(kit.path)}" target="_top" style="${kitStyle(kit)}" aria-label="${esc(kit.title)} samples in the Kition Showcase">`
    + `<span class="emb-box" id="shot"><img id="shot-img" src="${esc(h.thumbUrl)}" width="${w}" height="${hh}" style="--r:${(w / hh).toFixed(4)}" fetchpriority="high" decoding="async" alt="${esc(h.alt)}"></span>`
    + `<span class="emb-bar"><ol class="calls" id="calls" aria-hidden="true">${callsHtml(h)}</ol><span class="emb-n label" id="emb-n">${reel.length > 1 ? `01 / ${pad(reel.length)}` : plural(h.commands, "command")}</span><span class="emb-prog" aria-hidden="true"><i id="emb-fill"></i></span></span>`
    + `</a>
${heroDataScript({ prefix: u.prefix, kit: kit.id, color: kit.color, reel })}
</body>
</html>
`;
}

// ---------- Sample ----------

// Light YAML colouring: keys, strings, numbers, booleans, punctuation, comments; commands stand
// out. The output text is always the input text, escaped.
const YAML_TOKEN = /(#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^']|'')*'?)|([{}[\],]|-(?=\s|$)|:(?=\s|$)|[|>][-+]?(?=\s*$))|([^\s{}[\],:#"'](?:[^{}[\],:#\s]|:(?!\s|$)|[ \t]+(?=[^\s{}[\],:#]))*)|(\s+)|([\s\S])/g;
export function yamlHtml(src) {
  const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
  return src.split("\n").map((line) => {
    let out = "";
    let key = null;
    for (const m of line.matchAll(YAML_TOKEN)) {
      const [text, comment, quoted, punct, plain] = m;
      if (comment != null) out += span("c", text);
      else if (punct != null) out += span("p", text);
      else if (quoted != null || plain != null) {
        const rest = line.slice(m.index + text.length);
        if (/^\s*:(\s|$)/.test(rest)) { key = text.replace(/^["']|["']$/g, ""); out += span("k", text); continue; }
        let cls = "s";
        if (plain != null && /^(true|false|null|~)$/.test(text)) cls = "w";
        else if (plain != null && /^[-+]?(\d[\d_]*)?\.?\d+(e[-+]?\d+)?$/i.test(text)) cls = "n";
        if (key === "command" && cls === "s") cls = "cmd";
        out += span(cls, text);
        key = null;
      } else out += esc(text);
    }
    return out;
  }).join("\n");
}

function checksHtml(s) {
  const items = [];
  for (const e of s.expected) {
    for (const [k, v] of Object.entries(e.values || {})) {
      let text = JSON.stringify(v);
      if (text.length > 160) text = `${text.slice(0, 157)}…`;
      items.push(`<li><span><code>${esc(`${e.actual || "inspect"}.${k}`)}</code> = <span class="v">${esc(text)}</span></span></li>`);
    }
  }
  items.push(`<li><span>Diagnostics: ${s.diagnostics.length ? s.diagnostics.map((c) => `<code>${esc(c)}</code>`).join(", ") : "none, the kit's own check finds nothing wrong"}</span></li>`);
  items.push(`<li><span>The saved document opens again, and its thumbnail matches <code>thumb.png</code> within the render tolerance</span></li>`);
  return { count: items.length, html: `<ul class="checks">${items.join("")}</ul>` };
}

export function sampleMain(ctx, s, { prev, next, related }) {
  const { u } = ctx;
  const kit = ctx.kitById[s.kit];
  const [w, h] = s.thumbSize;
  const ext = s.ext.slice(1).toUpperCase();
  const checks = checksHtml(s);
  const lines = s.steps.split("\n").length;
  const spec = `<dl>`
    + `<div><dt class="label">Contents</dt><dd>${esc(s.stats)}</dd></div>`
    + `<div><dt class="label">Features</dt><dd class="pills">${s.features.map((f) => `<span class="pill">${esc(f)}</span>`).join("")}</dd></div>`
    + `<div><dt class="label">Tags</dt><dd class="pills">${s.tags.map((t) => `<a class="pill" href="${esc(u.home)}?tag=${encodeURIComponent(t)}" rel="nofollow" data-tag="${esc(t)}">${esc(t)}</a>`).join("")}</dd></div>`
    + `<div><dt class="label">Built by</dt><dd><code>${esc(s.built.repo)}</code> @ <code>${esc(s.built.commit)}</code><br><b>${plural(s.built.commands, "command")}</b> in ${fmt(s.built.ms)} ms</dd></div>`
    + `<div><dt class="label">Format</dt><dd><b>${esc(ext)}</b> &middot; <code>${esc(s.documentName)}</code> &middot; ${kb(s.documentBytes)}</dd></div>`
    + `</dl>`;
  const download = s.documentUrl
    ? `<a class="btn btn-primary btn-glow dl" href="${esc(s.documentUrl)}" download><span>Download ${esc(ext)}</span><span class="arr" aria-hidden="true">&darr;</span></a><p class="dl-meta">${esc(s.documentName)} &middot; ${kb(s.documentBytes)} &middot; opens in Kition</p>`
    : `<p class="dl-meta">Documents were left out of this build. <a class="em" href="${GITHUB}/tree/main/${esc(s.kit)}/${esc(s.slug)}" rel="noopener">Get it on GitHub</a>.</p>`;
  const navCard = (x, label, cls) => `<a${cls ? ` class="${cls}"` : ""} href="${esc(x.path)}" style="${kitStyle(kit)}" rel="${cls ? "next" : "prev"}"><span class="label">${label}</span><b>${esc(x.title)}</b></a>`;
  return `<article class="wrap detail" id="detail">
${crumbs([["Showcase", u.home], [kit.title, kit.path], [s.title, null]])}
<header class="dhead" style="${kitStyle(kit)}"><div class="meta"><span class="kchip">${esc(s.kit)}</span><span class="cat">${esc(s.category)}</span>${s.featured ? "<span>&middot; featured</span>" : ""}</div>
<h1 class="d" id="dtitle">${esc(s.title)}</h1><p class="sum">${esc(s.summary)}</p></header>
<div class="dgrid">${s.replayUrl ? `<div class="vcol" style="${kitStyle(kit)}"><div class="vbar" id="vbar"></div>` : ""}<div class="view" id="view" style="${kitStyle(kit)}"${s.previewUrl ? ` data-preview="${esc(s.previewUrl)}" data-thumb="${esc(s.thumbUrl)}"` : ""}${s.replayUrl ? ` data-replay="${esc(s.replayUrl)}"` : ""}>`
    + (s.previewUrl ? `<button type="button" class="badge playbtn" id="playbtn" aria-pressed="false">Play preview</button>` : "")
    + `<img src="${esc(s.thumbUrl)}" width="${w}" height="${h}" style="--r:${(w / h).toFixed(4)};--w:${Math.round(Math.max(w, 640) * 1.25)}px" fetchpriority="high" decoding="async" alt="${esc(s.alt)}"></div>${s.replayUrl ? `<div class="vdock" id="vdock"></div></div>` : ""}
<aside class="spec" id="spec" style="${kitStyle(kit)}" aria-label="About this sample">${spec}<div id="dl">${download}</div></aside></div>
${s.description ? `<p class="desc">${esc(s.description)}</p>` : ""}
${s.previewUrl ? `<p class="desc preview-note">Animated sample: <a class="em" href="${esc(s.previewUrl)}">watch the preview</a> (WebP animation).</p>` : ""}
<section class="sec" aria-labelledby="steps-h"><div class="sec-head"><h2 class="d" id="steps-h">Steps</h2><span class="label">${plural(s.built.commands, "command")}${s.prelude ? ` &middot; after the <code>${esc(s.prelude)}</code> prelude` : ""}</span></div>
<div class="code" style="${kitStyle(kit)}"><div class="code-bar"><i></i><i></i><i></i><span class="tab">showcase.yaml</span><span class="lines">${plural(lines, "line")}</span><button type="button" class="copy" id="copy">Copy</button></div>
<pre tabindex="0" aria-label="The sample's steps"${s.replayUrl ? ` data-steps="${esc(JSON.stringify(stepLines(s.steps).map((l) => [l.above, l.last])))}"` : ""}><code>${yamlHtml(s.steps)}</code></pre></div></section>
<section class="sec" aria-labelledby="checks-h"><div class="sec-head"><h2 class="d" id="checks-h">Checks</h2><span class="label">${plural(checks.count, "check")} on every build</span></div>${checks.html}</section>
${related.length ? `<section class="sec" aria-labelledby="rel-h"><div class="sec-head"><h2 class="d" id="rel-h">Related</h2><span class="label">More ${esc(kit.title)} samples</span></div><div class="grid rel">${related.map((x) => card(ctx, x)).join("")}</div></section>` : ""}
<nav class="nav2" aria-label="More ${esc(kit.title)} samples">${navCard(prev, "&larr; Previous", "")}${navCard(next, "Next &rarr;", "nx")}</nav>
</article>`;
}

// ---------- Not found ----------

export function notFoundMain(ctx) {
  const { u } = ctx;
  return `<div class="wrap">
<div class="empty nf"><p class="label">404 &middot; not found</p>
<h1 class="d">Nothing <span class="em">here.</span></h1>
<p>This page is not in the showcase. The sample may have moved; every sample is listed on the showcase's front page, by kit.</p>
<div class="try"><a class="btn btn-primary btn-sm" href="${esc(u.home)}">All ${fmt(ctx.totals.samples)} samples <span class="arr" aria-hidden="true">&rarr;</span></a><a class="btn btn-ghost btn-sm" href="https://kition.ai/">kition.ai</a></div></div>
</div>
${kitRow(ctx, null, false)}`;
}
