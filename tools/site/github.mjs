// The GitHub badge in the header (kition.ai's, portal app/components/marketing/GithubStars.tsx):
// the Kition repository and its star count.
//
// The build asks GitHub once and bakes the count into every page; a build that can't reach GitHub
// bakes GITHUB_STARS_FALLBACK. On kition.ai, site.js then asks the portal's same-origin
// GET /api/public/github for a newer count. Visitors' browsers never call GitHub themselves.

export const GITHUB_STARS_REPO = "KitionAI/kition";
export const GITHUB_STARS_URL = `https://github.com/${GITHUB_STARS_REPO}`;

// The count a build bakes in when GitHub doesn't answer. Keep it near the live count (674 on
// 2026-11-19); the portal's is in kition-console web/portal/app/data/github.ts.
export const GITHUB_STARS_FALLBACK = 674;

// A star count as GitHub prints it: 674, 1k, 1.2k, 12.3k, 1.5M. site.js has a copy.
export function formatStars(n) {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  const short = (value, unit) => `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "")}${unit}`;
  return n < 999_950 ? short(n / 1000, "k") : short(n / 1_000_000, "M");
}

export const starsLabel = (n) => `Kition on GitHub, ${Number(n).toLocaleString("en-US")} stars`;

// The live count, asked of GitHub once per build with a short timeout; the fallback when GitHub
// doesn't answer (offline, rate-limited). KITION_GITHUB_STARS=<n> pins it.
export async function githubStarsAtBuild({ fetch: get = globalThis.fetch, env = process.env, timeoutMs = 4000 } = {}) {
  const pinned = Number(env.KITION_GITHUB_STARS);
  if (env.KITION_GITHUB_STARS && Number.isInteger(pinned) && pinned >= 0) return pinned;
  try {
    const res = await get(`https://api.github.com/repos/${GITHUB_STARS_REPO}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "kition-showcase-build" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const n = (await res.json())?.stargazers_count;
    if (!Number.isInteger(n) || n < 0) throw new Error("no stargazers_count");
    return n;
  } catch (err) {
    console.warn(`github stars: ${err?.message ?? err}; using ${GITHUB_STARS_FALLBACK}`);
    return GITHUB_STARS_FALLBACK;
  }
}
