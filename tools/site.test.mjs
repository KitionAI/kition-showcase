import assert from "node:assert/strict";
import test from "node:test";

import {
  DESCRIPTION_MAX, clip, esc, hashName, homeDescription, homeLd, homeTitle, jsonLdScript, kitDescription, kitLd, kitTitle,
  newest, sampleDescription, sampleLd, sampleTitle, sitemap, sitemapEntry, urls,
} from "./site/lib.mjs";
import { header } from "./site/pages.mjs";
import { formatStars, GITHUB_STARS_FALLBACK, githubStarsAtBuild } from "./site/github.mjs";

const sample = { kit: "doc", slug: "academic-cv" };

test("urls: under /showcase, no trailing slashes, root-relative", () => {
  for (const base of ["/showcase", "/showcase/", "showcase", "/showcase//"]) {
    const u = urls({ base });
    assert.equal(u.home, "/showcase");
    assert.equal(u.kit("doc"), "/showcase/doc");
    assert.equal(u.sample(sample), "/showcase/doc/academic-cv");
    assert.equal(u.file(sample, "thumb.png"), "/showcase/doc/academic-cv/thumb.png");
    assert.equal(u.asset("assets/site.abc.css"), "/showcase/assets/site.abc.css");
    assert.equal(u.abs(u.sample(sample)), "https://kition.ai/showcase/doc/academic-cv");
  }
});

test("urls: a root base for local preview", () => {
  const u = urls({ base: "/", origin: "http://localhost:4173/" });
  assert.equal(u.home, "/");
  assert.equal(u.prefix, "");
  assert.equal(u.kit("doc"), "/doc");
  assert.equal(u.file(sample, "thumb.png"), "/doc/academic-cv/thumb.png");
  assert.equal(u.abs(u.home), "http://localhost:4173/");
});

test("urls: path segments are encoded", () => {
  const u = urls();
  assert.equal(u.file(sample, "a b#.docx"), "/showcase/doc/academic-cv/a%20b%23.docx");
});

test("clip: short text unchanged, long text ends as a sentence within the limit", () => {
  assert.equal(clip("A short summary."), "A short summary.");
  const long = "A printable algebra worksheet — name and date lines, a shaded formula box with the quadratic formula, and eight numbered problems in two columns with inline equations and room to work.";
  const out = clip(long);
  assert.ok(out.length <= DESCRIPTION_MAX, out);
  assert.match(out, /\.$/);
  assert.ok(long.startsWith(out.slice(0, -1)));
  const words = clip("word ".repeat(80));
  assert.ok(words.length <= DESCRIPTION_MAX);
  assert.match(words, /…$/);
});

test("titles and descriptions", () => {
  const s = { title: "Academic CV", ext: ".docx", summary: "A two-page academic CV." };
  assert.equal(sampleTitle(s, "Doc"), "Academic CV — Doc sample (.docx) | Kition Showcase");
  assert.equal(sampleDescription(s), "A two-page academic CV.");
  const kit = { title: "Doc", count: 36, ext: ".docx", tagline: "Word documents: text, styles, tables. Saved as .docx." };
  assert.equal(kitTitle(kit), "Doc samples — 36 .docx files built by commands | Kition Showcase");
  assert.ok(kitDescription(kit).startsWith("36 Doc samples built by the kit's own commands."));
  const longKit = { ...kit, tagline: "x ".repeat(200) };
  assert.ok(kitDescription(longKit).length <= DESCRIPTION_MAX);
  const totals = { samples: 1364, kits: 16 };
  assert.equal(homeTitle(totals), "Kition Showcase — 1,364 sample documents built by AI-callable commands");
  assert.ok(homeDescription(totals).length <= DESCRIPTION_MAX);
});

