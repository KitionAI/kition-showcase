// The pure parts of a sample's replay trace (tools/trace.mjs writes the traces): where two renders
// differ, how a build's steps fold into 8–16 beats, what kind of change a beat is, and which line of
// showcase.yaml each step is on (the sample page highlights them). No file system access.

export const TRACE_FORMAT = 1;
export const CELL = 16; // px of the frame: the grid a change is found on
export const MAX_BEATS = 16;
export const MIN_BEATS = 8;
export const MAX_TARGETS = 4;
export const STRUCTURE_COVER = 0.7; // a change over more of the frame than this has no one place

// ---------- Where two frames differ ----------

// Compares two RGBA buffers of the same size on a grid of `cell` px cells. A pixel changed when one
// channel moved by more than `threshold`; a cell changed when at least `minPixels` of its pixels did.
// Each changed cell keeps the bounding box of its changed pixels, so targets hug the change.
export function diffCells(a, b, width, height, { cell = CELL, threshold = 24, minPixels = 3 } = {}) {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const n = cols * rows;
  const count = new Uint32Array(n);
  const x0 = new Int32Array(n).fill(width);
  const y0 = new Int32Array(n).fill(height);
  const x1 = new Int32Array(n).fill(-1);
  const y1 = new Int32Array(n).fill(-1);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(a[i] - b[i]) <= threshold && Math.abs(a[i + 1] - b[i + 1]) <= threshold && Math.abs(a[i + 2] - b[i + 2]) <= threshold && Math.abs(a[i + 3] - b[i + 3]) <= threshold) continue;
      const c = row + Math.floor(x / cell);
      count[c]++;
      if (x < x0[c]) x0[c] = x;
      if (x > x1[c]) x1[c] = x;
      if (y < y0[c]) y0[c] = y;
      if (y > y1[c]) y1[c] = y;
    }
  }
  const on = new Uint8Array(n);
  let changed = 0;
  for (let c = 0; c < n; c++) if (count[c] >= minPixels) { on[c] = 1; changed++; }
  return { cols, rows, cell, width, height, on, changed, cover: n ? changed / n : 0, box: { x0, y0, x1, y1 } };
}

// The changed cells as connected regions (8-neighbours, after growing each cell by `grow` cells so
// the lines of one paragraph join up), largest first, each with the pixel rectangle [x, y, w, h] of
// the changes in it.
export function regions(grid, { grow = 1 } = {}) {
  const { cols, rows, on, box } = grid;
  const grown = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!on[r * cols + c]) continue;
    for (let dr = -grow; dr <= grow; dr++) for (let dc = -grow; dc <= grow; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) grown[rr * cols + cc] = 1;
    }
  }
  const label = new Int32Array(cols * rows).fill(-1);
  const out = [];
  for (let start = 0; start < cols * rows; start++) {
    if (!grown[start] || label[start] >= 0) continue;
    const id = out.length;
    const region = { cells: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const k = stack.pop();
      if (on[k]) {
        region.cells++;
        region.x0 = Math.min(region.x0, box.x0[k]); region.y0 = Math.min(region.y0, box.y0[k]);
        region.x1 = Math.max(region.x1, box.x1[k]); region.y1 = Math.max(region.y1, box.y1[k]);
      }
      const r = Math.floor(k / cols), c = k % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (grown[j] && label[j] < 0) { label[j] = id; stack.push(j); }
      }
    }
    if (region.cells) out.push({ cells: region.cells, rect: [region.x0, region.y0, region.x1 - region.x0 + 1, region.y1 - region.y0 + 1] });
  }
  return out.sort((p, q) => q.cells - p.cells || p.rect[1] - q.rect[1] || p.rect[0] - q.rect[0]);
}

// What a beat touched: `structure` (no single place) when the change covers most of the frame, else
// the largest regions (at most `max`, none under a sixth of the largest).
export function targetsOf(grid, { max = MAX_TARGETS } = {}) {
  if (!grid.changed) return { structure: false, rects: [] };
  if (grid.cover > STRUCTURE_COVER) return { structure: true, rects: [] };
  const found = regions(grid);
  const big = found[0].cells;
  return { structure: false, rects: found.filter((r) => r.cells * 6 >= big).slice(0, max).map((r) => r.rect) };
}

