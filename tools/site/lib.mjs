// Pure helpers for the showcase website: URLs under a base path, page titles and descriptions,
// JSON-LD, the sitemap, PNG sizes and hashed asset names. No file system access except `pngSize`.

import crypto from "node:crypto";
import fs from "node:fs";

export const SITE_NAME = "Kition Showcase";
export const LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0";
export const DESCRIPTION_MAX = 155;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const xmlEsc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => (c === "'" ? "&apos;" : ESCAPES[c]));
export const fmt = (n) => Number(n).toLocaleString("en-US");
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
export const pad = (n) => String(n).padStart(2, "0");
export const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// URLs for a site served under `base` (`/showcase` or `/`) at `origin`. Page URLs carry no
// trailing slash (as on the rest of kition.ai); the files behind them are `<path>/index.html`.
// Every link and asset is root-relative, since a page's URL is not a directory.
export function urls({ base = "/showcase", origin = "https://kition.ai" } = {}) {
  const prefix = `/${String(base).split("/").filter(Boolean).join("/")}`.replace(/^\/$/, "");
  const cleanOrigin = String(origin).replace(/\/+$/, "");
  const join = (...parts) => `${prefix}/${parts.flatMap((p) => String(p).split("/")).filter(Boolean).map(encodeURIComponent).join("/")}`;
  const home = prefix || "/";
  return {
    prefix,
    origin: cleanOrigin,
    home,
    kit: (kit) => join(kit),
    sample: (sample) => join(sample.kit, sample.slug),
    file: (sample, name) => join(sample.kit, sample.slug, name),
    asset: (name) => join(name),
    abs: (pathname) => cleanOrigin + pathname,
  };
}

// Shortens text to `max` characters as a sentence: cut at the last clause break that fits and
// close with a full stop, or at a word with an ellipsis when no clause break fits.
export function clip(text, max = DESCRIPTION_MAX) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max - 1);
  let cut = -1;
  for (const sep of [". ", "; ", " — ", ", "]) {
    const at = room.lastIndexOf(sep);
    if (at > cut && at >= max * 0.45) cut = at;
  }
  if (cut > 0) return `${t.slice(0, cut).replace(/[,;:\s—-]+$/, "")}.`;
  const word = room.lastIndexOf(" ");
  return `${t.slice(0, word > 0 ? word : max - 1).replace(/[,;:\s—-]+$/, "")}…`;
}

export const extOf = (name) => `.${String(name).split(".").pop().toLowerCase()}`;

export function sampleTitle(sample, kitTitle) {
  return `${sample.title} — ${kitTitle} sample (${sample.ext}) | ${SITE_NAME}`;
}
export function sampleDescription(sample) {
  return clip(sample.summary);
}

export function kitTitle(kit) {
  return `${kit.title} samples — ${plural(kit.count, `${kit.ext} file`)} built by commands | ${SITE_NAME}`;
}
export function kitDescription(kit) {
  const lead = `${plural(kit.count, `${kit.title} sample`)} built by the kit's own commands.`;
  const both = `${lead} ${kit.tagline}`;
  return both.length <= DESCRIPTION_MAX ? both : clip(`${kit.tagline}`, DESCRIPTION_MAX);
}

export function homeTitle(totals) {
  return `${SITE_NAME} — ${fmt(totals.samples)} sample documents built by AI-callable commands`;
}
export function homeDescription(totals) {
  return clip(`${fmt(totals.samples)} sample documents across ${totals.kits} Kition kits, each built from the commands an AI agent calls and rendered by the kit's own engine.`);
}

// A JSON-LD script element; `<` is escaped so no text can close the element.
export function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

const ORGANIZATION = { "@type": "Organization", name: "Kition", url: "https://kition.ai" };

export function breadcrumbLd(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
  };
}

function itemList(entries) {
  return {
    "@type": "ItemList",
    numberOfItems: entries.length,
    itemListElement: entries.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, url })),
  };
}

