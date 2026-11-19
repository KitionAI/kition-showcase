// The showcase's pages are complete without this script; it adds the enhancements:
// search and tag/category filters over the pre-rendered cards (kept in `?q=`, `?tag=`, `?cat=`),
// the home page's hero animation and count-up, the cards' reveal and animated previews, and the
// sample page's preview button and copy button, and the header's account label, download label
// and mobile menu (as kition.ai's header has them).
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
    const wide = window.matchMedia("(min-width: 1080px)");
    if (wide.addEventListener) wide.addEventListener("change", (e) => { if (e.matches) set(false); });
  }

  // ---------- Hero (home) ----------

  const RUN_CALLS = 6;
  const STEP_GAP = 330;
  const heroEl = $("#hero");
  const DATA = heroEl && $("#hero-data") ? JSON.parse($("#hero-data").textContent) : null;
  const KITS = DATA ? DATA.kits : [];
  KITS.forEach((k, index) => (k.index = index));
  const N = KITS.length;
  const hero = { index: 0, queue: [], pending: null, timer: 0, onScreen: true, widths: null, scrambleTimer: 0 };
  const heroKit = (i) => KITS[i % N];

  // Shows kit `i` in the slot's tick, the kit row and the agent panel. `play` replays the panel.
  function heroShow(i, play) {
    const kit = heroKit(i);
    const h = kit.hero;
    $("#slot").style.setProperty("--c", kit.color);
    $("#tick").style.setProperty("--c", kit.color);
    $("#tick-n").textContent = pad(kit.index + 1) + " / " + pad(N);
    $("#tick-kit").textContent = kit.id + " kit";
    $("#tick-count").innerHTML = esc(plural(kit.count, "sample")) + '<span class="tcur"></span>';
    const run = $("#run");
    run.style.setProperty("--c", kit.color);
    run.classList.toggle("play", play);
    run.classList.remove("saved");
    $("#run-label").innerHTML = "agent &middot; <b>" + esc(kit.id) + "</b> kit";
    $("#calls").innerHTML = h.calls.map(([cmd, hint]) => {
      const text = cmd + (hint ? "(" + hint + ")" : "");
      return '<li class="call"><b></b><code style="--n:' + text.length + '">' + esc(cmd) + (hint ? "<i>(" + esc(hint) + ")</i>" : "") + "</code><em>&hellip;</em></li>";
    }).join("");
    const rest = h.commands - h.calls.length;
    $("#run-more").textContent = rest > 0 ? "+ " + plural(rest, "more command") + " · " + fmt(h.ms) + " ms" : fmt(h.ms) + " ms";
    $("#run-saved").textContent = "saved → " + h.document + " ✓";
    const shot = $("#shot");
    shot.href = h.path;
    shot.setAttribute("aria-label", "Open " + h.title);
    $("#shot-title").textContent = h.title;
    const img = $("#shot-img");
    const [w, hh] = h.thumbSize;
    img.width = w; img.height = hh;
    img.alt = h.alt;
    img.style.setProperty("--r", (w / hh).toFixed(4));
    if (img.getAttribute("src") !== h.thumbUrl) img.src = h.thumbUrl;
    if (!play) finishCalls();
    syncKitRow();
  }

  function finishCalls() {
    for (const li of $("#calls").children) { li.classList.add("on", "done"); $("em", li).textContent = "ok"; }
    $("#run").classList.add("saved");
  }

  // One beat of the hero as (wait, then do) pairs: roll to the next kit, type its calls one by
  // one (each reads ok a moment after it appears), then the save and the picture, then a hold.
  function stepEvents() {
    const next = (hero.index + 1) % N;
    const call = (j) => $("#calls").children[j];
    const events = [[0, () => { roll(next); heroShow(next, true); preload((next + 1) % N); }]];
    for (let j = 0; j < RUN_CALLS; j++) {
      events.push([j === 0 ? 420 : STEP_GAP - 220, () => { const li = call(j); if (li) li.classList.add("on"); }]);
      events.push([220, () => { const li = call(j); if (li) { li.classList.add("done"); $("em", li).textContent = "ok"; } }]);
    }
    events.push([260, () => $("#run").classList.add("saved")]);
    events.push([2600, () => {}]);
    return events;
  }

  function preload(i) { const img = new Image(); img.decoding = "async"; img.src = heroKit(i).hero.thumbUrl; }

  const heroActive = () => !REDUCED && hero.onScreen && !document.hidden && !ROOT.classList.contains("filtered");

  function pump() {
    if (!DATA || hero.timer || !heroActive()) return;
    if (!hero.queue.length) hero.queue = stepEvents();
    const ev = hero.queue.shift();
    hero.pending = ev;
    hero.timer = setTimeout(() => { hero.timer = 0; hero.pending = null; ev[1](); pump(); }, ev[0]);
  }
  function pause() {
    if (!hero.timer) return;
    clearTimeout(hero.timer); hero.timer = 0;
    if (hero.pending) { hero.queue.unshift(hero.pending); hero.pending = null; }
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
    const pos = i === 0 ? N : i;
    hero.index = i;
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
    if (fs > 0 && ws.every((w) => w > 0)) {
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
    if (REDUCED) return;
    measureReel();
    if (document.fonts) {
      document.fonts.ready.then(measureReel);
      if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", measureReel);
    }
    window.addEventListener("resize", measureReel);
    preload(1);
    if (HAS_IO) {
      new IntersectionObserver((entries) => {
        hero.onScreen = entries[0].isIntersecting;
        if (hero.onScreen) pump(); else pause();
      }, { threshold: 0.15 }).observe(heroEl);
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? pause() : pump()));
    // The first kit holds for a beat before the roll starts.
    hero.queue = [[2400, () => {}]];
    pump();
  }

  // The kit row lights the kit the hero is showing, and its caption follows along.
  function syncKitRow() {
    const blocks = $("#blocks");
    if (!blocks || !DATA) return;
    const showing = !REDUCED && !ROOT.classList.contains("filtered") ? heroKit(hero.index) : null;
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
      if (filteredNow()) pause(); else pump();
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
    view.addEventListener("mouseenter", () => show(true));
    view.addEventListener("mouseleave", () => show(pinned()));
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
  setupMenu();
  setupFilters();
  setupHero();
  setupStats();
  setupReveal();
  centreKit();
  setupPlay();
  setupCopy();
})();