test("esc: HTML-escapes text and attributes", () => {
  assert.equal(esc(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  assert.equal(esc(null), "");
});

test("sitemap entries: absolute loc, lastmod, images, XML-escaped", () => {
  const entry = sitemapEntry({ loc: "https://kition.ai/showcase/doc/a", lastmod: "2026-11-09", images: [{ loc: "https://kition.ai/showcase/doc/a/thumb.png", title: "Fish & Chips" }] });
  assert.match(entry, /<loc>https:\/\/kition\.ai\/showcase\/doc\/a<\/loc>/);
  assert.match(entry, /<lastmod>2026-11-09<\/lastmod>/);
  assert.match(entry, /<image:loc>https:\/\/kition\.ai\/showcase\/doc\/a\/thumb\.png<\/image:loc>/);
  assert.match(entry, /<image:title>Fish &amp; Chips<\/image:title>/);
  assert.doesNotMatch(sitemapEntry({ loc: "https://kition.ai/showcase" }), /lastmod|image/);
  const xml = sitemap([{ loc: "https://kition.ai/showcase" }]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9" xmlns:image=/);
  assert.match(xml, /<\/urlset>\n$/);
  assert.equal(newest(["2026-11-01", null, "2026-11-09", "2025-01-01"]), "2026-11-09");
});

// Parses the JSON-LD back out of its script element.
const parseLd = (data) => {
  const html = jsonLdScript(data);
  const m = html.match(/^<script type="application\/ld\+json">([\s\S]*)<\/script>$/);
  assert.ok(m);
  assert.doesNotMatch(m[1], /<\//);
  return JSON.parse(m[1]);
};

test("JSON-LD: sample page", () => {
  const ld = parseLd(sampleLd({
    crumbs: [["Showcase", "https://kition.ai/showcase"], ["Film", "https://kition.ai/showcase/film"], ["Aurora </script>", "https://kition.ai/showcase/film/aurora"]],
    sample: {
      title: "Aurora </script>", summary: "An opening title.", tags: ["titles", "keyframes"], category: "Titles", since: "2026-11-09",
      url: "https://kition.ai/showcase/film/aurora", image: { url: "https://kition.ai/showcase/film/aurora/thumb.png", width: 640, height: 360 },
      preview: "https://kition.ai/showcase/film/aurora/preview.webp", format: null, ext: ".kfilm", kitTitle: "Film", kitUrl: "https://kition.ai/showcase/film",
      document: "https://kition.ai/showcase/film/aurora/aurora.kfilm", documentName: "aurora.kfilm",
    },
  }));
  assert.equal(ld["@context"], "https://schema.org");
  const [crumbs, work] = ld["@graph"];
  assert.equal(crumbs["@type"], "BreadcrumbList");
  assert.deepEqual(crumbs.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(work["@type"], "CreativeWork");
  assert.equal(work.name, "Aurora </script>");
  assert.equal(work.keywords, "titles, keyframes");
  assert.equal(work.dateCreated, "2026-11-09");
  assert.equal(work.fileFormat, ".kfilm");
  assert.equal(work.encodingFormat, undefined);
  assert.equal(work.license, "https://www.apache.org/licenses/LICENSE-2.0");
  assert.equal(work.creator.name, "Kition");
  assert.equal(work.isPartOf.url, "https://kition.ai/showcase/film");
  assert.ok(Array.isArray(work.image) && work.image[1].url.endsWith("preview.webp"));
});

test("JSON-LD: home and kit pages", () => {
  const home = parseLd(homeLd({ url: "https://kition.ai/showcase", title: "T", description: "D", kits: [{ title: "Doc", url: "https://kition.ai/showcase/doc" }] }));
  const types = home["@graph"].map((n) => n["@type"]);
  assert.deepEqual(types, ["WebSite", "CollectionPage"]);
  assert.equal(home["@graph"][1].mainEntity.itemListElement[0].url, "https://kition.ai/showcase/doc");
  const kit = parseLd(kitLd({ url: "https://kition.ai/showcase/doc", title: "T", description: "D", homeUrl: "https://kition.ai/showcase", crumbs: [["Showcase", "https://kition.ai/showcase"], ["Doc", "https://kition.ai/showcase/doc"]], samples: [{ title: "A", url: "https://kition.ai/showcase/doc/a" }] }));
  assert.deepEqual(kit["@graph"].map((n) => n["@type"]), ["CollectionPage", "BreadcrumbList"]);
  assert.equal(kit["@graph"][0].mainEntity.numberOfItems, 1);
});

test("hashName: content-hashed file names", () => {
  assert.match(hashName("site.css", "a"), /^site\.[0-9a-f]{10}\.css$/);
  assert.notEqual(hashName("site.css", "a"), hashName("site.css", "b"));
});

test("header: kition.ai's nav with Showcase lit on every page", () => {
  const ctx = { u: urls({ base: "/showcase" }), logo: "<svg class=\"mark\"></svg>" };
  const nav = (html) => [...html.match(/<nav class="hd-nav"[^]*?<\/nav>/)[0].matchAll(/<a class="([^"]+)" href="([^"]+)"([^>]*)>([^<]+)</g)];
  const home = nav(header(ctx, "home"));
  assert.deepEqual(home.map((m) => m[4]), ["Kits", "Showcase", "Kition One", "Developers", "KHP", "Pricing", "Universe"]);
  assert.deepEqual(home[1].slice(1, 4), ["hd-link on", "/showcase", ` aria-current="page"`]);
  for (const page of ["kit", "sample", "404"]) {
    const item = nav(header(ctx, page))[1];
    assert.equal(item[1], "hd-link on");
    assert.equal(item[3], "");
  }
  assert.equal(home.filter((m) => m[1].includes(" on")).length, 1);
  const html = header(ctx, "kit");
  assert.match(html, /aria-controls="mobile-menu"/);
  assert.match(html, /<a class="hd-mlink on" href="\/showcase">Showcase<\/a>/);
  assert.equal((html.match(/data-account>Sign in</g) || []).length, 2);
});

test("header: the GitHub badge before the account link, and its menu row", () => {
  const ctx = { u: urls({ base: "/showcase" }), logo: "<svg class=\"mark\"></svg>", stars: 12345 };
  const html = header(ctx, "home");
  const acts = html.match(/<div class="hd-acts">[^]*?<\/div>/)[0];
  const badge = acts.match(/<a class="hd-gh" ([^>]+)>[^]*?<\/a>/);
  assert.ok(badge, "badge in the bar");
  assert.match(badge[1], /href="https:\/\/github\.com\/KitionAI\/kition" target="_blank" rel="noopener" aria-label="Kition on GitHub, 12,345 stars" data-stars-link/);
  assert.match(badge[0], /<span class="hd-gh-n" data-stars>12\.3k<\/span>/);
  assert.ok(acts.indexOf("hd-gh") < acts.indexOf("hd-acct"), "badge before the account link");
  const menu = html.match(/<div class="kc hd-menu-in">[^]*$/)[0];
  assert.match(menu, /data-account>Sign in<\/a>\s*<a class="hd-mgh" href="https:\/\/github\.com\/KitionAI\/kition"[^>]*>[^]*<span>GitHub<\/span>[^]*data-stars>12\.3k</);
  assert.ok(!/api\.github\.com/.test(html));
  // Without a count from the build, the fallback.
  assert.match(header({ ...ctx, stars: undefined }, "home"), new RegExp(`data-stars>${GITHUB_STARS_FALLBACK}<`));
});

test("github: counts as GitHub prints them", () => {
  assert.deepEqual([0, 674, 999, 1000, 1049, 1234, 1250, 9999, 12345, 999_949, 999_950, 1_500_000].map(formatStars),
    ["0", "674", "999", "1k", "1k", "1.2k", "1.3k", "10k", "12.3k", "999.9k", "1M", "1.5M"]);
});

test("github: the build's count, the fallback when GitHub doesn't answer", async () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const answer = (status, body) => async () => new Response(JSON.stringify(body), { status });
    assert.equal(await githubStarsAtBuild({ env: {}, fetch: answer(200, { stargazers_count: 812 }) }), 812);
    assert.equal(await githubStarsAtBuild({ env: {}, fetch: answer(403, { message: "rate limited" }) }), GITHUB_STARS_FALLBACK);
    assert.equal(await githubStarsAtBuild({ env: {}, fetch: answer(200, {}) }), GITHUB_STARS_FALLBACK);
    assert.equal(await githubStarsAtBuild({ env: {}, fetch: async () => { throw new TypeError("offline"); } }), GITHUB_STARS_FALLBACK);
    assert.equal(await githubStarsAtBuild({ env: { KITION_GITHUB_STARS: "900" }, fetch: () => assert.fail("no request when pinned") }), 900);
    // A hanging GitHub gives up at the timeout (the timeout's timer is unref'd: hold the loop open).
    const keepAlive = setTimeout(() => {}, 5000);
    const hang = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    assert.equal(await githubStarsAtBuild({ env: {}, fetch: hang, timeoutMs: 50 }), GITHUB_STARS_FALLBACK);
    clearTimeout(keepAlive);
  } finally {
    console.warn = quiet;
  }
});
