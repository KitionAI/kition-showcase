// The replay stage: plays a sample's build trace (tools/trace.mjs) over its picture. Frame 00 is the
// document before its first step; each beat an actor goes to the places that beat really changed
// (the pixel difference of the kit's own renders), works there, and the kit's render after the beat
// shows through inside those places. A paged trace (slides, document pages) flips to the page a beat
// is on first. Skins: a swarm of cursors, a neon spider, a squid. No dependencies; one canvas over
// the picture, which the stage draws itself: fitted to the box, a tall page larger than the box and
// panned to where the work is.
//
//   const stage = KitionStage(box, img, { skin, colors, color, hud, cap, note, onBeat, onEnd, onHud, actors, dpr });
//   (`actors`: at most so many cursors; `dpr`: at most this pixel ratio. Both for small stages.)
//   stage.load(replayUrl)   replayUrl ends in "/": it holds trace.json and frames/
//   stage.play(), .pause(), .seek(beat), .setSkin(skin), .state(), .destroy()
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
  const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const dir = (a, l) => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const alpha = (hex, a) => "rgba(" + rgb(hex).join(",") + "," + a + ")";
  const light = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140; };
  const near = (r, p) => ({ x: clamp(p.x, r.x, r.x + r.w), y: clamp(p.y, r.y, r.y + r.h) });
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const corners = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

  // How long a mark's gesture lasts (ms), and whether a solid block (or ink) covers the change first.
  const WORK = { create: 1150, style: 1050, text: 1200, modify: 850, move: 950, delete: 850, select: 750, structure: 1300 };
  const BLOCK = { create: 1, style: 1, move: 1, modify: 0, delete: 0, select: 0, text: 0, structure: 0 };
  const FLIP = 560; // a page flip, ms

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
    // W, H: the box. win: where the document may show. doc: the document now (may pass the window
    // when panned). S: the box's shorter side, which the actors are sized by.
    let W = 0, H = 0, S = 1, dpr = 1, win = { x: 0, y: 0, w: 1, h: 1 }, doc = { x: 0, y: 0, w: 1, h: 1 }, cam = 0, camGoal = 0, camV = 0, pan = false, intro = null;
    let base = "", pics = {}, beats = [], B = 0;
    let now = 0, last = 0, raf = 0, paused = true, hidden = false, offscreen = false, ended = false, endAt = 0, endFired = false, started = false, loading = 0;
    let committed = -1, next = 0, shown = -1, lastStart = -1e9, baseName = "", prevName = "", baseAt = -1e9, page = 0, flip = null;
    let marks = [], ripples = [], web = [], built = [], actors = [], job = null, hudEl = null, capEl = null;

    // ---------- Geometry ----------

    function fit() {
      const cs = getComputedStyle(box);
      const px = (k) => parseFloat(cs[k]) || 0;
      win = { x: px("paddingLeft"), y: px("paddingTop"), w: Math.max(1, W - px("paddingLeft") - px("paddingRight")), h: Math.max(1, H - px("paddingTop") - px("paddingBottom")) };
      const r = self.trace.size[0] / self.trace.size[1];
      let w = Math.min(win.w, win.h * r);
      pan = false;
      // A tall page in a wide box: larger than the box (at least ~58% of it shows), panned to the work.
      if (w < win.w * 0.55) {
        const big = Math.min(win.w * 0.66, (win.h / 0.58) * r);
        if (big / r > win.h + 2) { w = big; pan = true; }
      }
      const h = w / r;
      return { x: win.x + (win.w - w) / 2, y: pan ? win.y : win.y + (win.h - h) / 2, w, h };
    }
    function layout() {
      const b = box.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      const old = W ? { x: doc.x, y: doc.y, w: doc.w } : null;
      W = b.width; H = b.height; S = Math.min(W, H);
      dpr = Math.min(opts.dpr || 2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      if (!self.trace) return;
      const f = fit();
      cam = clamp(cam * (f.h / (doc.h || f.h)), 0, Math.max(0, f.h - win.h)); camGoal = cam;
      doc = { x: f.x, y: f.y - cam, w: f.w, h: f.h };
      if (old && actors.length) move(old, doc);
      draw();
    }
    // Everything on the stage follows the document from one place and size to another.
    function move(o, n) {
      const k = n.w / o.w;
      if (Math.abs(k - 1) < 1e-4 && Math.abs(n.x - o.x) < 0.01 && Math.abs(n.y - o.y) < 0.01) return;
      const m = (p) => { if (p) { p.x = n.x + (p.x - o.x) * k; p.y = n.y + (p.y - o.y) * k; } };
      const mp = (q) => { if (q) { const a = { x: q.x0, y: q.y0 }, b = { x: q.x1, y: q.y1 }, c = { x: q.cx, y: q.cy }; m(a); m(b); m(c); q.x0 = a.x; q.y0 = a.y; q.x1 = b.x; q.y1 = b.y; q.cx = c.x; q.cy = c.y; } };
      for (const a of actors) {
        m(a); mp(a.path); m(a.home);
        if (a.size) a.size *= k;
        if (a.feet) a.feet.forEach((f) => { m(f); if (f.sw) { m(f.sw.a); m(f.sw.b); } m(f.grab); });
        if (a.arms) a.arms.forEach((f) => { m(f); m(f.grab); f.len *= k; });
      }
      if (job) job.stops.forEach((s) => { m(s.at); s.grabs.forEach((g) => m(g.p)); });
      ripples.forEach(m);
    }
    // A trace rectangle (document px) on the stage.
    const toStage = (rect) => {
      const sx = doc.w / self.trace.size[0], sy = doc.h / self.trace.size[1];
      return { x: doc.x + rect[0] * sx, y: doc.y + rect[1] * sy, w: Math.max(3, rect[2] * sx), h: Math.max(3, rect[3] * sy) };
    };
    const inside = (p, m) => ({ x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m) });
    // The document seen through the window (the whole of it unless panned).
    const seen = () => ({ x: doc.x, y: Math.max(doc.y, win.y), w: doc.w, h: Math.min(doc.y + doc.h, win.y + win.h) - Math.max(doc.y, win.y) });
    // The camera of a panned page: it keeps the places being worked on in view.
    function camera(dt) {
      if (!pan) return;
      const live = marks.filter((m) => m.kind !== "structure" && (m.t0 < 0 || now < m.t0 + m.dur));
      if (live.length) {
        const ys = live.map((m) => m.rect[1] * (doc.h / self.trace.size[1])), ye = live.map((m) => (m.rect[1] + m.rect[3]) * (doc.h / self.trace.size[1]));
        const lo = Math.min(...ys), hi = Math.max(...ye);
        const mid = hi - lo < win.h * 0.8 ? (lo + hi) / 2 : lo + win.h * 0.4;
        camGoal = clamp(mid - win.h * 0.46, 0, doc.h - win.h);
      }
      const s = dt / 1000, k = 26;
      camV += (k * (camGoal - cam) - 2 * Math.sqrt(k) * camV) * s;
      const c = clamp(cam + camV * s, 0, doc.h - win.h);
      if (Math.abs(c - cam) > 0.01) { const o = { x: doc.x, y: doc.y, w: doc.w }; cam = c; doc = { x: doc.x, y: win.y - cam, w: doc.w, h: doc.h }; move(o, doc); }
    }

    // ---------- Frames ----------

    function pic(name) {
      if (!name) return null;
      if (!pics[name]) {
        const im = new Image();
        im.decoding = "async";
        const f = (pics[name] = { im, ready: false });
        im.onload = () => { f.ready = true; if (paused || !raf) draw(); };
        im.src = base + name;
      }
      return pics[name];
    }
    const ready = (name) => { const f = pic(name); return Boolean(f && f.ready); };
    // The picture a beat starts from: its page before it when it moves to another page, else the
    // picture after the beat before it.
    const before = (j) => beats[j].base || (j > 0 ? beats[j - 1].frame : self.trace.frame0);
    const pageOf = (j) => (beats[j] && beats[j].page) || 0;
    function warm(j) { for (let k = j; k <= Math.min(B - 1, j + 3); k++) { pic(beats[k].frame); pic(beats[k].base); } }

    // ---------- Marks: the feedback on a changed place ----------

    function mark(j, rect, kind, color, from) {
      const m = { j, rect, kind, color, t0: -1, dur: (WORK[kind] || 900) * (self.skin === "cursors" ? 1.3 : 1), from: from || "l", pt: null, seed: (j * 7919 + marks.length * 104729) | 0 };
      marks.push(m);
      return m;
    }
    function startMark(m, pt) {
      if (m.t0 >= 0) return;
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
    // A beat's marks; the cursors split a large place among a few of them.
    function beatMarks(j, color) {
      const b = beats[j], [dw, dh] = self.trace.size;
      if (b.kind === "structure" || !b.targets.length) return [mark(j, [0, 0, dw, dh], "structure", color)];
      const out = [];
      b.targets.forEach((t) => {
        const [x, y, w, h] = t.rect;
        let n = 1;
        if (self.skin === "cursors" && b.kind !== "text") n = w * h > dw * dh * 0.16 || Math.max(w / dw, h / dh) > 0.5 ? (w * h > dw * dh * 0.4 ? 3 : 2) : 1;
        if (b.targets.length > 2) n = Math.min(n, 2);
        for (let i = 0; i < n; i++) out.push(mark(j, w >= h ? [x + (w * i) / n, y, w / n, h] : [x, y + (h * i) / n, w, h / n], b.kind, color));
      });
      return out;
    }
    function beginBeat(j) {
      lastStart = now; next = j + 1;
      warm(j + 1);
      shown = j;
      hud();
      if (opts.onBeat) opts.onBeat(j, beats[j], self.trace);
    }
    // A beat on another page waits for everything before it, then the page flips; true when the
    // beat can start.
    function pageReady(j) {
      if (!self.trace.paged || pageOf(j) === page) return !flip;
      if (committed < j - 1 || flip) return false;
      if (!ready(before(j)) || !ready(baseName)) return false;
      flip = { from: baseName, to: before(j), t0: now };
      page = pageOf(j); baseName = before(j); prevName = ""; baseAt = -1e9; cam = camGoal = 0; camV = 0;
      if (pan) { const o = { x: doc.x, y: doc.y, w: doc.w }; doc = { x: doc.x, y: win.y, w: doc.w, h: doc.h }; move(o, doc); }
      hud();
      return false;
    }
    const canStart = () => next < B && ready(beats[next].frame) && ready(before(next)) && pageReady(next);

    // ---------- Cursors ----------

    const CURSOR = new Path2D("M0 0L0 17.5L4.6 13.4L7.6 20.4L10.6 19.1L7.7 12.3L13.4 12.1Z");
    function makeCursors() {
      const n = Math.min(opts.actors || 10, W < 520 ? 6 : W < 640 ? 8 : 10);
      const start = Math.max(0, colors.indexOf(kitColor));
      actors = [];
      for (let i = 0; i < n; i++) {
        const color = i === 0 ? kitColor : colors[(start + i * 5) % colors.length];
        actors.push({ x: 0, y: 0, vx: 0, vy: 0, color, name: "agent-" + String(i + 1).padStart(2, "0"), tasks: [], task: null, phase: "idle", seed: i * 1.7 + 0.3, home: null, side: 1, up: false, flipAt: 0, wait: 0 });
      }
      actors.forEach((a, i) => { a.home = homeOf(a, i); a.x = a.home.x; a.y = a.home.y; });
    }
    // Where an idle cursor waits: by a place already built (a corner of it, just outside), else
    // along the inside of the document's edge.
    function homeOf(a, i) {
      const r = rng((i + 1) * 7331 + built.length * 17)();
      const s = seen();
      if (built.length) {
        const rect = toStage(built[(built.length - 1 - (i % Math.min(built.length, 5)) + built.length) % built.length]);
        const c = corners(rect)[(i + Math.floor(i / 5)) % 4], k = centre(rect);
        const off = 12 + r * 16;
        return inside({ x: clamp(c.x + Math.sign(c.x - k.x || 1) * off, s.x + 6, s.x + s.w - 6), y: clamp(c.y + Math.sign(c.y - k.y || 1) * off, s.y + 6, s.y + s.h - 6) }, 12);
      }
      const t = (i + 0.5) / actors.length;
      const e = i % 2 ? s.y + s.h - 26 - r * 18 : s.y + 10 + r * 18;
      return inside({ x: s.x + s.w * (0.06 + t * 0.82), y: e }, 12);
    }
    function travel(a, to, speed, bend, delay) {
      const d = Math.hypot(to.x - a.x, to.y - a.y);
      const nx = -(to.y - a.y) / (d || 1), ny = (to.x - a.x) / (d || 1);
      a.path = { x0: a.x, y0: a.y, x1: to.x, y1: to.y, cx: (a.x + to.x) / 2 + nx * d * bend, cy: (a.y + to.y) / 2 + ny * d * bend, t0: now + (delay || 0), dur: clamp(speed[0] + d * speed[1], speed[2], speed[3]) };
    }
    function pathAt(p, t) {
      const u = 1 - t;
      return { x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1, y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1 };
    }
    function pathGoal(a) {
      const p = a.path;
      const g = pathAt(p, ease(seg(now, p.t0, p.t0 + p.dur)));
      g.done = now >= p.t0 + p.dur;
      return g;
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
      switch (m.kind) {
        case "create": { const q = easeOut(seg(p, 0, 0.38)); return { x: r.x + r.w * q, y: r.y + r.h * q }; }
        case "style": case "move": { const q = ease(seg(p, 0.18, 0.55)); return { x: r.x + r.w * (m.from === "r" ? 1 - q : q), y: r.y + r.h / 2 }; }
        case "text": return { x: r.x + r.w * reveal(m), y: r.y + Math.min(r.h / 2, 10) };
        case "structure": { const s = seen(); return { x: s.x + 10 + s.w * 0.8 * ease(seg(p, 0.05, 0.85)), y: s.y + 10 }; }
        default: { const c = centre(r); return { x: c.x + Math.sin(p * 9) * 2, y: c.y + Math.sin(p * 7) * 2 }; }
      }
    }
    function dispatchCursors() {
      if (now - lastStart < 380 || !canStart()) return;
      const active = new Set(marks.filter((m) => !markDone(m)).map((m) => m.j));
      if (active.size >= 4) return;
      const idle = actors.filter((a) => a.phase === "idle");
      if (!idle.length) return;
      const j = next;
      const ms = beatMarks(j, null);
      const used = [];
      ms.sort((p, q) => p.rect[1] - q.rect[1] || p.rect[0] - q.rect[0]).forEach((m, i) => {
        const at = centre(toStage(m.rect));
        let a = idle.filter((x) => !used.includes(x)).sort((p, q) => dist(p, at) - dist(q, at))[0];
        if (!a) a = used[i % used.length]; else used.push(a);
        m.color = a.color;
        a.tasks.push(m);
      });
      // Arrivals staggered: each cursor sets off a little after the one before.
      used.forEach((a, k) => { a.phase = "busy"; nextTask(a, k * 140); });
      beginBeat(j);
    }
    function nextTask(a, delay) {
      a.task = a.tasks.shift() || null;
      if (!a.task) { a.phase = "idle"; a.home = homeOf(a, actors.indexOf(a)); travel(a, a.home, [500, 0.7, 600, 1200], (a.seed % 1) - 0.5); return; }
      a.phase = "busy"; a.stage = "go";
      travel(a, gestureAt(a.task, 0), [380 + (a.seed % 1) * 260, 0.8, 480, 1250], ((a.seed * 3) % 1) * 0.5 - 0.25, delay || 0);
    }
    // A cursor's tag: [x, y, w, h], on its side of the pointer.
    function tagBox(a, side, up, tw) {
      const th = W < 520 ? 14 : 16;
      return [side > 0 ? a.x + 12 : a.x - tw - 4, up ? a.y - th - 4 : a.y + 19, tw, th];
    }
    const hit = (p, q) => p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3];
    function stepCursors(dt) {
      dispatchCursors();
      for (const a of actors) {
        let g;
        if (a.phase === "busy" && a.task) {
          const m = a.task;
          if (a.stage === "go") {
            g = now < a.path.t0 ? { x: a.x, y: a.y } : pathGoal(a);
            if (g.done && (Math.hypot(a.x - g.x, a.y - g.y) < 5 || now - a.path.t0 - a.path.dur > 300)) { a.stage = "work"; startMark(m, { x: g.x, y: g.y }); }
          } else {
            const p = (now - m.t0) / m.dur;
            g = gestureAt(m, p);
            if (p >= 0.95) { built.push(m.rect); if (built.length > 14) built.shift(); nextTask(a); }
          }
        } else if (a.path) {
          g = pathGoal(a);
          // Waiting: a small drift around home.
          const t = now / 1000 + a.seed * 10;
          if (g.done) g = { x: a.home.x + Math.sin(t * 0.7) * 8 + Math.sin(t * 1.9) * 3, y: a.home.y + Math.cos(t * 0.6) * 6 + Math.sin(t * 2.3) * 2 };
        } else g = a.home;
        spring(a, g, a.phase === "busy" ? 170 : 80, 0.55, dt);
      }
      // Separation: pointers and their tags keep clear of each other; a working cursor hardly moves.
      const small = W < 520;
      ctx.font = "600 " + (small ? 9 : 10) + "px 'JetBrains Mono', ui-monospace, monospace";
      for (const a of actors) { a.tw = a.tw || ctx.measureText(a.name).width + 10; a.box = tagBox(a, a.side, a.up, a.tw); }
      const s = dt / 1000;
      for (let i = 0; i < actors.length; i++) for (let k = i + 1; k < actors.length; k++) {
        const a = actors[i], b = actors[k];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        let f = d < 40 ? (40 - d) / 40 : 0;
        if (hit(a.box, [b.x - 2, b.y - 2, 15, 22]) || hit(b.box, [a.x - 2, a.y - 2, 15, 22]) || hit(a.box, b.box)) f = Math.max(f, 0.35);
        if (!f) continue;
        const wa = a.phase === "busy" ? (a.stage === "work" ? 0.06 : 0.35) : 1, wb = b.phase === "busy" ? (b.stage === "work" ? 0.06 : 0.35) : 1;
        const push = f * 5200 * s;
        a.vx -= (dx / d) * push * wa; a.vy -= (dy / d) * push * wa; b.vx += (dx / d) * push * wb; b.vy += (dy / d) * push * wb;
      }
      for (const a of actors) {
        a.x = clamp(a.x, 6, W - 10); a.y = clamp(a.y, 6, H - 12);
        // The tag flips to the side with room (never clipped), and away from other tags.
        if (now - a.flipAt < 350) continue;
        const score = (side, up) => {
          const t = tagBox(a, side, up, a.tw);
          let n = t[0] < 3 || t[0] + t[2] > W - 3 || t[1] < 3 || t[1] + t[3] > H - 3 ? 10 : 0;
          for (const b of actors) if (b !== a && (hit(t, b.box) || hit(t, [b.x - 2, b.y - 2, 15, 22]))) n++;
          return n + (side < 0 ? 0.1 : 0) + (up ? 0.2 : 0);
        };
        let best = [a.side, a.up], bs = score(a.side, a.up) - 0.5;
        for (const [sd, u] of [[1, false], [-1, false], [1, true], [-1, true]]) { const v = score(sd, u); if (v < bs) { bs = v; best = [sd, u]; } }
        if (best[0] !== a.side || best[1] !== a.up) { a.side = best[0]; a.up = best[1]; a.flipAt = now; }
      }
    }
    function drawCursors() {
      const small = W < 520;
      const s = small ? 0.95 : clamp(S / 420, 1, 1.25);
      ctx.font = "600 " + (small ? 9 : 10) + "px 'JetBrains Mono', ui-monospace, monospace";
      ctx.lineJoin = "round";
      for (const a of actors) {
        const work = a.phase === "busy" && a.stage === "work";
        ctx.save();
        ctx.translate(a.x, a.y); ctx.scale(s, s);
        // A dark outline, the colour, and a light stroke inside: legible on light and dark pages.
        if (work) { ctx.shadowColor = alpha(a.color, 0.9); ctx.shadowBlur = 12; }
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(7,7,12,.9)"; ctx.stroke(CURSOR);
        ctx.shadowBlur = 0;
        ctx.fillStyle = a.color; ctx.fill(CURSOR);
        ctx.save(); ctx.clip(CURSOR); ctx.lineWidth = 2.2; ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.stroke(CURSOR); ctx.restore();
        ctx.restore();
        const [x, y, tw, th] = tagBox(a, a.side, a.up, a.tw || ctx.measureText(a.name).width + 10);
        ctx.globalAlpha = a.phase === "busy" ? 1 : 0.78;
        round(x, y, tw, th, 4);
        ctx.fillStyle = a.color; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(7,7,12,.85)"; ctx.stroke();
        ctx.fillStyle = light(a.color) ? INK : "#fff";
        ctx.fillText(a.name, x + 5, y + (small ? 10.5 : 11.5));
        ctx.globalAlpha = 1;
      }
    }

    // ---------- Spider ----------

    // Four legs a side, front to back. A leg's foot rests in its own sector around the body (REST,
    // radians from the heading, ± SECTOR); the legs step in two alternate groups of four (GROUP).
    const REST = [0.56, 1.18, 1.86, 2.56], SECTOR = 0.3;
    const HIPS = [0.45, 1.0, 1.55, 2.1];
    const GROUP = [0, 1, 0, 1, 1, 0, 1, 0];
    const sideOf = (i) => (i < 4 ? -1 : 1);
    function makeCreature() {
      const s = seen();
      const c = { x: s.x + s.w * 0.84, y: s.y + Math.min(s.h * 0.22, 120), vx: 0, vy: 0, heading: Math.PI * 0.75, turn: 0, path: null, size: 0, bank: 0, pulse: 0 };
      if (self.skin === "spider") {
        // Leg span about a quarter of the stage's shorter side.
        c.size = clamp(S * (S < 360 ? 0.15 : 0.135), 22, 92);
        c.feet = [];
        for (let i = 0; i < 8; i++) { const r = restFoot(c, i); c.feet.push({ x: r.x, y: r.y, sw: null, grab: null }); }
        c.lastGroup = 1; c.ease = 1;
      } else {
        c.size = clamp(S * (S < 360 ? 0.12 : 0.105), 18, 64);
        c.heading = -Math.PI / 2;
        c.arms = [];
        for (let i = 0; i < 10; i++) {
          const b = armBase(c, i);
          c.arms.push({ i, x: b.x, y: b.y + c.size, vx: 0, vy: 0, grab: null, len: c.size * (i >= 8 ? 2.6 : 1.45 + (i % 4 === 1 || i % 4 === 2 ? 0.25 : 0)) });
        }
      }
      actors = [c];
    }
    // The spider's measures: R the rest radius of its feet, l1 and l2 its leg bones, r its body.
    const R = (c) => c.size, L1 = (c) => c.size * 0.9, L2 = (c) => c.size * 0.76, BR = (c) => c.size * 0.23;
    const chest = (c) => ({ x: c.x + Math.cos(c.heading) * BR(c) * 0.4, y: c.y + Math.sin(c.heading) * BR(c) * 0.4 });
    function restFoot(c, i) {
      const o = chest(c), a = c.heading + sideOf(i) * REST[i % 4];
      return { x: o.x + Math.cos(a) * R(c), y: o.y + Math.sin(a) * R(c) };
    }
    function hipOf(c, i) {
      const o = chest(c), a = c.heading + sideOf(i) * HIPS[i % 4];
      return { x: o.x + Math.cos(a) * BR(c) * 0.75, y: o.y + Math.sin(a) * BR(c) * 0.62 };
    }
    // Two-bone inverse kinematics in the leg's upright plane, seen from above: the knee rises over
    // the line from hip to foot (so legs never cross the body or each other), leaning a little
    // forward on the front legs and back on the hind ones. Returns the knee and its height (0..1).
    function knee(c, hip, foot, i) {
      const l1 = L1(c), l2 = L2(c);
      const dx = foot.x - hip.x, dy = foot.y - hip.y;
      const d0 = Math.hypot(dx, dy) || 1;
      const d = clamp(d0, Math.abs(l1 - l2) + 1, l1 + l2 - 0.01);
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const ux = dx / d0, uy = dy / d0, lean = h * [0.2, 0.05, 0.04, 0.12][i % 4];
      // Perpendicular toward the leg's side and forward (front legs) or back (hind legs).
      const f = i % 4 < 2 ? 1 : -1, sd = sideOf(i), hx = Math.cos(c.heading), hy = Math.sin(c.heading);
      let px = -uy, py = ux;
      if (px * (hx * f - hy * sd) + py * (hy * f + hx * sd) < 0) { px = -px; py = -py; }
      return { x: hip.x + ux * a + px * lean, y: hip.y + uy * a + py * lean, h: h / l1 };
    }
    // The spider's work for a beat: stops, each a place to stand and the corners its feet plant on.
    function spiderStops(c, rects) {
      const reach = R(c) * 1.02;
      const stops = [];
      let from = { x: c.x, y: c.y };
      const left = rects.slice();
      while (left.length) {
        left.sort((p, q) => dist(near(p, from), from) - dist(near(q, from), from));
        const r = left.shift();
        let best = null;
        // Stand off one side so both its corners are a leg away; a long side gets its nearest corner.
        corners(r).forEach((p1, k) => {
          const p2 = corners(r)[(k + 1) % 4];
          const L = dist(p1, p2), mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const nx = (p2.y - p1.y) / (L || 1), ny = -(p2.x - p1.x) / (L || 1); // outward (corners run clockwise)
          const opts2 = L / 2 < reach * 0.92 ? [{ at: { x: mid.x + nx * Math.sqrt(reach * reach - (L / 2) * (L / 2)) * 0.9, y: mid.y + ny * Math.sqrt(reach * reach - (L / 2) * (L / 2)) * 0.9 }, pts: [p1, p2] }]
            : [p1, p2].map((p) => { const cx = centre(r), a = ang(cx, p); return { at: { x: p.x + Math.cos(a) * reach * 0.8, y: p.y + Math.sin(a) * reach * 0.8 }, pts: [p] }; });
          for (const o of opts2) {
            const q = inside(o.at, BR(c) * 2.4);
            const pts = o.pts.filter((p) => dist(p, q) < reach * 1.3);
            const score = -pts.length * reach * 1.2 + dist(q, o.at) * 2 + dist(q, from) * 0.25;
            if (pts.length && (!best || score < best.score)) best = { at: q, pts, score };
          }
        });
        if (!best) { const q = inside(centre(r), BR(c) * 2.4); best = { at: q, pts: [near(r, q)] }; }
        // Other places within reach of this stop come along, a corner each.
        const extra = [];
        for (let k = left.length - 1; k >= 0 && best.pts.length + extra.length < 4; k--) {
          const p = corners(left[k]).sort((a, b) => dist(a, best.at) - dist(b, best.at))[0];
          if (dist(p, best.at) < reach * 1.15) { extra.push({ p, r: left[k] }); left.splice(k, 1); }
        }
        const pts = best.pts.map((p) => ({ p, r })).concat(extra);
        const mid = pts.reduce((s, g) => ({ x: s.x + g.p.x / pts.length, y: s.y + g.p.y / pts.length }), { x: 0, y: 0 });
        stops.push({ at: best.at, face: ang(best.at, mid), grabs: pts, rects: [r].concat(extra.map((g) => g.r)) });
        from = best.at;
      }
      return stops;
    }
    // Which legs take which corners: in the same angular order as the corners, so legs never cross.
    function assignLegs(c, face, grabs) {
      const order = [3, 2, 1, 0, 4, 5, 6, 7]; // left back .. left front, right front .. right back
      const legAng = (i) => sideOf(i) * REST[i % 4];
      const gs = grabs.map((g) => ({ g, a: wrap(ang(c.at || c, g.p) - face) })).sort((p, q) => p.a - q.a);
      let best = null;
      const pickFrom = (start, chosen) => {
        if (chosen.length === gs.length) {
          const cost = chosen.reduce((s, i, k) => s + Math.abs(legAng(i) - gs[k].a), 0);
          if (!best || cost < best.cost) best = { cost, legs: chosen.slice() };
          return;
        }
        for (let k = start; k <= order.length - (gs.length - chosen.length); k++) { chosen.push(order[k]); pickFrom(k + 1, chosen); chosen.pop(); }
      };
      pickFrom(0, []);
      return best ? best.legs.map((i, k) => ({ i, g: gs[k].g })) : [];
    }
    function stepSpider(dt) {
      const c = actors[0];
      const s = dt / 1000;
      dispatchCreature();
      // The body: along its path at a pace the legs can keep, facing its way, then the work.
      let want = c.heading;
      if (c.path) {
        const g = pathGoal(c);
        const d = Math.hypot(g.x - c.x, g.y - c.y);
        const vmax = R(c) * 2.7 * s * c.ease;
        const k = d > vmax ? vmax / d : 1;
        const nx = c.x + (g.x - c.x) * k, ny = c.y + (g.y - c.y) * k;
        c.vx = (nx - c.x) / s; c.vy = (ny - c.y) / s;
        c.x = nx; c.y = ny;
        if (d > 0.5) want = Math.atan2(c.vy, c.vx);
        if (g.done && d < 0.5) { c.path = null; c.vx = c.vy = 0; }
      } else { c.vx *= 0.8; c.vy *= 0.8; }
      if (job && job.stop && (job.stop.arrived || job.stop.near)) want = job.stop.face;
      const dh = wrap(want - c.heading);
      c.turn = clamp(dh, -1.3 * s * c.ease, 1.3 * s * c.ease);
      c.heading += c.turn;
      // Feet: swings land, held feet stay on their corners.
      const lead0 = { x: c.vx * 0.09, y: c.vy * 0.09 };
      c.feet.forEach((f, i) => {
        if (!f.sw) return;
        // A stepping foot keeps aiming at its rest spot as the body goes on (a held one at its corner).
        if (!f.grab) { const r = restFoot(c, i); f.sw.b = inside({ x: r.x + lead0.x, y: r.y + lead0.y }, 2); }
        const q = seg(now, f.sw.t0, f.sw.t0 + f.sw.dur);
        const e = ease(q);
        const o = chest(c), lift = Math.sin(q * Math.PI) * R(c) * 0.14;
        const x = lerp(f.sw.a.x, f.sw.b.x, e), y = lerp(f.sw.a.y, f.sw.b.y, e), a = ang(o, { x, y });
        f.x = x + Math.cos(a) * lift; f.y = y + Math.sin(a) * lift; f.lift = Math.sin(q * Math.PI);
        if (q >= 1) { f.x = f.sw.b.x; f.y = f.sw.b.y; f.sw = null; f.lift = 0; }
      });
      const reach = L1(c) + L2(c);
      const lead = { x: c.vx * 0.09, y: c.vy * 0.09 };
      const swing = (i, to, dur) => { const f = c.feet[i]; f.sw = { a: { x: f.x, y: f.y }, b: inside(to, 2), t0: now, dur }; };
      const strain = (i) => {
        const f = c.feet[i], r = restFoot(c, i), o = chest(c);
        const off = Math.abs(wrap(ang(o, f) - (c.heading + sideOf(i) * REST[i % 4])));
        return Math.max(dist(f, r) / R(c), off > SECTOR ? 1 : 0, dist(f, hipOf(c, i)) > reach * 0.94 ? 2 : 0);
      };
      // Stepping: a strained foot steps when the feet beside it (same side, and its partner across)
      // stand; the alternate group is preferred, so the gait reads as two sets of four.
      const swinging = c.feet.filter((f) => f.sw).length;
      const stands = (i) => !c.feet[i].sw;
      const free = (i) => { const k = i % 4, b = i - k; return (k === 0 || stands(b + k - 1)) && (k === 3 || stands(b + k + 1)) && stands((i + 4) % 8); };
      const strains = c.feet.map((f, i) => (f.sw || f.grab ? 0 : strain(i)));
      const fast = Math.hypot(c.vx, c.vy) > R(c) * 1.2;
      const order = strains.map((v, i) => [v + (GROUP[i] !== c.lastGroup ? 0.08 : 0), i]).sort((p, q) => q[0] - p[0]);
      let n = swinging;
      for (const [v, i] of order) {
        if (n >= 4 || v < 0.2) break;
        if (!free(i)) continue;
        const r = restFoot(c, i);
        swing(i, { x: r.x + lead.x, y: r.y + lead.y }, fast ? 85 : 120);
        c.lastGroup = GROUP[i]; n++;
      }
      // The body slows while its feet are strained, so they keep up.
      c.ease = clamp(1.7 - Math.max(...strains), 0.2, 1);
      if (job) runJob(c);
    }
    // ---------- Creatures' jobs (spider and squid) ----------

    function dispatchCreature() {
      if (job && !job.free) return;
      if (!canStart()) return;
      if (job && job.marks.some((m) => m.t0 < 0)) return;
      const c = actors[0];
      const j = next;
      const ms = beatMarks(j, self.skin === "spider" ? CYAN : kitColor);
      const structure = ms[0].kind === "structure";
      const rects = ms.map((m) => Object.assign(toStage(m.rect), { m }));
      let stops;
      if (structure) {
        // A whole-page change: to the nearest spot along the top of the page, facing down it.
        const s = seen(), y = s.y + Math.min(s.h * 0.12, 50);
        const at = [0.25, 0.5, 0.75].map((f) => inside({ x: s.x + s.w * f, y }, c.size)).sort((p, q) => dist(p, c) - dist(q, c))[0];
        stops = [{ at, face: Math.PI / 2, grabs: [], rects: [] }];
      } else stops = self.skin === "spider" ? spiderStops(c, rects) : squidStops(c, rects);
      ms.forEach((m) => { const r = toStage(m.rect), k = centre(r), a = stops[0].at; m.from = Math.abs(a.x - k.x) / r.w > Math.abs(a.y - k.y) / r.h ? (a.x < k.x ? "l" : "r") : a.y < k.y ? "t" : "b"; });
      if (job) release(c);
      job = { j, marks: ms, stops, k: -1, stop: null, structure, free: false };
      nextStop(c);
      beginBeat(j);
    }
    function nextStop(c) {
      job.k++;
      job.stop = job.stops[job.k] || null;
      if (!job.stop) { job.free = true; return; }
      job.stop.arrived = false;
      travel(c, job.stop.at, self.skin === "spider" ? [260, 1.1, 300, 1600] : [420, 1.0, 520, 1400], self.skin === "spider" ? 0.08 : 0.3);
    }
    function release(c) {
      if (c.feet) c.feet.forEach((f) => (f.grab = null));
      if (c.arms) c.arms.forEach((a) => (a.grab = null));
    }
    function runJob(c) {
      const st = job.stop;
      if (!st) {
        if (job.marks.every((m) => markDone(m))) job = null;
        return;
      }
      const spider = self.skin === "spider";
      if (!st.arrived) {
        const end = c.path ? c.path.t0 + c.path.dur : 0;
        const there = now > end && (dist(c, st.at) < (spider ? 3 : 8) || (!spider && now > end + 450));
        if (there && !st.near) st.near = now;
        if (there && (!spider || Math.abs(wrap(st.face - c.heading)) < 0.25 || now - st.near > 500)) {
          st.arrived = true; st.t0 = now;
          if (spider) {
            assignLegs(c, st.face, st.grabs).forEach(({ i, g }, k) => {
              const f = c.feet[i], hip = hipOf(c, i), reach = (L1(c) + L2(c)) * 0.97;
              const p = dist(hip, g.p) > reach ? { x: hip.x + ((g.p.x - hip.x) * reach) / dist(hip, g.p), y: hip.y + ((g.p.y - hip.y) * reach) / dist(hip, g.p) } : g.p;
              f.grab = { x: p.x, y: p.y };
              f.sw = { a: { x: f.x, y: f.y }, b: { x: p.x, y: p.y }, t0: now + k * 60, dur: 210 };
            });
          } else grabSquid(c, st);
        }
        if (job.structure && st === job.stops[0] && c.path && now > c.path.t0 + c.path.dur * 0.6) job.marks.forEach((m) => startMark(m, null));
        return;
      }
      const t = now - st.t0;
      // The marks of this stop's places start as the feet (or tentacles) land.
      if (t > (spider ? 250 : 320) && !st.worked) {
        st.worked = true;
        const mine = job.structure ? job.marks : st.rects.map((r) => r.m);
        mine.forEach((m, k) => {
          const g = st.grabs.find((x) => x.r.m === m);
          later(() => startMark(m, g ? { x: g.p.x, y: g.p.y } : null), k * 90);
        });
        if (spider) silk(st);
      }
      const hold = job.structure ? 450 : spider ? 460 : 620;
      if (t > hold && st.worked) {
        release(c);
        if (job.k === job.stops.length - 1) { job.marks.forEach((m) => startMark(m, null)); job.stop = null; job.free = true; }
        else nextStop(c);
      }
    }
    let timers = [];
    const later = (fn, ms) => timers.push({ at: now + ms, fn });
    // Silk: each stop ties the corners its feet hold, and a drag line from the stop before.
    const docPt = (p) => ({ u: (p.x - doc.x) / doc.w, v: (p.y - doc.y) / doc.h });
    function silk(st) {
      const pts = st.grabs.map((g) => docPt(g.p));
      const prev = web.length ? web[web.length - 1].b : null;
      if (prev && pts.length) web.push({ a: prev, b: pts[0], t0: now });
      for (let k = 1; k < pts.length; k++) web.push({ a: pts[k - 1], b: pts[k], t0: now });
      if (!prev && pts.length) web.push({ a: docPt(st.at), b: pts[0], t0: now });
      while (web.length > 40) web.shift();
    }
    function drawWeb() {
      if (!web.length) return;
      const fin = ended ? easeOut(seg(now, endAt, endAt + 900)) : 0;
      ctx.save();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "rgba(200,245,255," + (0.2 + fin * 0.16) + ")";
      ctx.shadowColor = "rgba(70,241,255,.8)"; ctx.shadowBlur = 4;
      ctx.beginPath();
      const at = (p) => ({ x: doc.x + p.u * doc.w, y: doc.y + p.v * doc.h });
      const drops = [];
      for (const s of web) {
        const a = at(s.a), b = at(s.b);
        const q = easeOut(seg(now, s.t0, s.t0 + 420));
        const e = { x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q) };
        const sag = Math.min(14, dist(a, e) * 0.06);
        const m = { x: (a.x + e.x) / 2, y: (a.y + e.y) / 2 + sag };
        ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(m.x, m.y, e.x, e.y);
        if (q >= 1) drops.push({ x: (a.x + 2 * m.x + e.x) / 4, y: (a.y + 2 * m.y + e.y) / 4 });
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Dew on the threads, catching the light at the end.
      ctx.fillStyle = "rgba(220,250,255," + (0.35 + fin * 0.5) + ")";
      ctx.beginPath();
      drops.forEach((p, k) => { const r = 0.9 + fin * (0.6 + 0.6 * Math.sin(now / 240 + k)); ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, TAU); });
      ctx.fill();
      ctx.restore();
    }
    function drawSpider() {
      const c = actors[0];
      drawWeb();
      const lw = clamp(c.size / 42, 1.1, 2.2);
      const legs = c.feet.map((f, i) => { const hip = hipOf(c, i); return { hip, knee: knee(c, hip, f, i), f }; });
      // Working: threads from the spinneret to the held corners.
      const tail = { x: c.x - Math.cos(c.heading) * BR(c) * 2.7, y: c.y - Math.sin(c.heading) * BR(c) * 2.7 };
      if (job && job.stop && job.stop.worked) {
        ctx.lineWidth = 0.7; ctx.strokeStyle = "rgba(200,245,255,.4)";
        ctx.beginPath();
        for (const L of legs) if (L.f.grab && !L.f.sw) { ctx.moveTo(tail.x, tail.y); ctx.lineTo(L.f.x, L.f.y); }
        ctx.stroke();
      }
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // The thigh, raised toward the viewer, is the heavier stroke; the shin and a small hooked foot thinner.
      const hook = (L) => { const a = ang(L.knee, L.f), b = a + (L.f.x - c.x) * Math.sin(c.heading) - (L.f.y - c.y) * Math.cos(c.heading) > 0 ? 0.5 : -0.5; return { x: L.f.x - Math.cos(a + b) * lw * 4, y: L.f.y - Math.sin(a + b) * lw * 4 }; };
      for (const [w, col, thigh] of [[lw * 4.2, "rgba(70,241,255,.14)", 1], [lw * 1.5, CYAN, 1], [lw * 0.95, CYAN, 0]]) {
        ctx.lineWidth = w; ctx.strokeStyle = col;
        ctx.beginPath();
        for (const L of legs) {
          if (thigh) { ctx.moveTo(L.hip.x, L.hip.y); ctx.lineTo(L.knee.x, L.knee.y); }
          if (!thigh || w > lw * 2) { const k = hook(L); ctx.moveTo(L.knee.x, L.knee.y); ctx.lineTo(k.x, k.y); ctx.lineTo(L.f.x, L.f.y); }
        }
        ctx.stroke();
      }
      ctx.fillStyle = MAGENTA; ctx.shadowColor = MAGENTA; ctx.shadowBlur = 8;
      ctx.beginPath();
      const jr = lw * 1.35;
      for (const L of legs) {
        ctx.moveTo(L.knee.x + jr, L.knee.y); ctx.arc(L.knee.x, L.knee.y, jr, 0, TAU);
        const fr = L.f.grab && !L.f.sw ? lw * 1.9 : L.f.lift ? lw * 0.8 : lw * 1.1;
        ctx.moveTo(L.f.x + fr, L.f.y); ctx.arc(L.f.x, L.f.y, fr, 0, TAU);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      // Held corners: a small neon tick.
      ctx.strokeStyle = "rgba(255,63,216,.85)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const L of legs) if (L.f.grab && !L.f.sw) { ctx.moveTo(L.f.x + 5, L.f.y); ctx.arc(L.f.x, L.f.y, 5 + Math.sin(now / 160) * 1, 0, TAU); }
      ctx.stroke();
      // Body: abdomen behind, head in front, a light inside; wireframe lines like the reference.
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.heading);
      const r = BR(c);
      ctx.lineWidth = lw * 0.9;
      ctx.fillStyle = "rgba(10,14,26,.9)"; ctx.strokeStyle = CYAN; ctx.shadowColor = CYAN; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(-r * 1.55, 0, r * 1.35, r * 1.05, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(r * 0.35, 0, r * 0.85, r * 0.72, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      const glow = ctx.createRadialGradient(-r * 1.55, 0, 0, -r * 1.55, 0, r * 1.15);
      const pulse = 0.65 + 0.35 * Math.sin(now / 300);
      glow.addColorStop(0, "rgba(255,255,255," + 0.9 * pulse + ")"); glow.addColorStop(0.35, alpha(MAGENTA, 0.7 * pulse)); glow.addColorStop(1, "rgba(255,63,216,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.ellipse(-r * 1.55, 0, r * 1.15, r * 0.9, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(70,241,255,.55)"; ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      for (const k of [-0.5, 0, 0.5]) { ctx.moveTo(-r * 0.6, k * r * 0.9); ctx.quadraticCurveTo(-r * 1.55, k * r * 1.5, -r * 2.6, k * r * 0.5); }
      ctx.moveTo(r * 1.15, -r * 0.3); ctx.lineTo(r * 1.6, -r * 0.55); ctx.moveTo(r * 1.15, r * 0.3); ctx.lineTo(r * 1.6, r * 0.55);
      ctx.stroke();
      ctx.fillStyle = MAGENTA;
      ctx.beginPath();
      for (const [ex, ey, er] of [[0.95, -0.22, 0.13], [0.95, 0.22, 0.13], [0.75, -0.42, 0.08], [0.75, 0.42, 0.08]]) { ctx.moveTo(r * ex + r * er, r * ey); ctx.arc(r * ex, r * ey, Math.max(0.8, r * er), 0, TAU); }
      ctx.fill();
      ctx.restore();
    }

    // ---------- Squid ----------

    // The squid swims mantle first; its arms leave from the head, behind. heading: the mantle's tip.
    function armBase(c, i) {
      const h = { x: c.x - Math.cos(c.heading) * c.size * 0.55, y: c.y - Math.sin(c.heading) * c.size * 0.55 };
      const t = i >= 8 ? (i === 8 ? -0.18 : 0.18) : (i / 7 - 0.5) * 0.9;
      const px = -Math.sin(c.heading), py = Math.cos(c.heading);
      return { x: h.x + px * t * c.size * 0.42, y: h.y + py * t * c.size * 0.42 };
    }
    const head = (c) => ({ x: c.x - Math.cos(c.heading) * c.size * 0.55, y: c.y - Math.sin(c.heading) * c.size * 0.55 });
    // Passes: the places one hover can reach with the arms; the body waits beside them, not on them.
    function squidStops(c, rects) {
      const maxLen = c.size * 2.3;
      const left = rects.slice().sort((p, q) => p.x - q.x || p.y - q.y);
      const stops = [];
      const mid = centre(seen());
      const plan = (group) => {
        const cx = group.reduce((a, r) => a + r.x + r.w / 2, 0) / group.length, cy = group.reduce((a, r) => a + r.y + r.h / 2, 0) / group.length;
        const span = Math.max(group.reduce((a, r) => Math.max(a, r.x + r.w), -Infinity) - group.reduce((a, r) => Math.min(a, r.x), Infinity), group.reduce((a, r) => Math.max(a, r.y + r.h), -Infinity) - group.reduce((a, r) => Math.min(a, r.y), Infinity));
        // Off the places, toward the middle of the page (or above them), arms toward them.
        const a = dist({ x: cx, y: cy }, mid) < 20 ? -Math.PI / 2 : ang({ x: cx, y: cy }, mid);
        const off = Math.min(span / 2, maxLen * 0.5) + c.size * 1.5;
        const at = inside({ x: cx + Math.cos(a) * off, y: cy + Math.sin(a) * off }, c.size * 1.2);
        const hd = { x: at.x - Math.cos(a) * c.size * 0.55, y: at.y - Math.sin(a) * c.size * 0.55 };
        const grabs = group.map((r) => ({ p: near({ x: r.x + r.w * 0.15, y: r.y + r.h * 0.15, w: r.w * 0.7, h: r.h * 0.7 }, hd), r }));
        return { at, face: a, grabs, rects: group, ok: grabs.every((g) => dist(g.p, hd) < maxLen * 0.95) };
      };
      // Places too far apart for one hover are handled in more than one pass.
      while (left.length) {
        let group = [left.shift()];
        for (let k = 0; k < left.length && group.length < 4; k++) {
          if (plan(group.concat([left[k]])).ok) { group = group.concat([left[k]]); left.splice(k, 1); k--; }
        }
        stops.push(plan(group));
      }
      return stops;
    }
    function grabSquid(c, st) {
      // Two arms on each place when there are few, else one; the long tentacles take the farthest.
      const per = st.grabs.length <= 2 ? 2 : 1;
      const free = c.arms.slice();
      const byFar = st.grabs.slice().sort((p, q) => dist(q.p, c) - dist(p.p, c));
      byFar.forEach((g, n) => {
        for (let k = 0; k < per; k++) {
          const rr = toStage(g.r.m.rect);
          const off = per === 1 ? 0 : (k ? 1 : -1) * Math.min(rr.w, rr.h) * 0.18;
          const p = { x: clamp(g.p.x + off, rr.x, rr.x + rr.w), y: clamp(g.p.y - off * 0.5, rr.y, rr.y + rr.h) };
          free.sort((a, b) => (dist(armBase(c, a.i), p) > a.len ? 1e6 : 0) + dist(armBase(c, a.i), p) - ((dist(armBase(c, b.i), p) > b.len ? 1e6 : 0) + dist(armBase(c, b.i), p)));
          const a = free.shift();
          if (a) a.grab = { x: p.x, y: p.y, t0: now + (n * per + k) * 70 };
        }
      });
    }
    function stepSquid(dt) {
      const c = actors[0];
      const s = dt / 1000;
      dispatchCreature();
      if (job) runJob(c);
      let g = c.path ? pathGoal(c) : { x: c.x, y: c.y + Math.sin(now / 600) * 0.15 };
      const ox = c.x, oy = c.y;
      spring(c, g, 38, 0.7, dt);
      const speed = Math.hypot(c.vx, c.vy);
      // Mantle first while swimming; arms toward the work while working; banking into turns.
      let want = c.heading;
      if (speed > c.size * 0.9) want = Math.atan2(c.vy, c.vx);
      else if (job && job.stop && job.stop.arrived) want = job.stop.face;
      else if (speed < 4) want = lerp(c.heading, c.heading + wrap(-Math.PI / 2 - c.heading), 0.02);
      const turn = clamp(wrap(want - c.heading), -3.4 * s, 3.4 * s);
      c.heading += turn;
      c.bank = lerp(c.bank, clamp((turn / (s || 1)) * 0.16, -0.5, 0.5), Math.min(1, dt / 160));
      // Jet pulses while it swims; a slow breath at rest.
      c.pulse += s * (speed > 30 ? 2.6 : 0.8) * TAU;
      c.x = clamp(c.x, c.size, W - c.size); c.y = clamp(c.y, c.size, H - c.size);
      const mv = { x: c.x - ox, y: c.y - oy };
      for (const a of c.arms) {
        const b = armBase(c, a.i);
        let goal;
        if (a.grab && now >= a.grab.t0) goal = a.grab;
        else {
          // Trailing behind the body, fanned out a little, with a slow wave.
          const t = now / 1000, back = c.heading + Math.PI;
          const fan = a.i >= 8 ? (a.i === 8 ? -0.12 : 0.12) : (a.i / 7 - 0.5) * 0.7;
          const len = a.len * (0.78 + 0.08 * Math.sin(t * 1.6 + a.i));
          goal = { x: b.x + Math.cos(back + fan + Math.sin(t * 1.3 + a.i) * 0.08) * len, y: b.y + Math.sin(back + fan + Math.sin(t * 1.3 + a.i) * 0.08) * len };
        }
        a.x += mv.x * 0.6; a.y += mv.y * 0.6;
        spring(a, goal, a.grab ? 160 : 60, a.grab ? 0.7 : 0.8, dt);
        // A tentacle never stretches past its length.
        const d = dist(a, b);
        if (d > a.len) { a.x = b.x + ((a.x - b.x) * a.len) / d; a.y = b.y + ((a.y - b.y) * a.len) / d; }
      }
    }
    // A tentacle: from its base to its tip; slack sags it to one side, and a small wave runs along it.
    function drawArm(c, a, fill, wid) {
      const b = armBase(c, a.i);
      const d = Math.max(1, dist(a, b));
      const ux = (a.x - b.x) / d, uy = (a.y - b.y) / d;
      const side = a.i >= 8 ? (a.i === 8 ? -1 : 1) : a.i < 4 ? -1 : 1;
      const slack = Math.sqrt(Math.max(0, a.len * a.len - d * d)) * 0.42 * side;
      const t = now / 1000, amp = Math.min(d, a.len) * (a.grab ? 0.025 : 0.06);
      const N = 16, L = [], Rr = [];
      let px = b.x, py = b.y;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const off = slack * 4 * u * (1 - u) * (1 - u * 0.4) + amp * Math.sin(u * 7.5 - t * 5 + a.i) * u;
        const x = b.x + ux * d * u - uy * off, y = b.y + uy * d * u + ux * off;
        const tx = x - px || ux, ty = y - py || uy, n = Math.hypot(tx, ty) || 1;
        const w = lerp(wid, 0.7, Math.pow(u, 0.75));
        L.push({ x: x - (ty / n) * w, y: y + (tx / n) * w }); Rr.push({ x: x + (ty / n) * w, y: y - (tx / n) * w });
        px = x; py = y;
      }
      ctx.beginPath();
      ctx.moveTo(L[0].x, L[0].y);
      for (const p of L) ctx.lineTo(p.x, p.y);
      for (let k = Rr.length - 1; k >= 0; k--) ctx.lineTo(Rr[k].x, Rr[k].y);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = "rgba(255,210,245,.5)"; ctx.stroke();
      if (a.grab && now >= a.grab.t0) {
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.beginPath();
        for (let k = 0; k < 4; k++) { const p = L[N - 1 - k * 2]; ctx.moveTo(p.x + 1.1, p.y); ctx.arc(p.x, p.y, 1.1, 0, TAU); }
        ctx.fill();
      }
    }
    function drawSquid() {
      const c = actors[0];
      const r = c.size;
      ctx.shadowColor = "rgba(255,100,200,.5)"; ctx.shadowBlur = 10;
      for (const a of c.arms) drawArm(c, a, a.i >= 8 ? "#b46cf0" : a.i % 2 ? "#e46ad8" : "#d860d4", r * (a.i >= 8 ? 0.07 : 0.1));
      ctx.shadowBlur = 0;
      const p = Math.sin(c.pulse);
      const sw = 1 - p * 0.09 - Math.abs(c.bank) * 0.35, sl = 1 + p * 0.05;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.heading); ctx.scale(sl, sw);
      // Mantle along +x: the tip with its two fins ahead, the head (eyes) behind.
      const body = ctx.createLinearGradient(r * 1.1, 0, -r * 0.7, 0);
      body.addColorStop(0, "#ffb3e6"); body.addColorStop(0.5, "#ff64c8"); body.addColorStop(1, "#7a5cf0");
      ctx.beginPath();
      ctx.moveTo(r * 1.2, 0);
      ctx.bezierCurveTo(r * 0.9, -r * 0.2, r * 0.2, -r * 0.36, -r * 0.45, -r * 0.3);
      ctx.quadraticCurveTo(-r * 0.68, -r * 0.24, -r * 0.68, 0);
      ctx.quadraticCurveTo(-r * 0.68, r * 0.24, -r * 0.45, r * 0.3);
      ctx.bezierCurveTo(r * 0.2, r * 0.36, r * 0.9, r * 0.2, r * 1.2, 0);
      const fin = 1 + Math.sin(now / 180) * 0.12;
      for (const sg of [-1, 1]) { ctx.moveTo(r * 1.12, 0); ctx.quadraticCurveTo(r * 0.85, sg * r * 0.55 * fin, r * 0.45, sg * r * 0.22); ctx.lineTo(r * 0.85, sg * r * 0.08); }
      ctx.fillStyle = body; ctx.shadowColor = "rgba(255,100,200,.7)"; ctx.shadowBlur = 14; ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 1.1; ctx.strokeStyle = "rgba(255,225,245,.9)"; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.beginPath(); ctx.ellipse(r * 0.3, -r * 0.12, r * 0.45, r * 0.06, 0, 0, TAU); ctx.fill();
      // Chromatophores, pulsing with the jet.
      ctx.fillStyle = "rgba(122,40,160," + (0.25 + 0.2 * p) + ")";
      ctx.beginPath();
      for (const [x, y] of [[0.6, 0.08], [0.25, -0.15], [0.05, 0.14], [-0.2, -0.05], [0.42, 0.18]]) { ctx.moveTo(r * x + r * 0.04, r * y); ctx.arc(r * x, r * y, r * 0.04, 0, TAU); }
      ctx.fill();
      // Eyes, looking where it works.
      const look = job && job.stop && job.stop.grabs.length ? job.stop.grabs[0].p : null;
      const la = look ? wrap(ang(c, look) - c.heading) : Math.PI;
      for (const sg of [-1, 1]) {
        const ex = -r * 0.5, ey = sg * r * 0.2;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.11, r * 0.1, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ex + Math.cos(la) * r * 0.035, ey + Math.sin(la) * r * 0.035, r * 0.06, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // ---------- Drawing ----------

    function round(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function drawPic(name, a, r) {
      const f = pics[name];
      if (!f || !f.ready || a <= 0) return false;
      r = r || doc;
      ctx.globalAlpha = a;
      ctx.drawImage(f.im, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      return true;
    }
    // The document's rectangle while it settles from the picture's place into the stage's.
    function docAt() {
      if (!intro) return doc;
      const q = ease(seg(now, intro.t0, intro.t0 + 650));
      if (q >= 1) { intro = null; return doc; }
      const o = intro.from;
      return { x: lerp(o.x, doc.x, q), y: lerp(o.y, doc.y, q), w: lerp(o.w, doc.w, q), h: lerp(o.h, doc.h, q) };
    }
    function drawDoc() {
      const d = docAt();
      ctx.save();
      if (pan) { ctx.beginPath(); ctx.rect(win.x - 40, win.y, win.w + 80, win.h); ctx.clip(); }
      if (flip) {
        // A page flip: the page turns edge-on, the next one turns in.
        const p = (now - flip.t0) / FLIP;
        if (p >= 1) flip = null;
        else {
          const out = p < 0.5, q = out ? ease(p * 2) : ease((p - 0.5) * 2);
          const sx = out ? 1 - q : q, w = d.w * Math.max(0.02, sx);
          const r = { x: d.x + (d.w - w) / 2 + (out ? -1 : 1) * (1 - sx) * d.w * 0.12, y: d.y, w, h: d.h };
          ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 24;
          drawPic(out ? flip.from : flip.to, 1, r);
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(7,7,12," + (out ? q : 1 - q) * 0.5 + ")";
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.restore();
          return;
        }
      }
      const fade = easeOut(seg(now, baseAt, baseAt + 320));
      if (fade < 1 && prevName) drawPic(prevName, 1, d);
      // A picture not decoded yet keeps the one before it on screen.
      if (!drawPic(baseName, fade < 1 && prevName ? fade : 1, d) && !(prevName && drawPic(prevName, 1, d))) drawPic(self.trace.frame0, 1, d);
      for (const m of marks) {
        // The beat just committed keeps its places drawn while the whole frame fades in under them.
        if (m.j < committed || (m.j === committed && fade >= 1)) continue;
        const a = reveal(m);
        if (a <= 0) continue;
        ctx.save();
        if (m.kind !== "structure") {
          const r = toStage(m.rect);
          ctx.beginPath();
          if (m.kind === "text") ctx.rect(r.x - 1, r.y - 1, (r.w + 2) * a, r.h + 2); else ctx.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
          ctx.clip();
        }
        drawPic(beats[m.j].frame, m.kind === "text" ? 1 : a, d);
        ctx.restore();
      }
      ctx.restore();
      // A panned page fades out at the window's edges where it goes on.
      if (pan) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        for (const [y0, y1, more] of [[win.y, win.y + 36, doc.y < win.y - 1], [win.y + win.h, win.y + win.h - 36, doc.y + doc.h > win.y + win.h + 1]]) {
          if (!more) continue;
          const g = ctx.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g; ctx.fillRect(doc.x - 2, Math.min(y0, y1), doc.w + 4, 36);
        }
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
      const spider = self.skin === "spider";
      if (m.kind === "structure") {
        if (p > 1) return;
        const s = seen();
        const y = s.y + s.h * ease(seg(p, 0.05, 0.85));
        const g = ctx.createLinearGradient(0, y - 60, 0, y);
        g.addColorStop(0, alpha(col, 0)); g.addColorStop(1, alpha(col, 0.35));
        ctx.fillStyle = g; ctx.fillRect(s.x, Math.max(s.y, y - 60), s.w, Math.min(60, y - s.y));
        ctx.fillStyle = "#fff"; ctx.fillRect(s.x, y, s.w, 1.5);
        neonRect(s, col, (1 - seg(p, 0.7, 1)) * 0.9, 0);
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
      neonRect(o, spider ? CYAN : col, Math.min(1, p * 6) * fadeOut, spider ? MAGENTA : "#fff");
      if (p > 1) return;
      ctx.save();
      if (self.skin === "squid" && m.kind !== "text") { ctx.beginPath(); ctx.rect(r0.x - 8, r0.y - 8, r0.w + 16, r0.h + 16); ctx.clip(); ink(m, r0, p); }
      else {
        ctx.beginPath(); ctx.rect(r0.x, r0.y, r0.w, r0.h); ctx.clip();
        if (BLOCK[m.kind]) block(m, r0, p, spider ? kitColor : col);
        else if (m.kind === "select") { const x = r0.x + r0.w * ease(seg(p, 0.1, 0.8)); ctx.fillStyle = alpha(col, 0.3); ctx.fillRect(r0.x, r0.y, x - r0.x, r0.h); ctx.fillStyle = col; ctx.fillRect(x - 1, r0.y, 2, r0.h); }
        else if (m.kind === "modify" || m.kind === "delete") { ctx.fillStyle = alpha(col, 0.32 * (1 - seg(p, 0.15, 0.8))); ctx.fillRect(r0.x, r0.y, r0.w, r0.h); }
      }
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
    // Ink: a blot with a lobed edge spreads quickly from the tentacle's tip, then thins out into the
    // new picture; a few droplets fly off its edge.
    function blob(o, rad, rand, k) {
      const ph = [rand() * TAU, rand() * TAU, rand() * TAU], N = 26, pts = [];
      for (let i = 0; i < N; i++) {
        const t = (i / N) * TAU;
        const f = 1 + 0.13 * Math.sin(3 * t + ph[0] + k) + 0.08 * Math.sin(5 * t + ph[1]) + 0.05 * Math.sin(8 * t + ph[2] - k);
        pts.push({ x: o.x + Math.cos(t) * rad * f, y: o.y + Math.sin(t) * rad * f });
      }
      ctx.moveTo((pts[0].x + pts[N - 1].x) / 2, (pts[0].y + pts[N - 1].y) / 2);
      for (let i = 0; i < N; i++) { const a = pts[i], b = pts[(i + 1) % N]; ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2); }
      ctx.closePath();
    }
    function ink(m, r, p) {
      const o = m.pt || centre(r);
      const reach = Math.max(...corners(r).map((q) => dist(o, q)));
      const g = easeOut(seg(p, 0.04, 0.36));
      const a = 1 - seg(p, 0.52, 0.92);
      if (a <= 0 || g <= 0) return;
      const rand = rng(m.seed);
      const wob = now / 400;
      ctx.fillStyle = alpha(kitColor, 0.88 * a);
      ctx.beginPath();
      blob(o, reach * (0.15 + g * 0.95) * (1 + seg(p, 0.52, 0.92) * 0.08), rand, wob);
      ctx.fill();
      ctx.fillStyle = alpha(kitColor, 0.75 * a);
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const t = rand() * TAU, d = reach * (0.5 + rand() * 0.6) * g, rr = reach * (0.04 + rand() * 0.07) * g;
        ctx.moveTo(o.x + Math.cos(t) * d + rr, o.y + Math.sin(t) * d);
        ctx.arc(o.x + Math.cos(t) * d, o.y + Math.sin(t) * d, rr, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255," + 0.16 * a + ")";
      ctx.beginPath(); blob({ x: o.x - reach * g * 0.18, y: o.y - reach * g * 0.2 }, reach * g * 0.22, rng(m.seed + 1), wob); ctx.fill();
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
      if (!self.trace || !W || !ready(self.trace.frame0)) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawDoc();
      if (!flip && !intro) {
        ctx.save();
        if (pan) { ctx.beginPath(); ctx.rect(0, win.y, W, win.h); ctx.clip(); }
        for (const m of marks) drawMark(m);
        ctx.restore();
      }
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
    function step(dt) {
      camera(dt);
      if (intro || flip) return;
      if (self.skin === "cursors") stepCursors(dt); else if (self.skin === "spider") stepSpider(dt); else stepSquid(dt);
    }
    function update(dt) {
      timers = timers.filter((x) => (now >= x.at ? (x.fn(), false) : true));
      step(dt);
      if (ended) {
        if (now - endAt > 3200 && !endFired) {
          endFired = true;
          const again = opts.onEnd ? opts.onEnd(self) : true;
          if (again !== false) seek(0);
        }
        return;
      }
      while (committed + 1 < B) {
        const own = marks.filter((m) => m.j === committed + 1);
        if (!own.length || !own.every(markDone)) break;
        committed++;
        prevName = baseName; baseName = beats[committed].frame; baseAt = now;
        if (self.skin !== "cursors") own.forEach((m) => { built.push(m.rect); if (built.length > 14) built.shift(); });
        if (shown < committed) shown = committed;
        hud();
      }
      marks = marks.filter((m) => m.j > committed || now - (m.t0 + m.dur) < 1200);
      if (committed === B - 1) { ended = true; endAt = now; hud(); }
    }
    function seek(j) {
      j = clamp(j | 0, 0, Math.max(0, B - 1));
      marks = []; ripples = []; timers = []; ended = false; endFired = false; flip = null;
      if (job && actors[0]) release(actors[0]);
      job = null;
      committed = j - 1; next = j; shown = j - 1; lastStart = -1e9;
      page = pageOf(j); baseName = before(j); prevName = ""; baseAt = -1e9;
      if (j === 0) { web = []; built = []; }
      actors.forEach((a, i) => { if (a.tasks) { a.tasks = []; a.task = null; a.phase = "idle"; a.home = homeOf(a, i); travel(a, a.home, [300, 0.5, 300, 700], 0); } });
      pic(baseName); warm(j);
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
        + '<span class="stg-num" aria-live="off"><b>0</b> / <span></span> commands</span><span class="stg-page" hidden></span>'
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
      hudEl.querySelector(".stg-page").hidden = !t.paged;
    }
    function hud() {
      const t = self.trace;
      if (!t) return;
      const i = Math.min(B - 1, Math.max(shown, committed));
      const at = i >= 0 ? beats[i].at : 0;
      const done = committed >= B - 1;
      if (opts.onHud) opts.onHud({ at, commands: t.commands, paused, done, beat: i, beats: B });
      if (!hudEl) return;
      hudEl.querySelector(".stg-num b").textContent = fmt(at);
      hudEl.querySelector(".stg-fill").style.transform = "scaleX(" + (at / t.commands).toFixed(4) + ")";
      hudEl.querySelector(".stg-state").textContent = done ? "done" : paused ? "paused" : "building";
      hudEl.querySelector(".stg-hud").classList.toggle("done", done);
      if (t.paged) hudEl.querySelector(".stg-page").textContent = (t.pageKind || "page") + " " + (page + 1) + " / " + t.pages;
      capEl.querySelector(".stg-capt").textContent = i >= 0 ? beats[i].caption : "Before the first command";
      const ticks = hudEl.querySelectorAll(".stg-tick");
      ticks.forEach((b, k) => { b.classList.toggle("on", k <= committed); b.classList.toggle("now", k === shown && !done); });
      const list = self.skin === "cursors" ? actors : [{ color: self.skin === "spider" ? CYAN : "#ff64c8" }];
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
        self.trace = t; beats = t.beats; B = beats.length; pics = {};
        committed = -1; shown = -1; next = 0; marks = []; job = null;
        // The document settles from where the picture is into the stage's own fit.
        const b = box.getBoundingClientRect(), r = img.getBoundingClientRect();
        W = 0; cam = 0; doc = { x: 0, y: 0, w: 1, h: 1 };
        layout();
        if (r.width > 2 && Math.abs(r.width - doc.w) + Math.abs(r.left - b.left - doc.x) > 8) intro = { from: { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }, t0: now };
        actors = [];
        setSkin(self.skin, true);
        hudTrace();
        seek(0);
        return new Promise((resolve) => {
          const f = pic(t.frame0), g = pic(beats[0].frame);
          const go = () => { if (ticket !== loading) resolve(self); else if (f.ready && g.ready) { started = true; draw(); resolve(self); } else setTimeout(go, 40); };
          go();
        });
      });
    };
    function setSkin(skin, quiet) {
      self.skin = skin;
      if (!self.trace) return;
      if (job && actors[0]) release(actors[0]);
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
    self.relayout = () => layout();
    // For checks of the replay (leg crossings, spacing): the actors, and the spider's legs.
    self.debug = () => ({ actors, W, H, legs: self.skin === "spider" && actors[0] ? actors[0].feet.map((f, i) => { const c = actors[0], hip = hipOf(c, i); return { hip, knee: knee(c, hip, f, i), f: { x: f.x, y: f.y }, reach: L1(c) + L2(c), sw: Boolean(f.sw) }; }) : null });
    self.destroy = () => {
      self.pause(); all.delete(self);
      cv.remove(); box.classList.remove("stg-on");
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      if (hudEl) hudEl.innerHTML = "";
      if (capEl) capEl.innerHTML = "";
    };
    const onResize = () => layout();
    const onVis = () => { hidden = document.hidden; if (!hidden && !paused && !raf && started) { last = 0; raf = requestAnimationFrame(tick); } };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    const ro = "ResizeObserver" in window ? new ResizeObserver(() => { const b = box.getBoundingClientRect(); if (Math.abs(b.width - W) > 0.5 || Math.abs(b.height - H) > 0.5) layout(); }) : null;
    if (ro) ro.observe(box);
    const io = "IntersectionObserver" in window ? new IntersectionObserver((e) => self.suspend(!e[0].isIntersecting), { threshold: 0.12 }) : null;
    if (io) io.observe(box);
    buildHud();
    return self;
  }

  window.KitionStage = KitionStage;
})();
