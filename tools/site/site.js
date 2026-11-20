// The showcase's pages are complete without this script; it adds the enhancements:
// search and tag/category filters over the pre-rendered cards (kept in `?q=`, `?tag=`, `?cat=`),
// the home page's hero animation and count-up, the cards' reveal and animated previews, and the
// sample page's preview button and copy button, and the header's account label, download label,
// GitHub star count and mobile menu (as kition.ai's header has them).
(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const plural = (n, one, many = one + "s") => fmt(n) + " " + (n === 1 ? one : many);

  const PAGE = document.body.dataset.page;
  const HOME = document.body.dataset.home || "/";
  const ROOT = document.documentElement;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HAS_IO = "IntersectionObserver" in window;
  const LISTING = PAGE === "home" || PAGE === "kit";
  const q = $("#q");

  // ---------- Header (kition.ai's) ----------

  // The download button names the visitor's platform, with the labels kition.ai uses
  // (portal app/lib/useDownload.ts, os-detect.ts); it always opens kition.ai's download page.
  function setupDownload() {
    const label = $("#get-label");
    const ua = navigator.userAgent.toLowerCase();
    if (!label || /iphone|ipad|android/.test(ua)) return;
    const os = /mac os x|macintosh/.test(ua) ? "macOS" : /windows|win64|win32/.test(ua) ? "Windows" : "";
    if (os) label.textContent = "Download for " + os;
  }

  // Signed-in visitors get "Console" instead of "Sign in", as on kition.ai (portal app/lib/useAuth.ts):
  // the showcase is served from kition.ai, so the same-origin session cookie answers /api/auth/me.
  function setupAccount() {
    if (!/(^|\.)kition\.ai$/.test(location.hostname) || !window.fetch) return;
    fetch("/api/auth/me", { credentials: "include", headers: { "Content-Type": "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (payload && payload.data) for (const a of $$("[data-account]")) a.textContent = "Console";
      })
      .catch(() => {});
  }

  // The GitHub badge's star count: the build baked one in; on kition.ai the portal's same-origin
  // GET /api/public/github has the server's latest (portal app/lib/useGithubStars.ts), cached for the
  // session so each page doesn't ask again. Failures keep the baked count.
  const STARS_KEY = "kition:github-stars";
  function formatStars(n) {
    if (n < 1000) return String(Math.floor(n));
    const short = (value, unit) => (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "") + unit;
    return n < 999950 ? short(n / 1000, "k") : short(n / 1000000, "M");
  }
  const validStars = (n) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  function showStars(n) {
    for (const el of $$("[data-stars]")) if (el.textContent !== formatStars(n)) el.textContent = formatStars(n);
    for (const a of $$("[data-stars-link]")) a.setAttribute("aria-label", "Kition on GitHub, " + fmt(n) + " stars");
  }
  function setupStars() {
    if (!/(^|\.)kition\.ai$/.test(location.hostname) || !window.fetch || !$("[data-stars]")) return;
    let cached = null;
    try { cached = window.sessionStorage.getItem(STARS_KEY); } catch (e) { /* storage off */ }
    if (cached !== null && validStars(Number(cached))) { showStars(Number(cached)); return; }
    fetch("/api/public/github", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const n = payload && payload.data && payload.data.stars;
        if (!validStars(n)) return;
        try { window.sessionStorage.setItem(STARS_KEY, String(n)); } catch (e) { /* storage off */ }
        showStars(n);
      })
      .catch(() => {});
  }

  function setupMenu() {
    const button = $("#burger");
    const menu = $("#mobile-menu");
    if (!button || !menu) return;
    const isOpen = () => button.getAttribute("aria-expanded") === "true";
    const set = (open) => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.hidden = !open;
    };
    button.addEventListener("click", () => set(!isOpen()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) { set(false); button.focus(); }
    });
    // Past the breakpoint the full header shows and the menu has no button; close it.
    const wide = window.matchMedia("(min-width: 1200px)");
    if (wide.addEventListener) wide.addEventListener("change", (e) => { if (e.matches) set(false); });
  }

  // ---------- Replay effect (the setting) ----------

  // One site-wide setting: which actors play a sample's replay, or `off` (no actors, no replay
  // frames, the plain picture). The page's boot script has already put it on <html data-fx> before
  // the first paint (the stored choice, else off with reduced motion).
  const FX_KEY = "kition:stage-skin";
  const FX = [["cursors", "Cursors"], ["spider", "Spider"], ["squid", "Squid"], ["off", "Off"]];
  const FX_ICON = {
    cursors: '<path d="M3 2v10l3-2.6 2 4.4 1.8-.8-2-4.3H12z"/>',
    spider: '<circle cx="8" cy="8.5" r="2.2"/><path d="M6 7L3 4 1 6M6 9L2.5 9.5 1 12M10 7l3-3 2 2M10 9l3.5.5 1.5 2.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    squid: '<path d="M8 1.5c2.4 0 3.6 2.6 3.6 5.2 0 1.3-.7 2.3-1.6 2.3H6c-.9 0-1.6-1-1.6-2.3C4.4 4.1 5.6 1.5 8 1.5z"/><path d="M5.6 9.5c-.5 2-1.6 3-2.6 3.5M7.3 9.5c0 2-.3 3.5-1 4.5M8.7 9.5c0 2 .3 3.5 1 4.5M10.4 9.5c.5 2 1.6 3 2.6 3.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    off: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.2 11.8l7.6-7.6" stroke="currentColor" stroke-width="1.4"/>',
  };
  const fxNow = () => ROOT.getAttribute("data-fx") || "off";
  function fxSet(value) {
    try { window.localStorage.setItem(FX_KEY, value); } catch (e) { /* storage off */ }
    ROOT.setAttribute("data-fx", value);
    for (const el of $$(".fx [role=tab]")) {
      const on = el.dataset.fx === value;
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = on ? 0 : -1;
    }
    document.dispatchEvent(new CustomEvent("fxchange", { detail: value }));
  }
  let fxCount = 0;
  // The setting as a labelled tab row: arrows, Home and End move along it, Enter or Space picks.
  function fxControl(panelId) {
    const id = "fx-l-" + ++fxCount;
    const wrap = document.createElement("div");
    wrap.className = "fx";
    wrap.innerHTML = '<span class="fx-l label" id="' + id + '">Effect</span><div class="fx-tabs" role="tablist" aria-labelledby="' + id + '">'
      + FX.map(([v, label]) => '<button type="button" role="tab" data-fx="' + v + '" aria-controls="' + panelId + '" aria-selected="' + (v === fxNow()) + '" tabindex="' + (v === fxNow() ? 0 : -1) + '"><svg viewBox="0 0 16 16" aria-hidden="true">' + FX_ICON[v] + "</svg>" + label + "</button>").join("")
      + "</div>";
    const tabs = $$("[role=tab]", wrap);
    wrap.addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b && b.dataset.fx !== fxNow()) fxSet(b.dataset.fx); });
    wrap.addEventListener("keydown", (e) => {
      const at = tabs.indexOf(document.activeElement);
      if (at < 0) return;
      const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const b = tabs[(to + tabs.length) % tabs.length];
      b.focus();
      fxSet(b.dataset.fx);
    });
    return wrap;
  }

  // stage.js, fetched only when a replay is about to play.
  let stageLoading = null;
  function loadStage() {
    if (window.KitionStage) return Promise.resolve(window.KitionStage);
    if (!stageLoading) {
      stageLoading = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = document.body.dataset.stage;
        el.onload = () => resolve(window.KitionStage);
        el.onerror = reject;
        document.head.appendChild(el);
      });
    }
    return stageLoading;
  }
  const PALETTE = (document.body.dataset.colors || "").split(",").filter(Boolean);
  const REPLAY_NOTE = "A replay of this sample's build: the kit's own renders after each group of commands.";
  // A beat's commands as chips: each command once, with how many times it ran.
  function beatChips(beat) {
    const counts = new Map();
    for (const c of beat.commands) counts.set(c, (counts.get(c) || 0) + 1);
    const list = [...counts];
    const shown = list.slice(0, 4).map(([c, n], i) => '<li class="call on" style="--k:' + i + '"><b></b><code>' + esc(c) + "</code>" + (n > 1 ? "<em>&times;" + n + "</em>" : "") + "</li>");
    if (list.length > 4) shown.push('<li class="call on more-c" style="--k:4"><code>+' + (list.length - 4) + " more</code></li>");
    return shown.join("");
  }

  // ---------- Hero (home) ----------

  const heroEl = $("#hero");
  const DATA = heroEl && $("#hero-data") ? JSON.parse($("#hero-data").textContent) : null;
  const KITS = DATA ? DATA.kits : [];
  KITS.forEach((k, index) => (k.index = index));
  const N = KITS.length;
  const hero = { index: 0, timer: 0, onScreen: true, widths: null, scrambleTimer: 0, stage: null, mode: "" };
  const heroKit = (i) => KITS[i % N];
  const replayKits = () => KITS.filter((k) => k.hero.replay);
  const heroActive = () => hero.onScreen && !document.hidden && !ROOT.classList.contains("filtered");

  // Shows kit `i` in the slot's tick, the kit row and the panel: its sample, its first commands.
  function heroShow(i) {
    const kit = heroKit(i);
    const h = kit.hero;
    $("#slot").style.setProperty("--c", kit.color);
    $("#tick").style.setProperty("--c", kit.color);
    $("#tick-n").textContent = pad(kit.index + 1) + " / " + pad(N);
    $("#tick-kit").textContent = kit.id + " kit";
    $("#tick-count").innerHTML = esc(plural(kit.count, "sample")) + '<span class="tcur"></span>';
    for (const el of [$("#run"), $("#strip")]) el.style.setProperty("--c", kit.color);
    $("#run-label").innerHTML = "agent &middot; <b>" + esc(kit.id) + "</b> kit";
    $("#calls").innerHTML = h.calls.map(([cmd, hint]) => '<li class="call"><b></b><code>' + esc(cmd) + (hint ? "<i>(" + esc(hint) + ")</i>" : "") + "</code></li>").join("");
    const rest = h.commands - h.calls.length;
    $("#strip-n").textContent = rest > 0 ? "+ " + plural(rest, "more command") + " · " + fmt(h.ms) + " ms" : fmt(h.ms) + " ms";
    $("#run-saved").textContent = "saved → " + h.document + " ✓";
    $("#run-stat").textContent = plural(h.commands, "command") + " · " + fmt(h.ms) + " ms";
    for (const a of [$("#shot"), $("#shot-link")]) a.href = h.path;
    $("#shot").setAttribute("aria-label", "Open " + h.title);
    $("#shot-title").textContent = h.title;
    const img = $("#shot-img");
    const [w, hh] = h.thumbSize;
    img.width = w; img.height = hh;
    img.alt = h.alt;
    img.style.setProperty("--r", (w / hh).toFixed(4));
    if (img.getAttribute("src") !== h.thumbUrl) img.src = h.thumbUrl;
    syncKitRow();
  }

  function preload(i) { const img = new Image(); img.decoding = "async"; img.src = heroKit(i).hero.thumbUrl; }
  function prefetchReplay(kit) {
    if (!kit || !kit.hero.replay || !window.fetch) return;
    fetch(kit.hero.replay + "trace.json").catch(() => {});
    for (const n of ["00", "01"]) { const im = new Image(); im.src = kit.hero.replay + "frames/" + n + ".webp"; }
  }

  // Effect off: the headline rolls through the kits every few seconds and the panel shows each
  // kit's finished sample, still.
  function stillTick() {
    clearTimeout(hero.timer); hero.timer = 0;
    if (hero.mode !== "still" || REDUCED || !heroActive()) return;
    hero.timer = setTimeout(() => {
      hero.timer = 0;
      if (hero.mode !== "still" || !heroActive()) return;
      const next = (hero.index + 1) % N;
      roll(next); heroShow(next); preload((next + 1) % N);
      stillTick();
    }, 4200);
  }

  // Effect on: the stage plays each kit's hero sample being built, then the headline rolls to the
  // next kit that has a replay.
  function nextReplayKit(from) {
    for (let k = 1; k <= N; k++) { const kit = heroKit(from + k); if (kit.hero.replay) return kit.index; }
    return -1;
  }
  function heroBeat(j, beat, trace) {
    $("#calls").innerHTML = beatChips(beat);
    $("#strip-n").textContent = "beat " + pad(j + 1) + " / " + pad(trace.beats.length) + " · " + fmt(beat.at) + " / " + plural(trace.commands, "command");
  }
  function heroEnd() {
    const n = nextReplayKit(hero.index);
    if (n < 0 || n === hero.index || !heroActive()) return true; // play this one again
    roll(n); heroShow(n); heroStage(n);
    prefetchReplay(heroKit(nextReplayKit(n)));
    return false;
  }
  function heroStage(i) {
    const kit = heroKit(i);
    loadStage().then((KitionStage) => {
      if (hero.mode !== "stage" || hero.index !== kit.index) return;
      if (!hero.stage) {
        hero.opts = { skin: fxNow(), colors: PALETTE, hud: $("#hs-hud"), cap: $("#hs-cap"), loop: false, onBeat: heroBeat, onEnd: heroEnd, note: REPLAY_NOTE };
        hero.stage = KitionStage($("#shot"), $("#shot-img"), hero.opts);
      }
      hero.opts.color = kit.color;
      return hero.stage.load(kit.hero.replay).then(() => { if (hero.mode === "stage" && hero.index === kit.index) hero.stage.play(); });
    }).catch(() => heroMode("still"));
  }
  function heroMode(mode) {
    if (hero.mode === mode) return;
    hero.mode = mode;
    clearTimeout(hero.timer); hero.timer = 0;
    if (mode === "still") {
      if (hero.stage) { hero.stage.destroy(); hero.stage = null; }
      heroShow(hero.index);
      stillTick();
      return;
    }
    if (!heroKit(hero.index).hero.replay) { const n = nextReplayKit(hero.index); if (n < 0) return heroMode("still"); roll(n); heroShow(n); }
    heroStage(hero.index);
    prefetchReplay(heroKit(nextReplayKit(hero.index)));
  }

  const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&/<>*+=";
  function scramble(span, text) {
    clearInterval(hero.scrambleTimer);
    let n = 0;
    const steps = 10;
    const mix = (fixed) => [...text].map((ch, i) => (i < fixed || ch === "." ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join("");
    span.textContent = mix(0);
    hero.scrambleTimer = setInterval(() => {
      n++;
      if (n >= steps) { clearInterval(hero.scrambleTimer); span.textContent = text; return; }
      span.textContent = mix(Math.floor((text.length * n) / steps));
    }, 30);
  }

  // Rolls the slot to kit `i`; the reel ends on a copy of the first word, then snaps home.
  function roll(i) {
    const reel = $("#reel");
    const slot = $("#slot");
    hero.index = i;
    if (REDUCED || reel.children.length < 2) { reel.firstElementChild.textContent = heroKit(i).word; return; }
    const pos = i === 0 ? N : i;
    reel.style.transition = "";
    reel.style.transform = "translateY(" + (-pos * 1.52).toFixed(2) + "em)";
    if (hero.widths) slot.style.width = "calc(" + hero.widths[pos].toFixed(4) + "em + .14em)";
    const span = reel.children[pos];
    span.classList.remove("hit"); void span.offsetWidth; span.classList.add("hit");
    scramble(span, heroKit(i).word);
    slot.classList.remove("squash"); void slot.offsetWidth; slot.classList.add("squash");
    if (pos === N) {
      setTimeout(() => {
        reel.style.transition = "none";
        reel.style.transform = "translateY(0)";
        if (hero.widths) { slot.style.transition = "none"; slot.style.width = "calc(" + hero.widths[0].toFixed(4) + "em + .14em)"; }
        void reel.offsetWidth;
        slot.style.transition = "";
      }, 820);
    }
  }

  function measureReel() {
    const reel = $("#reel");
    const fs = parseFloat(getComputedStyle(reel).fontSize);
    const ws = [...reel.children].map((s) => s.getBoundingClientRect().width / fs);
    if (fs > 0 && ws.length > 1 && ws.every((w) => w > 0)) {
      hero.widths = ws;
      const pos = hero.index === 0 && reel.style.transform.includes(String(-N * 1.52)) ? N : hero.index;
      $("#slot").style.width = "calc(" + ws[pos].toFixed(4) + "em + .14em)";
    }
  }

  function setupHero() {
    if (!DATA || !N) return;
    // The page carries the first kit's word; the reel gets the rest, and the first again to end on.
    const reel = $("#reel");
    if (!REDUCED) reel.insertAdjacentHTML("beforeend", [...KITS.slice(1), KITS[0]].map((k) => "<span>" + esc(k.word) + "</span>").join(""));
    syncKitRow();
    const canStage = replayKits().length > 0 && document.body.dataset.stage;
    if (canStage) $("#hs-top").appendChild(fxControl("run-panel"));
    if (!REDUCED) {
      measureReel();
      if (document.fonts) {
        document.fonts.ready.then(measureReel);
        if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", measureReel);
      }
      window.addEventListener("resize", measureReel);
      preload(1);
    }
    const want = () => (canStage && fxNow() !== "off" && !ROOT.classList.contains("filtered") ? "stage" : "still");
    if (HAS_IO) {
      new IntersectionObserver((entries) => {
        hero.onScreen = entries[0].isIntersecting;
        if (hero.mode === "still") stillTick();
      }, { threshold: 0.15 }).observe(heroEl);
    }
    document.addEventListener("visibilitychange", () => { if (hero.mode === "still") stillTick(); });
    document.addEventListener("fxchange", (e) => {
      if (e.detail === "off") return heroMode("still");
      if (hero.mode === "stage" && hero.stage) { hero.stage.setSkin(e.detail); hero.stage.play(true); } else heroMode(want());
    });
    hero.recheck = () => heroMode(want());
    heroMode(want());
  }

  // The kit row lights the kit the hero is showing, and its caption follows along.
  function syncKitRow() {
    const blocks = $("#blocks");
    if (!blocks || !DATA) return;
    const showing = !ROOT.classList.contains("filtered") ? heroKit(hero.index) : null;
    for (const a of $$(".kcard", blocks)) a.classList.toggle("on", Boolean(showing) && a.dataset.kit === showing.id);
    const cap = $("#sync");
    if (cap) cap.innerHTML = showing ? "&uarr; " + pad(showing.index + 1) + " / " + pad(N) + " &middot; " + esc(showing.id) + '.run(showcase.yaml) &rarr; <span class="ok">ok</span>' : "";
  }

  // On a kit's page in the narrow (scrolling) kit strip, bring the kit into view.
  function centreKit() {
    const blocks = $("#blocks");
    const picked = blocks && $(".kcard[aria-current]", blocks);
    if (picked && blocks.scrollWidth > blocks.clientWidth) {
      const blk = picked.parentElement;
      blocks.scrollLeft = Math.max(0, blk.offsetLeft - blocks.offsetLeft - (blocks.clientWidth - blk.offsetWidth) / 2);
    }
  }

  // ---------- Numbers (home) ----------

  function setupStats() {
    const wrap = $("#stats-wrap");
    if (!wrap || REDUCED || !HAS_IO) return;
    const nums = $$("b[data-n]", wrap);
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / 1500);
        const e = 1 - Math.pow(1 - p, 3);
        nums.forEach((b, i) => { const k = Math.max(0, Math.min(1, e * 1.08 - i * 0.02)); b.textContent = fmt(Math.round(Number(b.dataset.n) * Math.min(1, k))); });
        if (p < 1) requestAnimationFrame(tick); else nums.forEach((b) => (b.textContent = fmt(b.dataset.n)));
      };
      nums.forEach((b) => (b.textContent = "0"));
      requestAnimationFrame(tick);
    }, { threshold: 0.3 });
    io.observe(wrap);
  }

  // ---------- Reveal ----------

  // Cards below the first screen fade up as they come into view. Only this script hides them, so
  // without it (or with reduced motion) every card simply shows.
  let cardIO = null;
  function setupReveal() {
    if (!HAS_IO || REDUCED) return;
    cardIO = new IntersectionObserver((entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.style.setProperty("--d", Math.min(n++, 8) * 45 + "ms");
        e.target.classList.add("in");
        cardIO.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -4% 0px" });
    for (const c of $$(".card")) {
      if (c.getBoundingClientRect().top < innerHeight) continue;
      c.classList.add("rv");
      cardIO.observe(c);
    }
    revealFallback();
  }
  // If the observer never reports (an old or odd browser), show what is on screen anyway.
  function revealFallback() {
    setTimeout(() => {
      for (const c of $$(".card.rv:not(.in)")) if (!c.hidden && c.getBoundingClientRect().top < innerHeight) c.classList.add("in");
    }, 1200);
  }

  // ---------- Filters (home and kit pages) ----------

  const samplesEl = $("#samples");
  const cards = LISTING && samplesEl ? $$(".card", samplesEl) : [];
  for (const c of cards) {
    c._hay = [c.textContent, c.dataset.s, c.dataset.cat].join(" ").replace(/\s+/g, " ").toLowerCase();
    c._tags = (c.dataset.tags || "").split("|");
  }
  const params = new URLSearchParams(location.search);
  const state = { q: params.get("q") || "", tag: params.get("tag") || "", cat: PAGE === "kit" ? params.get("cat") || "" : "" };
  const filteredNow = () => Boolean(state.q.trim() || state.tag || state.cat);

  function apply() {
    const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const c of cards) {
      const show = (!state.tag || c._tags.includes(state.tag)) && (!state.cat || c.dataset.cat === state.cat) && words.every((w) => c._hay.includes(w));
      c.hidden = !show;
      if (show) count++;
    }
    for (const sec of $$(".cat-sec", samplesEl)) sec.hidden = !$(".card:not([hidden])", sec);
    for (const chip of $$(".chip[data-cat]")) {
      if ((chip.dataset.cat || "") === state.cat) chip.setAttribute("aria-current", "true"); else chip.removeAttribute("aria-current");
    }
    const on = state.cat && $('.chip[aria-current="true"]');
    const chips = $(".chips");
    if (on && chips && chips.scrollWidth > chips.clientWidth) chips.scrollLeft = Math.max(0, on.offsetLeft - chips.offsetLeft - 24);
    $("#count").textContent = count;
    $("#count").parentElement.lastChild.textContent = count === 1 ? " sample" : " samples";
    renderBar();
    const empty = $("#empty");
    empty.hidden = count > 0;
    empty.innerHTML = count ? "" : emptyHtml();
    if (PAGE === "home") {
      ROOT.classList.toggle("filtered", filteredNow());
      syncKitRow();
      if (hero.recheck) hero.recheck();
    }
    if (cardIO) revealFallback();
    if (q.value !== state.q) q.value = state.q;
    // Shareable, but the same page: the canonical URL stays the page's own.
    const next = new URLSearchParams();
    if (state.q.trim()) next.set("q", state.q.trim());
    if (state.tag) next.set("tag", state.tag);
    if (state.cat) next.set("cat", state.cat);
    const qs = next.toString();
    const url = location.pathname + (qs ? "?" + qs : "");
    if (url !== location.pathname + location.search) history.replaceState(history.state, "", url);
  }

  function renderBar() {
    const barIn = $("#bar-in");
    let query = $("#bar-q");
    if (!query) {
      query = document.createElement("span");
      query.id = "bar-q";
      barIn.insertBefore(query, $(".search", barIn) || $(".count", barIn));
    }
    const parts = [];
    if (state.tag) parts.push("Tagged <q>" + esc(state.tag) + "</q>");
    if (state.q.trim()) parts.push((state.tag ? "matching" : "Results for") + " <q>" + esc(state.q.trim()) + "</q>");
    if (parts.length) { query.className = "query"; query.innerHTML = parts.join(" "); }
    else if (PAGE === "home") { query.className = "query mute"; query.innerHTML = "Every sample in every kit. Pick a kit above, or press <kbd>/</kbd> to search."; }
    else { query.className = "query"; query.innerHTML = ""; }
    let clear = $("#clear");
    if (filteredNow() && !clear) {
      barIn.insertAdjacentHTML("beforeend", '<button type="button" class="clear" id="clear">Clear <span aria-hidden="true">&times;</span></button>');
    } else if (!filteredNow() && clear) clear.remove();
  }

  function emptyHtml() {
    const tags = {};
    for (const c of cards) for (const t of c._tags) tags[t] = (tags[t] || 0) + 1;
    const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
    const what = [state.tag && "tagged “" + state.tag + "”", state.q.trim() && "for “" + state.q.trim() + "”"].filter(Boolean).join(" ");
    return '<div class="empty"><p class="label">0 results ' + esc(what) + "</p>"
      + '<h2 class="d">Nothing <span class="em">matches.</span></h2>'
      + "<p>Search looks through titles, summaries, categories, tags and features. Try fewer words, or one of these tags.</p>"
      + '<div class="try">' + top.map((t) => '<button type="button" class="tag" data-tag="' + esc(t) + '">' + esc(t) + "</button>").join("")
      + '<button type="button" class="btn btn-ghost btn-sm" id="clear2">Clear the search</button></div></div>';
  }

  // After a filter changes from inside the list, bring the results to the top if the bar has scrolled past.
  function toResults() {
    const bar = $("#bar");
    const top = bar.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(bar).top) || 0);
    if (scrollY > top) scrollTo({ top, behavior: "auto" });
  }

  function setupFilters() {
    if (!LISTING || !cards.length) return;
    q.addEventListener("input", () => { state.q = q.value; apply(); toResults(); });
    q.form.addEventListener("submit", (e) => { e.preventDefault(); state.q = q.value; apply(); toResults(); });
    q.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (q.value) { state.q = ""; apply(); } else q.blur();
    });
    document.addEventListener("click", (e) => {
      const tag = e.target.closest("button[data-tag]");
      if (tag) {
        state.tag = tag.dataset.tag; state.q = ""; state.cat = "";
        apply(); toResults();
        return;
      }
      const chip = e.target.closest(".chip[data-cat]");
      if (chip) {
        e.preventDefault();
        state.cat = chip.dataset.cat || "";
        apply(); toResults();
        return;
      }
      if (e.target.closest("#clear, #clear2")) {
        state.q = ""; state.tag = ""; state.cat = "";
        apply(); toResults();
        q.focus({ preventScroll: true });
      }
    });
    if (filteredNow()) apply();
    else renderBar();
  }

  // On the other pages a tag button opens the front page filtered by it.
  if (!LISTING) {
    document.addEventListener("click", (e) => {
      const tag = e.target.closest("button[data-tag]");
      if (tag) location.href = HOME + "?tag=" + encodeURIComponent(tag.dataset.tag);
    });
  }

  // "/" focuses the search anywhere.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || !q) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    q.focus();
    q.select();
  });

  // ---------- Previews ----------

  // Animated samples play their preview while the pointer (or focus) is on the card.
  function play(cardEl, on) {
    if (!cardEl || !cardEl.dataset.preview) return;
    const img = $(".fit img", cardEl);
    const want = on ? cardEl.dataset.preview : cardEl.dataset.thumb;
    if (img.getAttribute("src") !== want) img.setAttribute("src", want);
    cardEl.classList.toggle("playing", on);
  }
  const previewCard = (t) => t && t.closest && t.closest(".card[data-preview]");
  document.addEventListener("mouseover", (e) => { const c = previewCard(e.target); if (c && !c.contains(e.relatedTarget)) play(c, true); });
  document.addEventListener("mouseout", (e) => { const c = previewCard(e.target); if (c && !c.contains(e.relatedTarget)) play(c, false); });
  document.addEventListener("focusin", (e) => play(previewCard(e.target), true));
  document.addEventListener("focusout", (e) => { const c = previewCard(e.target); if (c && !c.contains(e.relatedTarget)) play(c, false); });

  // ---------- Sample page ----------

  function setupPlay() {
    const view = $("#view");
    const button = $("#playbtn");
    if (!view || !button) return;
    const img = $("img", view);
    const show = (on) => {
      const want = on ? view.dataset.preview : view.dataset.thumb;
      if (img.getAttribute("src") !== want) img.setAttribute("src", want);
      view.classList.toggle("playing", on);
    };
    const pinned = () => button.getAttribute("aria-pressed") === "true";
    button.addEventListener("click", () => {
      const on = !pinned();
      button.setAttribute("aria-pressed", String(on));
      button.textContent = on ? "Show the still" : "Play preview";
      show(on);
    });
    view.addEventListener("mouseenter", () => { if (!view.classList.contains("stg-on")) show(true); });
    view.addEventListener("mouseleave", () => show(pinned()));
  }

  // A sample's replay: "Watch it build" plays it in place of the picture, with the effect tabs and
  // the replay's status under it; the Steps panel follows the beats, and a step seeks to its beat.
  // On a wide screen, a playing replay scrolled away while the Steps are in view goes on in a small
  // picture-in-picture at the corner, so the lines and the document can be watched together;
  // otherwise it pauses off screen (stage.js).
  function setupReplay() {
    const view = $("#view");
    if (!view || !view.dataset.replay || !document.body.dataset.stage) return;
    const img = $("img", view);
    const bar = $("#vbar");
    const dock = $("#vdock");
    const watch = document.createElement("button");
    watch.type = "button";
    watch.className = "watchbtn";
    watch.setAttribute("aria-pressed", "false");
    watch.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z"/></svg><span>Watch it build</span>';
    bar.appendChild(watch);
    bar.appendChild(fxControl("view"));
    const pre = $(".code pre[data-steps]");
    const lines = pre ? JSON.parse(pre.dataset.steps) : [];
    const col = view.parentElement;
    const wide = window.matchMedia("(min-width: 1100px)");
    const seen = { col: true, steps: false };
    let pip = false, pipShut = false, pipBar = null;
    function setPip(on) {
      if (on === pip) return;
      pip = on;
      if (on) {
        col.style.minHeight = col.offsetHeight + "px";
        if (!pipBar) {
          pipBar = document.createElement("div");
          pipBar.className = "pipbar";
          pipBar.innerHTML = '<button type="button" class="stg-btn" data-p="play" aria-label="Pause the replay"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg></button><span class="stg-track"><span class="stg-fill"></span></span><button type="button" class="stg-btn" data-p="close" aria-label="Close the picture-in-picture"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></button>';
          pipBar.addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b || !stage) return;
            if (b.dataset.p === "close") { pipShut = true; stage.pause(); setPip(false); }
            else if (stage.playing()) stage.pause(); else stage.play(true);
          });
          view.appendChild(pipBar);
        }
      }
      view.classList.toggle("pip", on);
      if (!on) col.style.minHeight = "";
      if (stage) stage.relayout();
    }
    function pipCheck() {
      if (seen.col) pipShut = false;
      setPip(Boolean(stage && stage.playing() && wide.matches && !pipShut && !seen.col && seen.steps));
    }
    function pipHud(st) {
      if (pipBar) {
        $(".stg-fill", pipBar).style.transform = "scaleX(" + (st.at / st.commands).toFixed(4) + ")";
        const b = $('[data-p="play"]', pipBar);
        b.classList.toggle("paused", st.paused);
        b.setAttribute("aria-label", st.paused ? "Play the replay" : "Pause the replay");
      }
      pipCheck();
    }
    if (HAS_IO) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) seen[e.target === col ? "col" : "steps"] = e.isIntersecting;
        pipCheck();
      }, { threshold: 0.05 });
      io.observe(col);
      if (pre) io.observe(pre.closest(".code"));
      if (wide.addEventListener) wide.addEventListener("change", pipCheck);
    }
    let band = null;
    let stage = null;
    let trace = null;
    const color = getComputedStyle(view).getPropertyValue("--c").trim() || PALETTE[0];
    const metrics = () => { const cs = getComputedStyle(pre); return { lh: parseFloat(cs.lineHeight) || 21, top: parseFloat(cs.paddingTop) || 16 }; };
    function highlight(j, beat) {
      if (!pre || !lines.length) return;
      const from = j > 0 ? trace.beats[j - 1].at : 0;
      const a = lines[Math.min(from, lines.length - 1)], b = lines[Math.min(beat.at, lines.length) - 1];
      if (!a || !b) return;
      if (!band) { band = document.createElement("span"); band.className = "beatband"; band.setAttribute("aria-hidden", "true"); pre.appendChild(band); }
      const { lh, top } = metrics();
      const y = top + a[0] * lh, h = (b[1] - a[0] + 1) * lh;
      band.style.transform = "translateY(" + y + "px)";
      band.style.height = h + "px";
      band.hidden = false;
      if (y < pre.scrollTop || y + Math.min(h, pre.clientHeight * 0.6) > pre.scrollTop + pre.clientHeight) pre.scrollTo({ top: Math.max(0, y - 24), behavior: REDUCED ? "auto" : "smooth" });
    }
    function start() {
      if (stage) return;
      view.classList.add("replaying");
      watch.setAttribute("aria-pressed", "true");
      watch.lastChild.textContent = "Show the result";
      if (pre) pre.classList.add("seekable");
      loadStage().then((KitionStage) => {
        if (!view.classList.contains("replaying")) return;
        stage = KitionStage(view, img, { skin: fxNow(), colors: PALETTE, color, hud: dock, loop: true, onBeat: highlight, onHud: pipHud, note: REPLAY_NOTE });
        return stage.load(view.dataset.replay).then((s) => { trace = s.trace; if (stage) stage.play(true); });
      }).catch(() => stop());
    }
    function stop() {
      setPip(false);
      if (stage) { stage.destroy(); stage = null; }
      view.classList.remove("replaying");
      watch.setAttribute("aria-pressed", "false");
      watch.lastChild.textContent = "Watch it build";
      if (band) band.hidden = true;
      if (pre) pre.classList.remove("seekable");
    }
    watch.addEventListener("click", () => (stage || view.classList.contains("replaying") ? stop() : start()));
    document.addEventListener("fxchange", (e) => {
      if (e.detail === "off") stop();
      else if (stage) { stage.setSkin(e.detail); stage.play(true); } else start();
    });
    if (pre) {
      pre.addEventListener("click", (e) => {
        if (!stage || !trace || String(window.getSelection && window.getSelection()).length) return;
        const { lh, top } = metrics();
        const line = Math.floor((e.clientY - pre.getBoundingClientRect().top + pre.scrollTop - top) / lh);
        const step = lines.findIndex(([a, b]) => line >= a && line <= b);
        if (step < 0) return;
        const beat = trace.beats.findIndex((b) => b.at > step);
        if (beat >= 0) { stage.seek(beat); stage.play(true); }
      });
    }
  }

  function setupCopy() {
    const button = $("#copy");
    const code = $(".code pre code");
    if (!button || !code) return;
    button.addEventListener("click", () => {
      const text = code.textContent;
      const done = () => { button.textContent = "Copied ✓"; button.classList.add("ok"); setTimeout(() => { button.textContent = "Copy"; button.classList.remove("ok"); }, 1600); };
      const fallback = () => {
        const ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { button.textContent = "Select and copy"; }
        ta.remove();
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    });
  }

  setupDownload();
  setupAccount();
  setupStars();
  setupMenu();
  setupFilters();
  setupHero();
  setupStats();
  setupReveal();
  centreKit();
  setupPlay();
  setupReplay();
  setupCopy();
})();
