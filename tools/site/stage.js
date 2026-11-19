// The replay stage: plays a sample's build trace (tools/trace.mjs) over its picture. Frame 00 is the
// document before its first step; each beat an actor goes to the places that beat really changed
// (the pixel difference of the kit's own renders), works there, and the kit's render after the beat
// shows through inside those places. Skins: a swarm of cursors, a neon spider, a squid. No
// dependencies; one canvas over the picture, transforms and opacity only outside it.
//
//   const stage = KitionStage(box, img, { skin, colors, color, hud, onBeat, onEnd, loop });
//   stage.load(replayUrl)   replayUrl ends in "/": it holds trace.json and frames/
//   stage.play(), .pause(), .seek(beat), .setSkin(skin), .destroy()
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const CYAN = "#46f1ff", MAGENTA = "#ff3fd8", INK = "#07070c";
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const back = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };
  const near = (r, p) => ({ x: clamp(p.x, r.x, r.x + r.w), y: clamp(p.y, r.y, r.y + r.h) });
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  // How long a mark's gesture lasts (ms), and whether a solid block (or ink) covers the change first.
  const WORK = { create: 1150, style: 1050, text: 1200, modify: 850, move: 950, delete: 850, select: 750, structure: 1300 };
  const BLOCK = { create: 1, style: 1, move: 1, modify: 0, delete: 0, select: 0, text: 0, structure: 0 };

  // Everything playing registers here: one plays at a time.
  const all = new Set();

  function KitionStage(box, img, opts) {
    const self = { skin: opts.skin || "cursors", trace: null };
    const colors = opts.colors && opts.colors.length ? opts.colors : ["#8b7cf0"];
    let kitColor = opts.color || colors[0];
    const cv = document.createElement("canvas");
    cv.className = "stg-cv";
    cv.setAttribute("aria-hidden", "true");
    const ctx = cv.getContext("2d");
    box.appendChild(cv);
    let W = 0, H = 0, dpr = 1, doc = { x: 0, y: 0, w: 1, h: 1 };
    let base = "", frames = [], beats = [], B = 0;
    let now = 0, last = 0, raf = 0, paused = true, hidden = false, offscreen = false, ended = false, endAt = 0, endFired = false, started = false, loading = 0;
    let committed = -1, next = 0, shown = -1, lastStart = -1e9, prevBase = -1, baseAt = -1e9, loops = 0;
    let marks = [], ripples = [], web = [], actors = [], job = null, hudEl = null, capEl = null;

    // ---------- Geometry ----------

    function layout() {
      const b = box.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const oldW = W, oldH = H;
      W = Math.max(1, b.width); H = Math.max(1, b.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      doc = { x: r.left - b.left, y: r.top - b.top, w: Math.max(1, r.width), h: Math.max(1, r.height) };
      if (oldW && (Math.abs(oldW - W) > 1 || Math.abs(oldH - H) > 1)) {
        for (const a of actors) { a.x *= W / oldW; a.y *= H / oldH; if (a.feet) a.feet.forEach((f) => { f.x *= W / oldW; f.y *= H / oldH; }); }
        homes();
      }
      draw();
    }
    // A trace rectangle (document px) on the stage.
    const toStage = (rect) => {
      const sx = doc.w / self.trace.size[0], sy = doc.h / self.trace.size[1];
      return { x: doc.x + rect[0] * sx, y: doc.y + rect[1] * sy, w: Math.max(3, rect[2] * sx), h: Math.max(3, rect[3] * sy) };
    };
    const inside = (p, m) => ({ x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m) });

    // ---------- Frames ----------

    function frame(k) {
      if (k < 0 || k > B) return null;
      if (!frames[k]) {
        const im = new Image();
        im.decoding = "async";
        const f = (frames[k] = { im, ready: false });
        im.onload = () => { f.ready = true; if (paused || !raf) draw(); };
        im.src = base + (k === 0 ? self.trace.frame0 : beats[k - 1].frame);
      }
      return frames[k];
    }
    const ready = (k) => { const f = frame(k); return Boolean(f && f.ready); };

    // ---------- Marks: the feedback on a changed place ----------

    function mark(j, rect, kind, color, from) {
      const m = { j, rect, kind, color, t0: -1, dur: WORK[kind] || 900, from: from || "l", pt: null, seed: (j * 7919 + marks.length * 104729) | 0 };
      marks.push(m);
      return m;
    }
    function startMark(m, pt) {
      m.t0 = now; m.pt = pt || centre(toStage(m.rect));
      if (m.kind !== "structure") ripples.push({ x: m.pt.x, y: m.pt.y, t0: now, color: m.color });
    }
    // How far the new frame shows through: 0..1 (text reveals left to right instead).
    function reveal(m) {
      if (m.t0 < 0) return 0;
      const p = (now - m.t0) / m.dur;
      if (m.kind === "text") return seg(p, 0.12, 0.78);
      if (m.kind === "structure") return ease(seg(p, 0.15, 0.85));
      if (BLOCK[m.kind] || self.skin === "squid") return seg(p, 0.5, 0.86);
      return ease(seg(p, 0.2, 0.75));
    }
    const markDone = (m) => m.t0 >= 0 && now >= m.t0 + m.dur * 0.92;

    // ---------- Scheduling beats ----------

    function beatMarks(j, color, actorPos) {
      const b = beats[j];
      if (b.kind === "structure" || !b.targets.length) return [mark(j, [0, 0, self.trace.size[0], self.trace.size[1]], "structure", color)];
      return b.targets.map((t) => {
        const r = toStage(t.rect);
        const c = centre(r);
        const from = actorPos ? (Math.abs(actorPos.x - c.x) / r.w > Math.abs(actorPos.y - c.y) / r.h ? (actorPos.x < c.x ? "l" : "r") : actorPos.y < c.y ? "t" : "b") : "l";
        return mark(j, t.rect, b.kind, color, from);
      });
    }
    function beginBeat(j) {
      lastStart = now; next = j + 1;
      for (let k = j + 2; k <= Math.min(B, j + 4); k++) frame(k);
      shown = j;
      hud();
      if (opts.onBeat) opts.onBeat(j, beats[j], self.trace);
    }

    // ---------- Cursors ----------

    const CURSOR = new Path2D("M0 0L0 17.5L4.6 13.4L7.6 20.4L10.6 19.1L7.7 12.3L13.4 12.1Z");
    function makeCursors() {
      const n = W < 520 ? 6 : W < 900 ? 8 : 9;
      const start = Math.max(0, colors.indexOf(kitColor));
      actors = [];
      for (let i = 0; i < n; i++) {
        const color = i === 0 ? kitColor : colors[(start + i * 5) % colors.length];
        actors.push({ x: W / 2, y: H / 2, vx: 0, vy: 0, color, name: "agent-" + String(i + 1).padStart(2, "0"), tasks: [], task: null, path: null, phase: "idle", seed: i * 1.7 + 0.3 });
      }
      homes();
      actors.forEach((a) => { a.x = a.hx; a.y = a.hy; });
    }
    // Idle cursors wait around the document, spread on a loose ring.
    function homes() {
      if (self.skin !== "cursors") return;
      const c = centre(doc);
      actors.forEach((a, i) => {
        const t = (i / actors.length) * TAU + 0.5;
        a.hx = clamp(c.x + Math.cos(t) * (doc.w / 2 + 14), 18, W - 84);
        a.hy = clamp(c.y + Math.sin(t) * (doc.h / 2 + 10), 14, H - 40);
      });
    }
    function travel(a, to, speed, bend) {
      const d = Math.hypot(to.x - a.x, to.y - a.y);
      const nx = -(to.y - a.y) / (d || 1), ny = (to.x - a.x) / (d || 1);
      a.path = { x0: a.x, y0: a.y, x1: to.x, y1: to.y, cx: (a.x + to.x) / 2 + nx * d * bend, cy: (a.y + to.y) / 2 + ny * d * bend, t0: now, dur: clamp(speed[0] + d * speed[1], speed[2], speed[3]) };
    }
    function pathGoal(a) {
      const p = a.path;
      const t = ease(seg(now, p.t0, p.t0 + p.dur));
      const u = 1 - t;
      return { x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1, y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1, done: now >= p.t0 + p.dur };
    }
    function spring(a, g, k, z, dt) {
      const s = dt / 1000;
      a.vx += (k * (g.x - a.x) - 2 * z * Math.sqrt(k) * a.vx) * s;
      a.vy += (k * (g.y - a.y) - 2 * z * Math.sqrt(k) * a.vy) * s;
      a.x += a.vx * s; a.y += a.vy * s;
    }
    // Where a gesture starts on a place, and where the cursor is during it.
    function gestureAt(m, p) {
      const r = toStage(m.rect);
      const lineY = r.y + Math.min(r.h / 2, 10);
      switch (m.kind) {
        case "create": { const q = easeOut(seg(p, 0, 0.38)); return { x: r.x + r.w * q, y: r.y + r.h * q }; }
        case "style": case "move": { const q = ease(seg(p, 0.18, 0.55)); return { x: r.x + r.w * (m.from === "r" ? 1 - q : q), y: r.y + r.h / 2 }; }
        case "text": return { x: r.x + r.w * reveal(m), y: lineY };
        case "structure": return { x: doc.x + 10, y: doc.y + 10 };
        default: { const c = centre(r); return { x: c.x + Math.sin(p * 9) * 2, y: c.y + Math.sin(p * 7) * 2 }; }
      }
    }
    function dispatchCursors() {
      if (next >= B || !ready(next + 1) || now - lastStart < 620) return;
      const active = new Set(marks.filter((m) => !markDone(m)).map((m) => m.j));
      if (active.size >= 3) return;
      const idle = actors.filter((a) => a.phase === "idle");
      if (!idle.length) return;
      const j = next;
      const ms = beatMarks(j, null, null);
      const used = [];
      ms.sort((p, q) => p.rect[1] - q.rect[1] || p.rect[0] - q.rect[0]).forEach((m, i) => {
        const at = centre(toStage(m.rect));
        let a = idle.filter((x) => !used.includes(x)).sort((p, q) => dist(p, at) - dist(q, at))[0];
        if (!a) a = used[i % used.length]; else used.push(a);
        m.color = a.color;
        a.tasks.push(m);
      });
      used.forEach((a) => { a.phase = "busy"; nextTask(a); });
      beginBeat(j);
    }
    function nextTask(a) {
      a.task = a.tasks.shift() || null;
      if (!a.task) { a.phase = "idle"; travel(a, { x: a.hx, y: a.hy }, [500, 0.7, 600, 1200], (a.seed % 1) - 0.5); return; }
      a.phase = "busy"; a.stage = "go";
      travel(a, gestureAt(a.task, 0), [420, 0.9, 520, 1250], ((a.seed * 3) % 1) * 0.5 - 0.25);
    }
    function stepCursors(dt) {
      dispatchCursors();
      for (const a of actors) {
        let g;
        if (a.phase === "busy" && a.task) {
          const m = a.task;
          if (a.stage === "go") {
            g = pathGoal(a);
            if (g.done && (Math.hypot(a.x - g.x, a.y - g.y) < 5 || now - a.path.t0 - a.path.dur > 300)) { a.stage = "work"; startMark(m, { x: g.x, y: g.y }); }
          } else {
            const p = (now - m.t0) / m.dur;
            g = gestureAt(m, p);
            if (p >= 0.95) nextTask(a);
          }
        } else if (a.path) {
          g = pathGoal(a);
          // Waiting: a small drift around home.
          const t = now / 1000 + a.seed * 10;
          if (g.done) g = { x: a.hx + Math.sin(t * 0.7) * 9 + Math.sin(t * 1.9) * 3, y: a.hy + Math.cos(t * 0.6) * 7 + Math.sin(t * 2.3) * 2 };
        } else g = { x: a.hx, y: a.hy };
        spring(a, g, a.phase === "busy" ? 170 : 90, 0.52, dt);
      }
      // Cursors keep a little apart.
      for (let i = 0; i < actors.length; i++) for (let k = i + 1; k < actors.length; k++) {
        const a = actors[i], b = actors[k];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        if (d < 34) {
          const f = ((34 - d) / 34) * 260 * (dt / 1000);
          const wa = a.phase === "busy" && a.stage === "work" ? 0.15 : 1, wb = b.phase === "busy" && b.stage === "work" ? 0.15 : 1;
          a.vx -= (dx / d) * f * wa * 20; a.vy -= (dy / d) * f * wa * 20; b.vx += (dx / d) * f * wb * 20; b.vy += (dy / d) * f * wb * 20;
        }
      }
      for (const a of actors) { const m = 10; a.x = clamp(a.x, m, W - m); a.y = clamp(a.y, m, H - m); }
    }
    function drawCursors() {
      const small = W < 520;
      ctx.font = "600 " + (small ? 9 : 10) + "px 'JetBrains Mono', ui-monospace, monospace";
      for (const a of actors) {
        ctx.save();
        ctx.translate(a.x, a.y);
        const s = small ? 0.95 : 1.12;
        ctx.scale(s, s);
        ctx.shadowColor = alpha(a.color, 0.9); ctx.shadowBlur = 10;
        ctx.fillStyle = a.color; ctx.fill(CURSOR);
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.3; ctx.strokeStyle = INK; ctx.stroke(CURSOR);
        ctx.restore();
        const tw = ctx.measureText(a.name).width + 10;
        // The tag sits right of the pointer, or left of it near the right edge.
        const x = a.x + 12 + tw > W - 4 ? a.x - tw - 4 : a.x + 12, y = Math.min(a.y + 19, H - (small ? 16 : 18));
        ctx.globalAlpha = a.phase === "busy" ? 1 : 0.72;
        ctx.fillStyle = a.color;
        round(x, y, tw, small ? 14 : 16, 4); ctx.fill();
        ctx.fillStyle = INK;
        ctx.fillText(a.name, x + 5, y + (small ? 10.5 : 11.5));
        ctx.globalAlpha = 1;
      }
    }

    // ---------- Spider ----------

    // Legs: four a side, front to back; hip and rest-foot angles from the heading.
    const HIPS = [-0.55, -1.2, -1.95, -2.55, 0.55, 1.2, 1.95, 2.55];
    const FEET = [-0.42, -1.12, -2.05, -2.7, 0.42, 1.12, 2.05, 2.7];
    const GROUP = [0, 1, 0, 1, 1, 0, 1, 0];
    function makeCreature() {
      // Sized by the document, so a small stage still shows a creature that reads.
      const s = clamp(Math.min(doc.w, doc.h * 1.5), 160, 700);
      const c = { x: doc.x + doc.w * 0.82, y: doc.y + doc.h * 0.2, vx: 0, vy: 0, heading: -Math.PI / 2, path: null, phase: "idle", tilt: 0 };
      if (self.skin === "spider") {
        c.r = clamp(s * 0.03, 7, 13);
        c.l1 = clamp(s * 0.1, 26, 60); c.l2 = c.l1 * 1.22;
        c.feet = HIPS.map((_, i) => { const r = restFoot(c, i); return { x: r.x, y: r.y, from: null, t0: 0, grab: null }; });
      } else {
        c.r = clamp(s * 0.062, 15, 30);
        c.arms = Array.from({ length: 8 }, (_, i) => ({ i, x: c.x, y: c.y + c.r * 2, vx: 0, vy: 0, grab: null, len: c.r * (i === 2 || i === 5 ? 2.5 : 1.75 + (i % 2) * 0.35) }));
      }
      actors = [c];
    }
    function restFoot(c, i) {
      const reach = (c.l1 + c.l2) * 0.62;
      const a = c.heading + FEET[i];
      return { x: c.x + Math.cos(a) * reach, y: c.y + Math.sin(a) * reach };
    }
    function hipOf(c, i) {
      const a = c.heading + HIPS[i];
      return { x: c.x + Math.cos(a) * c.r * 0.55, y: c.y + Math.sin(a) * c.r * 0.55 };
    }
    // The spot to work from: outside the places when it can, close enough to reach them.
    function anchorFor(rects, c) {
      const u = rects.reduce((acc, r) => (acc ? { x: Math.min(acc.x, r.x), y: Math.min(acc.y, r.y), x2: Math.max(acc.x2, r.x + r.w), y2: Math.max(acc.y2, r.y + r.h) } : { x: r.x, y: r.y, x2: r.x + r.w, y2: r.y + r.h }), null);
      const off = self.skin === "spider" ? (c.l1 + c.l2) * 0.5 : c.r * 3.4;
      const mx = (u.x + u.x2) / 2, my = (u.y + u.y2) / 2;
      // The squid floats above its work with its arms hanging down; the spider stands beside it.
      const above = { x: mx, y: u.y - off }, below = { x: mx, y: u.y2 + off }, left = { x: u.x - off, y: my }, right = { x: u.x2 + off, y: my };
      const cands = self.skin === "squid" ? [above, left, right, below] : [left, right, above, below];
      const margin = c.r * (self.skin === "spider" ? 2 : 2.4);
      let best = null, score = Infinity;
      cands.forEach((p, i) => {
        const q = inside(p, margin);
        const far = Math.max(...rects.map((r) => dist(q, near(r, q))));
        const s = i * 22 + dist(p, q) * 1.5 + far * 0.6 + dist(q, c) * 0.12;
        if (s < score) { score = s; best = q; }
      });
      return best;
    }
    function dispatchCreature() {
      if (next >= B || !ready(next + 1)) return;
      if (job && job.phase !== "back") return;
      const c = actors[0];
      const j = next;
      const ms = beatMarks(j, self.skin === "spider" ? CYAN : kitColor, null);
      const structure = ms[0].kind === "structure";
      const rects = ms.map((m) => toStage(m.rect));
      const anchor = structure ? inside({ x: doc.x + doc.w / 2, y: doc.y + Math.min(doc.h * 0.18, 60) }, c.r * 3) : anchorFor(rects, c);
      ms.forEach((m) => { const r = toStage(m.rect), k = centre(r); m.from = Math.abs(anchor.x - k.x) / r.w > Math.abs(anchor.y - k.y) / r.h ? (anchor.x < k.x ? "l" : "r") : anchor.y < k.y ? "t" : "b"; });
      if (job) release(job);
      job = { j, marks: ms, phase: "go", t0: now, anchor, structure };
      travel(c, anchor, self.skin === "spider" ? [500, 1.25, 650, 1500] : [520, 1.0, 650, 1400], self.skin === "spider" ? 0.12 : 0.38);
      beginBeat(j);
    }
    function release(jb) {
      const c = actors[0];
      if (c.feet) c.feet.forEach((f) => (f.grab = null));
      if (c.arms) c.arms.forEach((a) => (a.grab = null));
      jb.phase = "gone";
    }
    // Spider: two corners of each place, nearest the body first, each to the nearest free leg.
    function grabSpider(c, jb) {
      const pts = [];
      jb.marks.forEach((m) => {
        const r = toStage(m.rect);
        const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }].sort((p, q) => dist(p, c) - dist(q, c));
        const take = jb.marks.length > 2 ? 1 : 2;
        corners.slice(0, take).forEach((p) => pts.push({ p, m }));
      });
      const free = c.feet.map((f, i) => i);
      pts.slice(0, 6).forEach(({ p, m }, k) => {
        const i = free.sort((a, b) => dist(restFoot(c, a), p) - dist(restFoot(c, b), p))[0];
        free.splice(free.indexOf(i), 1);
        const f = c.feet[i];
        f.grab = { x: p.x, y: p.y, t0: now + k * 70, fx: f.x, fy: f.y, m };
      });
    }
    function grabSquid(c, jb) {
      const order = c.arms.slice().sort((a, b) => Math.abs(a.i - 3.5) - Math.abs(b.i - 3.5));
      let k = 0;
      jb.marks.forEach((m) => {
        const r = toStage(m.rect);
        const per = jb.marks.length <= 2 ? 2 : 1;
        for (let n = 0; n < per && k < order.length; n++) {
          const t = per === 1 ? 0.5 : n === 0 ? 0.3 : 0.7;
          order[k++].grab = { x: r.x + r.w * t, y: r.y + r.h * (per === 1 ? 0.5 : n === 0 ? 0.35 : 0.65), t0: now + n * 60, m };
        }
      });
    }
    function stepCreature(dt) {
      dispatchCreature();
      const c = actors[0];
      const spider = self.skin === "spider";
      let g = c.path ? pathGoal(c) : { x: c.x, y: c.y, done: true };
      if (job) {
        if (job.phase === "go" && g.done && (Math.hypot(c.x - g.x, c.y - g.y) < 6 || now - c.path.t0 - c.path.dur > 400)) {
          job.phase = "reach"; job.t0 = now;
          if (!job.structure) (spider ? grabSpider : grabSquid)(c, job);
        } else if (job.phase === "reach" && now - job.t0 > (job.structure ? 120 : 300)) {
          job.phase = "work"; job.t0 = now;
          job.marks.forEach((m, k) => {
            const arm = spider ? c.feet.find((f) => f.grab && f.grab.m === m) : c.arms.find((a) => a.grab && a.grab.m === m);
            setTimeout0(() => startMark(m, arm ? { x: arm.grab.x, y: arm.grab.y } : null), k * 90);
            if (spider && !job.structure) silk(toStage(m.rect), c);
          });
        } else if (job.phase === "work" && job.marks.every((m) => m.t0 >= 0 && now > m.t0 + m.dur * 0.9)) {
          job.phase = "back"; job.t0 = now;
        } else if (job.phase === "back" && now - job.t0 > 240) {
          release(job); job = null;
        }
        // Structure: the squid swims a loop, the spider re-weaves at the top edge.
        if (job && job.structure && job.phase === "work") {
          const t = (now - job.t0) / 1300;
          g = { x: job.anchor.x + Math.sin(t * TAU) * (spider ? 18 : 40), y: job.anchor.y + (1 - Math.cos(t * TAU)) * (spider ? 6 : 22) };
        }
      }
      if (!spider) g = { x: g.x, y: g.y + Math.sin(now / 520) * 3 };
      spring(c, g, spider ? 70 : 45, spider ? 0.75 : 0.6, dt);
      const m = c.r * (spider ? 1.6 : 1.8);
      c.x = clamp(c.x, m, W - m); c.y = clamp(c.y, m, H - m * 1.2);
      const speed = Math.hypot(c.vx, c.vy);
      if (spider) {
        // It faces up the page, leaning a little into its way; the legs keep their sides.
        let want = -Math.PI / 2;
        if (speed > 25) { const d = Math.atan2(c.vy, c.vx) + Math.PI / 2; want += clamp(Math.atan2(Math.sin(d), Math.cos(d)), -0.5, 0.5); }
        c.heading += (want - c.heading) * Math.min(1, dt / 220);
        stepLegs(c, dt);
      } else {
        c.tilt = lerp(c.tilt, clamp(c.vx / 420, -0.45, 0.45), Math.min(1, dt / 180));
        stepArms(c, dt);
      }
    }
    let timers = [];
    const setTimeout0 = (fn, ms) => timers.push({ at: now + ms, fn });
    function stepLegs(c, dt) {
      const reach = c.l1 + c.l2;
      const moving = c.feet.some((f) => f.from);
      for (let i = 0; i < 8; i++) {
        const f = c.feet[i];
        if (f.grab) {
          const q = easeOut(seg(now, f.grab.t0, f.grab.t0 + 220));
          f.x = lerp(f.grab.fx, f.grab.x, q); f.y = lerp(f.grab.fy, f.grab.y, q);
          continue;
        }
        if (f.from) {
          const q = seg(now, f.t0, f.t0 + 115);
          const to = f.to;
          f.x = lerp(f.from.x, to.x, ease(q)); f.y = lerp(f.from.y, to.y, ease(q)) - Math.sin(q * Math.PI) * 3;
          if (q >= 1) f.from = null;
        }
      }
      if (moving) return;
      // Alternate groups: the group with the most strained foot steps, toward where the body is going.
      let worst = -1, group = 0;
      c.feet.forEach((f, i) => {
        if (f.grab) return;
        const e = dist(f, restFoot(c, i));
        if (e > worst) { worst = e; group = GROUP[i]; }
      });
      if (worst < reach * 0.16) return;
      c.feet.forEach((f, i) => {
        if (f.grab || GROUP[i] !== group) return;
        const r = restFoot(c, i);
        if (dist(f, r) < reach * 0.08) return;
        f.from = { x: f.x, y: f.y }; f.t0 = now;
        f.to = inside({ x: r.x + c.vx * 0.2, y: r.y + c.vy * 0.2 }, 3);
      });
    }
    // Two-bone inverse kinematics: the knee of a leg from hip to foot; front legs arch forward, back
    // legs backward, the spider's outline.
    function knee(c, hip, foot, l1, l2, front) {
      let dx = foot.x - hip.x, dy = foot.y - hip.y;
      let d = Math.hypot(dx, dy) || 1;
      const max = l1 + l2 - 0.5;
      const tip = d > max ? { x: hip.x + (dx / d) * max, y: hip.y + (dy / d) * max } : foot;
      d = Math.min(d, max); d = Math.max(d, Math.abs(l1 - l2) + 1);
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const ux = dx / Math.hypot(dx, dy || 1e-6), uy = dy / Math.hypot(dx || 1e-6, dy);
      const px = hip.x + ux * a, py = hip.y + uy * a;
      const k1 = { x: px - uy * h, y: py + ux * h }, k2 = { x: px + uy * h, y: py - ux * h };
      const hx = Math.cos(c.heading), hy = Math.sin(c.heading);
      const score = (k) => ((k.x - px) * hx + (k.y - py) * hy) * (front ? 1 : -1) + (dist(k, c) - dist({ x: px, y: py }, c)) * 0.6;
      return { knee: score(k1) > score(k2) ? k1 : k2, tip };
    }
    function silk(r, c) {
      const p = near(r, c);
      const prev = web.length ? web[web.length - 1].b : null;
      if (prev && dist(prev, p) > 4) web.push({ a: prev, b: p, t0: now });
      else if (!prev) web.push({ a: { x: c.x, y: c.y }, b: p, t0: now });
      if (web.length > 48) web.shift();
    }
    function drawSpider() {
      const c = actors[0];
      // The web so far, and threads from fully stretched legs to what they hold.
      ctx.lineWidth = 1;
      for (const s of web) {
        const a = Math.min(1, (now - s.t0) / 400);
        const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2 + Math.min(18, dist(s.a, s.b) * 0.08);
        ctx.strokeStyle = "rgba(200,245,255," + 0.22 * a + ")";
        ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.quadraticCurveTo(mx, my, s.b.x, s.b.y); ctx.stroke();
      }
      const legs = c.feet.map((f, i) => { const hip = hipOf(c, i); const k = knee(c, hip, f, c.l1, c.l2, i % 4 < 2); return { hip, knee: k.knee, foot: k.tip, f }; });
      for (const L of legs) if (L.f.grab && dist(L.foot, L.f) > 2) {
        ctx.strokeStyle = "rgba(200,245,255,.55)";
        ctx.beginPath(); ctx.moveTo(L.foot.x, L.foot.y); ctx.lineTo(L.f.x, L.f.y); ctx.stroke();
      }
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const [w, col] of [[5, "rgba(70,241,255,.16)"], [1.6, CYAN]]) {
        ctx.lineWidth = w; ctx.strokeStyle = col;
        ctx.beginPath();
        for (const L of legs) { ctx.moveTo(L.hip.x, L.hip.y); ctx.lineTo(L.knee.x, L.knee.y); ctx.lineTo(L.foot.x, L.foot.y); }
        ctx.stroke();
      }
      ctx.fillStyle = MAGENTA; ctx.shadowColor = MAGENTA; ctx.shadowBlur = 8;
      ctx.beginPath();
      for (const L of legs) { ctx.moveTo(L.knee.x + 2.2, L.knee.y); ctx.arc(L.knee.x, L.knee.y, 2.2, 0, TAU); ctx.moveTo(L.foot.x + (L.f.grab ? 2.4 : 1.5), L.foot.y); ctx.arc(L.foot.x, L.foot.y, L.f.grab ? 2.4 : 1.5, 0, TAU); }
      ctx.fill();
      ctx.shadowBlur = 0;
      // Body: abdomen behind, head in front, a light inside.
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.heading);
      const r = c.r;
      ctx.lineWidth = 1.4;
      ctx.fillStyle = "rgba(10,14,26,.92)"; ctx.strokeStyle = CYAN; ctx.shadowColor = CYAN; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(-r * 1.25, 0, r * 1.35, r * 1.05, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(r * 0.45, 0, r * 0.8, r * 0.7, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      const glow = ctx.createRadialGradient(-r * 1.25, 0, 0, -r * 1.25, 0, r * 1.1);
      const pulse = 0.65 + 0.35 * Math.sin(now / 300);
      glow.addColorStop(0, "rgba(255,255,255," + 0.95 * pulse + ")"); glow.addColorStop(0.35, alpha(MAGENTA, 0.75 * pulse)); glow.addColorStop(1, "rgba(255,63,216,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.ellipse(-r * 1.25, 0, r * 1.1, r * 0.85, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = CYAN;
      ctx.beginPath(); ctx.arc(r * 0.95, -r * 0.28, 1.4, 0, TAU); ctx.arc(r * 0.95, r * 0.28, 1.4, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ---------- Squid ----------

    function armBase(c, i) {
      const x = (i / 7 - 0.5) * c.r * 1.05, y = c.r * 0.82;
      const s = Math.sin(c.tilt), k = Math.cos(c.tilt);
      return { x: c.x + x * k - y * s, y: c.y + x * s + y * k };
    }
    function stepArms(c, dt) {
      for (const a of c.arms) {
        const b = armBase(c, a.i);
        let g;
        if (a.grab && now >= a.grab.t0) g = a.grab;
        else {
          const t = now / 1000;
          const ang = Math.PI / 2 + c.tilt + (a.i - 3.5) * 0.24 + Math.sin(t * 2.1 + a.i * 0.9) * 0.18;
          g = { x: b.x + Math.cos(ang) * a.len - c.vx * 0.05, y: b.y + Math.sin(ang) * a.len - c.vy * 0.05 };
        }
        spring(a, g, a.grab ? 150 : 70, a.grab ? 0.6 : 0.75, dt);
        // An idle arm trails, but never further than a little past its length.
        const d = dist(a, b), max = a.grab ? Infinity : a.len * 1.35;
        if (d > max) { a.x = b.x + ((a.x - b.x) * max) / d; a.y = b.y + ((a.y - b.y) * max) / d; }
        const p = inside(a, 2); a.x = p.x; a.y = p.y;
      }
    }
    // A tentacle: a cubic from its base to its tip, filled as a tapering ribbon.
    function drawArm(c, a, fill) {
      const b = armBase(c, a.i);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const t = now / 1000;
      const curl = Math.sin(t * 1.7 + a.i) * 0.35 * (a.grab ? 0.4 : 1);
      const c1 = { x: b.x - Math.sin(c.tilt) * d * 0.45, y: b.y + Math.cos(c.tilt) * d * 0.45 };
      const c2 = { x: a.x + (b.x - a.x) * 0.35 - (a.y - b.y) * curl * 0.35, y: a.y + (b.y - a.y) * 0.35 + (a.x - b.x) * curl * 0.35 };
      const N = 14, left = [], right = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N, v = 1 - u;
        const x = v * v * v * b.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * a.x;
        const y = v * v * v * b.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * a.y;
        const dx = 3 * v * v * (c1.x - b.x) + 6 * v * u * (c2.x - c1.x) + 3 * u * u * (a.x - c2.x);
        const dy = 3 * v * v * (c1.y - b.y) + 6 * v * u * (c2.y - c1.y) + 3 * u * u * (a.y - c2.y);
        const n = Math.hypot(dx, dy) || 1;
        const w = lerp(c.r * 0.17, 0.9, Math.pow(u, 0.8));
        left.push({ x: x - (dy / n) * w, y: y + (dx / n) * w }); right.push({ x: x + (dy / n) * w, y: y - (dx / n) * w });
      }
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (const p of left) ctx.lineTo(p.x, p.y);
      for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k].x, right[k].y);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,200,240,.55)"; ctx.stroke();
      if (a.grab) {
        ctx.fillStyle = "rgba(255,255,255,.75)";
        for (let k = 0; k < 3; k++) { const p = left[N - 2 - k * 2]; ctx.beginPath(); ctx.arc(p.x, p.y, 1.1, 0, TAU); ctx.fill(); }
      }
    }
    function drawSquid() {
      const c = actors[0];
      const r = c.r;
      const body = ctx.createLinearGradient(c.x, c.y - r * 1.4, c.x, c.y + r);
      body.addColorStop(0, "#ffb3e6"); body.addColorStop(0.45, "#ff64c8"); body.addColorStop(1, "#7a5cf0");
      ctx.shadowColor = "rgba(255,100,200,.6)"; ctx.shadowBlur = 14;
      for (const a of c.arms) drawArm(c, a, a.i === 2 || a.i === 5 ? "#c873f0" : "#e46ad8");
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.tilt);
      const sq = 1 + Math.sin(now / 260) * 0.04;
      ctx.scale(1 / sq, sq);
      ctx.translate(-c.x, -c.y);
      // Mantle with two fins.
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - r * 1.45);
      ctx.bezierCurveTo(c.x + r * 0.55, c.y - r * 1.3, c.x + r * 0.85, c.y - r * 0.2, c.x + r * 0.72, c.y + r * 0.55);
      ctx.quadraticCurveTo(c.x + r * 0.6, c.y + r * 0.95, c.x, c.y + r * 0.95);
      ctx.quadraticCurveTo(c.x - r * 0.6, c.y + r * 0.95, c.x - r * 0.72, c.y + r * 0.55);
      ctx.bezierCurveTo(c.x - r * 0.85, c.y - r * 0.2, c.x - r * 0.55, c.y - r * 1.3, c.x, c.y - r * 1.45);
      ctx.moveTo(c.x + r * 0.42, c.y - r * 0.95); ctx.quadraticCurveTo(c.x + r * 1.05, c.y - r * 1.1, c.x + r * 0.9, c.y - r * 0.55); ctx.lineTo(c.x + r * 0.62, c.y - r * 0.5);
      ctx.moveTo(c.x - r * 0.42, c.y - r * 0.95); ctx.quadraticCurveTo(c.x - r * 1.05, c.y - r * 1.1, c.x - r * 0.9, c.y - r * 0.55); ctx.lineTo(c.x - r * 0.62, c.y - r * 0.5);
      ctx.fillStyle = body; ctx.shadowColor = "rgba(255,100,200,.7)"; ctx.shadowBlur = 16; ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(255,225,245,.9)"; ctx.stroke();
      // Gloss.
      ctx.fillStyle = "rgba(255,255,255,.38)";
      ctx.beginPath(); ctx.ellipse(c.x - r * 0.28, c.y - r * 0.7, r * 0.14, r * 0.42, 0.25, 0, TAU); ctx.fill();
      // Eyes, looking where it works.
      const look = job && job.marks[0] ? centre(toStage(job.marks[0].rect)) : { x: c.x, y: c.y + 40 };
      const lx = clamp((look.x - c.x) / 200, -1, 1) * r * 0.08, ly = clamp((look.y - c.y) / 200, -1, 1) * r * 0.08;
      for (const s of [-1, 1]) {
        const ex = c.x + s * r * 0.33, ey = c.y + r * 0.36;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.21, r * 0.24, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ex + lx, ey + ly, r * 0.12, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex + lx - r * 0.04, ey + ly - r * 0.05, r * 0.04, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // ---------- Drawing ----------

    function round(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function drawFrame(k, a) {
      const f = frames[k];
      if (!f || !f.ready || a <= 0) return false;
      ctx.globalAlpha = a;
      ctx.drawImage(f.im, doc.x, doc.y, doc.w, doc.h);
      ctx.globalAlpha = 1;
      return true;
    }
    function drawDoc() {
      const fade = easeOut(seg(now, baseAt, baseAt + 320));
      if (fade < 1 && prevBase >= -1) drawFrame(prevBase + 1, 1);
      if (!drawFrame(committed + 1, fade < 1 ? fade : 1)) drawFrame(0, 1);
      for (const m of marks) {
        // The beat just committed keeps its places drawn while the whole frame fades in under them.
        if (m.j <= (fade < 1 ? prevBase : committed)) continue;
        const a = reveal(m);
        if (a <= 0) continue;
        ctx.save();
        if (m.kind !== "structure") {
          const r = toStage(m.rect);
          ctx.beginPath();
          if (m.kind === "text") ctx.rect(r.x - 1, r.y - 1, (r.w + 2) * a, r.h + 2); else ctx.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
          ctx.clip();
        }
        drawFrame(m.j + 1, m.kind === "text" ? 1 : a);
        ctx.restore();
      }
    }
    function drawMark(m) {
      if (m.t0 < 0) return;
      const p = (now - m.t0) / m.dur;
      const after = Math.max(0, now - (m.t0 + m.dur));
      const fadeOut = 1 - seg(after, 300, 1100);
      if (fadeOut <= 0) return;
      const col = m.color || kitColor;
      if (m.kind === "structure") {
        if (p > 1) return;
        const y = doc.y + doc.h * ease(seg(p, 0.05, 0.85));
        const g = ctx.createLinearGradient(0, y - 60, 0, y);
        g.addColorStop(0, alpha(col, 0)); g.addColorStop(1, alpha(col, 0.35));
        ctx.fillStyle = g; ctx.fillRect(doc.x, Math.max(doc.y, y - 60), doc.w, Math.min(60, y - doc.y));
        ctx.fillStyle = "#fff"; ctx.fillRect(doc.x, y, doc.w, 1.5);
        neonRect({ x: doc.x, y: doc.y, w: doc.w, h: doc.h }, col, (1 - seg(p, 0.7, 1)) * 0.9, 0);
        return;
      }
      const r0 = toStage(m.rect);
      const r = { x: r0.x - 3, y: r0.y - 3, w: r0.w + 6, h: r0.h + 6 };
      // The outline snaps in (create draws it out from a corner; delete shrinks it away).
      const snap = back(seg(p, 0, 0.28));
      let o = r;
      if (m.kind === "create") { const q = easeOut(seg(p, 0, 0.38)); o = { x: r.x, y: r.y, w: Math.max(4, r.w * q), h: Math.max(4, r.h * q) }; }
      else if (m.kind === "delete" && p > 0.6) { const q = 1 - ease(seg(p, 0.6, 1)) * 0.5; o = { x: r.x + (r.w * (1 - q)) / 2, y: r.y + (r.h * (1 - q)) / 2, w: r.w * q, h: r.h * q }; }
      else { const g = (1 - snap) * 14; o = { x: r.x - g, y: r.y - g, w: r.w + g * 2, h: r.h + g * 2 }; }
      neonRect(o, self.skin === "spider" ? CYAN : col, Math.min(1, p * 6) * fadeOut, self.skin === "spider" ? MAGENTA : "#fff");
      if (p > 1) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(r0.x, r0.y, r0.w, r0.h); ctx.clip();
      if (self.skin === "squid" && m.kind !== "text") ink(m, r0, p);
      else if (BLOCK[m.kind]) block(m, r0, p, self.skin === "spider" ? kitColor : col);
      else if (m.kind === "select") { const x = r0.x + r0.w * ease(seg(p, 0.1, 0.8)); ctx.fillStyle = alpha(col, 0.3); ctx.fillRect(r0.x, r0.y, x - r0.x, r0.h); ctx.fillStyle = col; ctx.fillRect(x - 1, r0.y, 2, r0.h); }
      else if (m.kind === "modify" || m.kind === "delete") { ctx.fillStyle = alpha(col, 0.32 * (1 - seg(p, 0.15, 0.8))); ctx.fillRect(r0.x, r0.y, r0.w, r0.h); }
      ctx.restore();
      if (m.kind === "text" && p < 0.95) {
        const x = r0.x + r0.w * reveal(m);
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
        ctx.globalAlpha = Math.floor(now / 260) % 2 || p < 0.78 ? 1 : 0.2;
        ctx.fillRect(x - 1, r0.y - 2, 2.2, Math.min(r0.h + 4, 26));
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }
    }
    // A solid block slides in from the actor's side, holds, then dissolves into the new picture.
    function block(m, r, p, col) {
      const q = ease(seg(p, 0.12, 0.42));
      const a = 1 - seg(p, 0.55, 0.9);
      if (a <= 0 || q <= 0) return;
      let x = r.x, y = r.y, w = r.w, h = r.h;
      if (m.from === "l") w *= q; else if (m.from === "r") { x += r.w * (1 - q); w *= q; } else if (m.from === "t") h *= q; else { y += r.h * (1 - q); h *= q; }
      ctx.globalAlpha = a * 0.92;
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = a * 0.25;
      ctx.fillStyle = "#fff";
      for (let k = 0; k < 3; k++) ctx.fillRect(x, y + (h * (k + 0.5)) / 3, w, 1);
      ctx.globalAlpha = 1;
    }
    // Ink spreads from the tentacle's tip, then thins out into the new picture.
    function ink(m, r, p) {
      const o = m.pt || centre(r);
      const reach = Math.max(dist(o, { x: r.x, y: r.y }), dist(o, { x: r.x + r.w, y: r.y + r.h }), dist(o, { x: r.x + r.w, y: r.y }), dist(o, { x: r.x, y: r.y + r.h }));
      const g = easeOut(seg(p, 0.08, 0.5));
      const a = 1 - seg(p, 0.55, 0.92);
      if (a <= 0 || g <= 0) return;
      const rand = rng(m.seed);
      ctx.fillStyle = alpha(kitColor, 0.9 * a);
      ctx.beginPath();
      ctx.arc(o.x, o.y, reach * g * 1.05, 0, TAU);
      for (let k = 0; k < 6; k++) {
        const ang = rand() * TAU, d = reach * (0.3 + rand() * 0.6) * g, rr = reach * (0.15 + rand() * 0.3) * g;
        ctx.moveTo(o.x + Math.cos(ang) * d + rr, o.y + Math.sin(ang) * d);
        ctx.arc(o.x + Math.cos(ang) * d, o.y + Math.sin(ang) * d, rr, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255," + 0.18 * a + ")";
      ctx.beginPath(); ctx.arc(o.x - reach * g * 0.2, o.y - reach * g * 0.25, reach * g * 0.25, 0, TAU); ctx.fill();
    }
    function neonRect(r, col, a, tick) {
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.lineWidth = 4; ctx.strokeStyle = alpha(col, 0.25); ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (tick) {
        const l = Math.min(9, r.w / 3, r.h / 3);
        ctx.lineWidth = 2.2; ctx.strokeStyle = tick;
        ctx.beginPath();
        for (const [x, y, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) { ctx.moveTo(x, y + sy * l); ctx.lineTo(x, y); ctx.lineTo(x + sx * l, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawRipples() {
      ripples = ripples.filter((rp) => now - rp.t0 < 520);
      for (const rp of ripples) {
        const q = (now - rp.t0) / 520;
        ctx.globalAlpha = 1 - q;
        ctx.lineWidth = 2 * (1 - q) + 0.5; ctx.strokeStyle = rp.color || kitColor;
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 4 + easeOut(q) * 20, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function draw() {
      // Until the first frame is in, the canvas keeps what it had (the previous replay's end).
      if (!self.trace || !W || !ready(0)) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawDoc();
      for (const m of marks) drawMark(m);
      drawRipples();
      if (!actors.length) return;
      if (self.skin === "cursors") drawCursors(); else if (self.skin === "spider") drawSpider(); else drawSquid();
    }

    // ---------- Loop ----------

    function tick(t) {
      raf = 0;
      if (paused || hidden || offscreen) return;
      const dt = Math.min(48, t - (last || t));
      last = t; now += dt;
      update(dt);
      draw();
      raf = requestAnimationFrame(tick);
    }
    function update(dt) {
      timers = timers.filter((x) => (now >= x.at ? (x.fn(), false) : true));
      if (!ended) {
        if (self.skin === "cursors") stepCursors(dt); else stepCreature(dt);
        while (committed + 1 < B) {
          const own = marks.filter((m) => m.j === committed + 1);
          if (!own.length || !own.every(markDone)) break;
          prevBase = committed; committed++; baseAt = now;
          if (shown < committed) shown = committed;
          hud();
        }
        marks = marks.filter((m) => m.j > committed || now - (m.t0 + m.dur) < 1200);
        if (committed === B - 1) { ended = true; endAt = now; hud(); }
      } else {
        if (self.skin === "cursors") stepCursors(dt); else stepCreature(dt);
        if (now - endAt > 3200 && !endFired) {
          endFired = true;
          const again = opts.onEnd ? opts.onEnd(self) : true;
          if (again !== false) restart();
        }
      }
    }
    function restart() { seek(0); }
    function seek(j) {
      j = clamp(j | 0, 0, Math.max(0, B - 1));
      marks = []; ripples = []; timers = []; ended = false; endFired = false;
      if (job) release(job);
      job = null;
      prevBase = committed; baseAt = now;
      committed = j - 1; next = j; shown = j - 1; lastStart = -1e9;
      if (j === 0) web = [];
      actors.forEach((a) => { if (a.tasks) { a.tasks = []; a.task = null; a.phase = "idle"; travel(a, { x: a.hx, y: a.hy }, [300, 0.5, 300, 700], 0); } });
      frame(j); frame(j + 1); frame(j + 2);
      hud();
      draw();
    }

    // ---------- HUD ----------

    function buildHud() {
      hudEl = opts.hud;
      if (!hudEl) return;
      hudEl.innerHTML = '<div class="stg-hud"><button type="button" class="stg-btn" data-a="play" aria-label="Pause the replay"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg></button>'
        + '<button type="button" class="stg-btn" data-a="again" aria-label="Replay from the start"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3a5 5 0 1 1-4.6 3H1.8L4.5 2.6 7.2 6H5.6A3 3 0 1 0 8 5z"/></svg></button>'
        + '<span class="stg-dots" aria-hidden="true"></span><span class="stg-agents"></span>'
        + '<span class="stg-num" aria-live="off"><b>0</b> / <span></span> commands</span>'
        + '<span class="stg-track"><span class="stg-fill"></span><span class="stg-ticks"></span></span>'
        + '<span class="stg-state">building</span></div>';
      capEl = opts.cap || hudEl;
      capEl.insertAdjacentHTML("beforeend", '<p class="stg-cap"><span class="stg-tag">Replay</span><span class="stg-capt"></span></p>'
        + (opts.note ? '<p class="stg-note">' + esc(opts.note) + "</p>" : ""));
      hudEl.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.a === "play") { if (paused) self.play(true); else self.pause(); }
        else if (b.dataset.a === "again") { seek(0); self.play(true); }
        else if (b.dataset.beat) { seek(Number(b.dataset.beat)); self.play(true); }
      });
    }
    function hudTrace() {
      if (!hudEl || !self.trace) return;
      const t = self.trace;
      hudEl.querySelector(".stg-num span").textContent = fmt(t.commands);
      let from = 0;
      hudEl.querySelector(".stg-ticks").innerHTML = beats.map((b, i) => {
        const l = (from / t.commands) * 100, w = ((b.at - from) / t.commands) * 100;
        from = b.at;
        return '<button type="button" class="stg-tick" data-beat="' + i + '" style="left:' + l.toFixed(2) + "%;width:" + w.toFixed(2) + '%" aria-label="Beat ' + (i + 1) + " of " + beats.length + ": " + esc(b.caption) + '"></button>';
      }).join("");
    }
    function hud() {
      if (!hudEl || !self.trace) return;
      const t = self.trace;
      const i = Math.max(shown, committed);
      const at = i >= 0 ? beats[i].at : 0;
      const done = committed >= B - 1;
      hudEl.querySelector(".stg-num b").textContent = fmt(at);
      hudEl.querySelector(".stg-fill").style.transform = "scaleX(" + (at / t.commands).toFixed(4) + ")";
      hudEl.querySelector(".stg-state").textContent = done ? "done" : paused ? "paused" : "building";
      hudEl.querySelector(".stg-hud").classList.toggle("done", done);
      capEl.querySelector(".stg-capt").textContent = i >= 0 ? beats[i].caption : "Before the first command";
      const ticks = hudEl.querySelectorAll(".stg-tick");
      ticks.forEach((b, k) => { b.classList.toggle("on", k <= committed); b.classList.toggle("now", k === shown && !done); });
      const list = self.skin === "cursors" ? actors : [{ color: self.skin === "spider" ? CYAN : "#ff64c8", phase: "busy" }];
      hudEl.querySelector(".stg-dots").innerHTML = list.map((a) => '<i style="--d:' + a.color + '"></i>').join("");
      hudEl.querySelector(".stg-agents").textContent = list.length + (list.length === 1 ? " agent" : " agents");
      const play = hudEl.querySelector('[data-a="play"]');
      play.classList.toggle("paused", paused);
      play.setAttribute("aria-label", paused ? "Play the replay" : "Pause the replay");
    }

    // ---------- Public ----------

    self.load = (url) => {
      const ticket = ++loading;
      kitColor = opts.color || kitColor;
      started = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      return fetch(url + "trace.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((t) => {
        if (ticket !== loading) return self;
        base = url;
        self.trace = t; beats = t.beats; B = beats.length; frames = [];
        layout();
        actors = [];
        setSkin(self.skin, true);
        hudTrace();
        seek(0);
        return new Promise((resolve) => {
          const f = frame(0), g = frame(1);
          const go = () => { if (ticket !== loading) resolve(self); else if (f.ready && (!g || g.ready)) { started = true; draw(); resolve(self); } else setTimeout(go, 40); };
          go();
        });
      });
    };
    function setSkin(skin, quiet) {
      self.skin = skin;
      if (!self.trace) return;
      if (job) release(job);
      job = null;
      if (skin === "cursors") makeCursors(); else makeCreature();
      web = [];
      if (!quiet) { const keep = Math.max(0, committed + 1); seek(Math.min(keep, B - 1)); }
      hud();
      draw();
    }
    self.setSkin = (skin) => setSkin(skin, false);
    self.play = (user) => {
      if (user) for (const s of all) if (s !== self) s.pause();
      all.add(self);
      paused = false; last = 0;
      if (!raf && started) raf = requestAnimationFrame(tick);
      box.classList.add("stg-on");
      hud();
    };
    self.pause = () => { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; hud(); };
    self.seek = (j) => { seek(j); };
    self.playing = () => !paused;
    self.suspend = (on) => {
      offscreen = on;
      if (!on && !paused && !raf && started) { last = 0; raf = requestAnimationFrame(tick); }
    };
    self.destroy = () => {
      self.pause(); all.delete(self);
      cv.remove(); box.classList.remove("stg-on");
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      if (io) io.disconnect();
      if (hudEl) hudEl.innerHTML = "";
      if (capEl) capEl.innerHTML = "";
    };
    const onResize = () => layout();
    const onVis = () => { hidden = document.hidden; if (!hidden && !paused && !raf && started) { last = 0; raf = requestAnimationFrame(tick); } };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    const io = "IntersectionObserver" in window ? new IntersectionObserver((e) => self.suspend(!e[0].isIntersecting), { threshold: 0.12 }) : null;
    if (io) io.observe(box);
    buildHud();
    return self;
  }

  window.KitionStage = KitionStage;
})();