// The bounding box [x, y, w, h] of some rectangles, or null.
export function unionRect(rects) {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r[0])), y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2])), y1 = Math.max(...rects.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

// Intersection over union of two rectangles.
export function iou(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a[2] * a[3] + b[2] * b[3] - w * h);
}

// How much two rectangles overlap: the shared area over the smaller one's (1 = one inside the other).
export function overlap(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(a[2] * a[3], b[2] * b[3]));
}

// ---------- Which prefixes to render ----------

// The prefixes rendered first: every one for a short build, else `samples` + 1 evenly spaced ones.
export function initialPrefixes(total, { all = 40, samples = 32 } = {}) {
  if (total <= all) return Array.from({ length: total + 1 }, (_, i) => i);
  const set = new Set();
  for (let i = 0; i <= samples; i++) set.add(Math.round((i * total) / samples));
  return [...set].sort((a, b) => a - b);
}

// The next prefix to render to refine the plan, or null: the middle of the widest-changing segment
// that spans more than one step. `segments`: [{ from, to, changed }] in order.
export function nextRefinement(segments) {
  let best = null;
  for (const s of segments) {
    if (s.to - s.from < 2 || !s.changed) continue;
    if (!best || s.changed > best.changed || (s.changed === best.changed && s.to - s.from > best.to - best.from)) best = s;
  }
  return best ? Math.floor((best.from + best.to) / 2) : null;
}

// ---------- Beats ----------

// Folds rendered segments into beats. `segments`: consecutive [{ from, to, changed, box }] covering
// 0..total, where `changed` counts changed cells and `box` is their bounding box; `diff(from, to)`
// answers the same for any two rendered prefixes. Steps with no visible change join the next visible
// segment (the last ones join the one before); neighbours over the same place (IoU ≥ 0.9) merge
// while more than `min` remain, then neighbours that overlap most merge until at most `max` remain.
export function planBeats(segments, diff, { max = MAX_BEATS, min = MIN_BEATS } = {}) {
  let list = [];
  let carry = null;
  for (const s of segments) {
    const from = carry ?? s.from;
    if (!s.changed) { carry = from; continue; }
    list.push(carry === null ? { ...s } : { from, to: s.to, ...diff(from, s.to) });
    carry = null;
  }
  if (carry !== null && list.length) {
    const last = list.pop();
    list.push({ from: last.from, to: segments.at(-1).to, ...diff(last.from, segments.at(-1).to) });
  }
  const merge = (i) => {
    const a = list[i], b = list[i + 1];
    list.splice(i, 2, { from: a.from, to: b.to, ...diff(a.from, b.to) });
  };
  const best = (measure) => {
    let at = -1, score = -1;
    for (let i = 0; i + 1 < list.length; i++) {
      const s = measure(list[i].box, list[i + 1].box) - (list[i].changed + list[i + 1].changed) * 1e-7;
      if (s > score) { score = s; at = i; }
    }
    return { at, score };
  };
  // The same place touched twice in a row reads as one beat (a growing table is not the same place).
  while (list.length > min) {
    const { at, score } = best(iou);
    if (at < 0 || score < 0.9) break;
    merge(at);
  }
  while (list.length > max) merge(best(overlap).at);
  return list;
}

// ---------- Kinds and captions ----------

// A command's kind from its whole name (`text.insert`, `styles.modify`): the first rule that matches,
// else `modify`. The rule table (P0; P1 reads a `kind` from each kit's command catalogue instead):
export const KIND_RULES = [
  ["delete", /(delete|remove|clear|erase|trim|crop)/i],
  ["move", /(move|translate|reorder|arrange|align|distribute|nudge|reposition|swap|rotate|flip)/i],
  ["select", /(select|find|inspect|query|locate|seek|playhead|time\.set|view|zoom|scroll|show)/i],
  ["text", /(text|type|write|paragraph|heading|caption|title|label|word|letter|content|markdown)/i],
  ["style", /(style|format|font|colou?r|fill|stroke|border|shad|theme|effect|filter|gradient|opacity|blend|grade|tint|swatch|material|light)/i],
  ["create", /(add|create|new|insert|place|draw|make|rect|ellipse|circle|polygon|shape|line|path|append|duplicate|import|image|generate|sticky|node|frame|layer|row|column|cell|table|chart|page|slide|section|mesh|primitive)/i],
];