export function homeLd({ url, title, description, kits }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${url}#website`, name: SITE_NAME, url, description, publisher: ORGANIZATION, inLanguage: "en" },
      { "@type": "CollectionPage", "@id": `${url}#page`, name: title, url, description, isPartOf: { "@id": `${url}#website` }, inLanguage: "en", mainEntity: itemList(kits.map((k) => [`${k.title} samples`, k.url])) },
    ],
  };
}

export function kitLd({ url, title, description, crumbs, samples, homeUrl }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${url}#page`, name: title, url, description, inLanguage: "en", isPartOf: { "@type": "WebSite", "@id": `${homeUrl}#website`, name: SITE_NAME, url: homeUrl }, mainEntity: itemList(samples.map((s) => [s.title, s.url])) },
      breadcrumbLd(crumbs),
    ],
  };
}

// `sample`: title, summary, tags, since, url, image {url, width, height}, preview (url or null),
// format (MIME type or null), ext, kitTitle, kitUrl, document url (or null).
export function sampleLd({ sample, crumbs }) {
  const work = {
    "@type": "CreativeWork",
    "@id": `${sample.url}#sample`,
    name: sample.title,
    headline: sample.title,
    description: sample.summary,
    url: sample.url,
    image: { "@type": "ImageObject", url: sample.image.url, width: sample.image.width, height: sample.image.height },
    thumbnailUrl: sample.image.url,
    keywords: sample.tags.join(", "),
    genre: sample.category,
    inLanguage: "en",
    isPartOf: { "@type": "CollectionPage", name: `${sample.kitTitle} samples`, url: sample.kitUrl },
    license: LICENSE_URL,
    creator: ORGANIZATION,
    publisher: ORGANIZATION,
  };
  if (sample.format) work.encodingFormat = sample.format;
  work.fileFormat = sample.format ?? sample.ext;
  if (sample.since) work.dateCreated = sample.since;
  if (sample.document) work.associatedMedia = { "@type": "MediaObject", contentUrl: sample.document, encodingFormat: sample.format ?? sample.ext, name: sample.documentName };
  if (sample.preview) work.image = [work.image, { "@type": "ImageObject", url: sample.preview, encodingFormat: "image/webp", description: "Animated preview" }];
  return { "@context": "https://schema.org", "@graph": [breadcrumbLd(crumbs), work] };
}

// One <url> of the sitemap; `images` are absolute URLs with a title.
export function sitemapEntry({ loc, lastmod, images = [] }) {
  const img = images.map((i) => `    <image:image><image:loc>${xmlEsc(i.loc)}</image:loc>${i.title ? `<image:title>${xmlEsc(i.title)}</image:title>` : ""}</image:image>\n`).join("");
  return `  <url>\n    <loc>${xmlEsc(loc)}</loc>\n${lastmod ? `    <lastmod>${xmlEsc(lastmod)}</lastmod>\n` : ""}${img}  </url>\n`;
}
export function sitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.map(sitemapEntry).join("")}</urlset>\n`;
}

// A kit's hero sample (the home page's agent panel and its replay): the featured sample with the
// most commands (the richest build), or the kit's busiest sample when none is featured. Items:
// { featured, steps (how many), commands, slug }.
export const HERO_CALLS = 6;
export function pickHero(own) {
  const pool = own.filter((s) => s.featured && s.steps >= HERO_CALLS);
  const from = pool.length ? pool : own;
  return [...from].sort((a, b) => b.commands - a.commands || a.slug.localeCompare(b.slug))[0];
}

// The newest of some ISO dates (YYYY-MM-DD), or undefined.
export const newest = (dates) => dates.filter(Boolean).sort().at(-1);

// Width and height from a PNG's IHDR chunk.
export function pngSize(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    if (head.readUInt32BE(12) !== 0x49484452) throw new Error(`${file}: not a PNG`);
    return [head.readUInt32BE(16), head.readUInt32BE(20)];
  } finally {
    fs.closeSync(fd);
  }
}

export const hashName = (name, content) => {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
};

// MIME types of the documents, where one is registered.
export const MIME = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".psd": "image/vnd.adobe.photoshop",
  ".html": "text/html",
  ".md": "text/markdown",
  ".dxf": "image/vnd.dxf",
};