export function commandKind(command) {
  const name = String(command);
  for (const [kind, re] of KIND_RULES) if (re.test(name)) return kind;
  return "modify";
}

// A beat's kind: the most common kind of its commands (ties: the earlier rule; `modify` last).
export function beatKind(commands) {
  const order = [...KIND_RULES.map(([k]) => k), "modify"];
  const votes = new Map();
  for (const c of commands) { const k = commandKind(c); votes.set(k, (votes.get(k) ?? 0) + 1); }
  let best = "modify", n = 0;
  for (const k of order) if ((votes.get(k) ?? 0) > n) { best = k; n = votes.get(k); }
  return best;
}

// `styles.modify` → "Modify styles", `shape.rect` → "Rect shape", `table.insertRow` → "Insert row table".
export function humanise(command) {
  const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  const parts = String(command).split(".").filter(Boolean);
  const text = [words(parts.at(-1) ?? ""), ...parts.slice(0, -1).reverse().map(words)].filter(Boolean).join(" ");
  return text ? text[0].toUpperCase() + text.slice(1) : String(command);
}

// The `steps:` section of a showcase.yaml as lines: for each step, the first and last line of its
// item, and the comment lines right above it (`# Masthead`), in line numbers of the given text.
// `text` may start anywhere; the section is found by its `steps:` line.
export function stepLines(text) {
  const lines = String(text).split("\n");
  const start = lines.findIndex((line) => /^steps:\s*(#.*)?$/.test(line));
  if (start < 0) return [];
  let indent = -1;
  const items = [];
  let comments = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lead = line.length - line.trimStart().length;
    if (lead === 0 && !/^-\s/.test(line) && !line.startsWith("#")) break; // the next top-level key
    if (/^\s*#/.test(line)) { comments.push(i); continue; }
    if (/^\s*-(\s|$)/.test(line) && (indent < 0 || lead === indent)) {
      if (indent < 0) indent = lead;
      // A comment followed by a blank line still names the step under it.
      items.push({ first: i, last: i, comment: comments.length ? comments : null });
      comments = [];
      continue;
    }
    if (items.length && lead > indent) { items.at(-1).last = i; comments = []; continue; }
    if (lead <= indent && indent >= 0) break;
  }
  return items.map((it) => ({
    first: it.first,
    last: it.last,
    above: it.comment ? it.comment[0] : it.first,
    caption: it.comment ? lines[it.comment.at(-1)].trim().replace(/^#+\s*/, "").trim() || null : null,
  }));
}

// A comment as a caption: its first clause (up to `: `, ` — `, `; ` or a full stop), at most `max`
// characters, cut at a word.
export function shortCaption(text, max = 56) {
  let t = String(text).replace(/\s+/g, " ").trim();
  // A short head ("1 — Cover", "Q3: totals") keeps the clause after it.
  const re = /(: | — | -- |; |\. )/g;
  let m;
  while ((m = re.exec(t))) if (m.index >= 12) { t = t.slice(0, m.index); break; }
  t = t.replace(/[.:;,]+$/, "");
  if (t.length <= max) return t;
  const word = t.lastIndexOf(" ", max - 1);
  return `${t.slice(0, word > max / 2 ? word : max - 1)}…`;
}

// The caption of a beat over steps [from, to): the comment above its first step, else the section it
// starts in (the last comment before it) with its first command in words, else the first comment
// inside it, else just the command (with how many more the beat has).
export function beatCaption(steps, from, to, commands) {
  const own = steps.slice(from, to);
  if (own[0]?.caption) return shortCaption(own[0].caption);
  const first = humanise(commands[0] ?? "step");
  const what = commands.length > 1 ? `${first} +${commands.length - 1}` : first;
  const section = steps.slice(0, from).reverse().find((s) => s && s.caption);
  if (section) return `${shortCaption(section.caption, 32)} · ${what[0].toLowerCase()}${what.slice(1)}`;
  const named = own.find((s) => s && s.caption);
  return named ? shortCaption(named.caption) : what;
}
