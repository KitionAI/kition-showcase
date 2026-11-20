import assert from "node:assert/strict";
import test from "node:test";

import {
  beatCaption, beatKind, commandKind, diffCells, humanise, initialPrefixes, iou, nextRefinement, overlap, planBeats, regions,
  shortCaption, stepLines, targetsOf, unionRect,
} from "./trace-core.mjs";

// A w×h RGBA picture, white, with the given rectangles painted black.
function picture(w, h, rects = []) {
  const data = new Uint8Array(w * h * 4).fill(255);
  for (const [x0, y0, rw, rh] of rects) {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) data.set([0, 0, 0, 255], (y * w + x) * 4);
  }
  return data;
}

test("diffCells: no change, and a small change found to the pixel", () => {
  const a = picture(64, 64);
  assert.equal(diffCells(a, picture(64, 64), 64, 64).changed, 0);
  const grid = diffCells(a, picture(64, 64, [[20, 10, 6, 4]]), 64, 64);
  assert.equal(grid.changed, 1);
  assert.deepEqual(regions(grid)[0].rect, [20, 10, 6, 4]);
});

test("diffCells: faint differences under the threshold are noise", () => {
  const a = picture(32, 32);
  const b = picture(32, 32);
  for (let i = 0; i < b.length; i += 4) b[i] = 240;
  assert.equal(diffCells(a, b, 32, 32).changed, 0);
});

test("regions: separate changes are separate regions, largest first; near ones join", () => {
  const a = picture(160, 160);
  const b = picture(160, 160, [[0, 0, 40, 40], [120, 120, 10, 10], [44, 0, 6, 6]]);
  const found = regions(diffCells(a, b, 160, 160));
  assert.equal(found.length, 2);
  assert.deepEqual(found[0].rect, [0, 0, 50, 40]); // the 6 px block 4 px away joins the big one
  assert.deepEqual(found[1].rect, [120, 120, 10, 10]);
});

test("targetsOf: at most four, small ones dropped, structure over 70%", () => {
  const a = picture(320, 320);
  const many = picture(320, 320, [[0, 0, 60, 60], [128, 0, 50, 50], [0, 128, 50, 50], [128, 128, 50, 50], [260, 260, 40, 40], [260, 0, 4, 4]]);
  const t = targetsOf(diffCells(a, many, 320, 320));
  assert.equal(t.structure, false);
  assert.equal(t.rects.length, 4);
  assert.deepEqual(t.rects[0], [0, 0, 60, 60]);
  const all = targetsOf(diffCells(a, picture(320, 320, [[0, 0, 320, 260]]), 320, 320));
  assert.deepEqual(all, { structure: true, rects: [] });
  assert.deepEqual(targetsOf(diffCells(a, a, 320, 320)), { structure: false, rects: [] });
});

test("rectangles: union, overlap, IoU", () => {
  assert.deepEqual(unionRect([[0, 0, 10, 10], [20, 5, 5, 10]]), [0, 0, 25, 15]);
  assert.equal(unionRect([]), null);
  assert.equal(overlap([0, 0, 10, 10], [2, 2, 4, 4]), 1);
  assert.equal(overlap([0, 0, 10, 10], [20, 20, 4, 4]), 0);
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.ok(Math.abs(iou([0, 0, 10, 10], [5, 0, 10, 10]) - 1 / 3) < 1e-9);
});

test("initialPrefixes and refinement", () => {
  assert.deepEqual(initialPrefixes(5), [0, 1, 2, 3, 4, 5]);
  const many = initialPrefixes(160);
  assert.equal(many.length, 33);
  assert.equal(many[0], 0);
  assert.equal(many.at(-1), 160);
  assert.equal(nextRefinement([{ from: 0, to: 5, changed: 3 }, { from: 5, to: 10, changed: 9 }, { from: 10, to: 11, changed: 50 }]), 7);
  assert.equal(nextRefinement([{ from: 0, to: 1, changed: 3 }, { from: 1, to: 9, changed: 0 }]), null);
});

// A fake document: each step i paints box[i] (or nothing); a diff between prefixes is the union.
function fake(boxes) {
  const diff = (from, to) => {
    const rects = boxes.slice(from, to).filter(Boolean);
    return { changed: rects.length, box: unionRect(rects), rects };
  };
  const segments = boxes.map((_, i) => ({ from: i, to: i + 1, ...diff(i, i + 1) }));
  return { segments, diff };
}

test("planBeats: steps with no visible change join the next visible one, trailing ones the last", () => {
  const { segments, diff } = fake([null, [0, 0, 10, 10], null, null, [50, 50, 10, 10], null]);
  const beats = planBeats(segments, diff);
  assert.deepEqual(beats.map((b) => [b.from, b.to]), [[0, 2], [2, 6]]);
});

test("planBeats: the same place twice in a row merges; at most 16 beats, covering every step", () => {
  const boxes = [];
  for (let i = 0; i < 40; i++) boxes.push([(i % 20) * 30, Math.floor(i / 20) * 300, 20, 20]);
  boxes.splice(5, 0, [150, 0, 20, 20]); // step 5 repaints step 4's place
  const { segments, diff } = fake(boxes);
  const beats = planBeats(segments, diff);
  assert.ok(beats.length <= 16 && beats.length >= 8, String(beats.length));
  assert.equal(beats[0].from, 0);
  assert.equal(beats.at(-1).to, boxes.length);
  for (let i = 1; i < beats.length; i++) assert.equal(beats[i].from, beats[i - 1].to);
  assert.deepEqual(planBeats(segments, diff), beats, "deterministic");
});

test("planBeats: few visible changes stay as they are", () => {
  const { segments, diff } = fake([[0, 0, 5, 5], [100, 100, 5, 5], [0, 100, 5, 5]]);
  assert.equal(planBeats(segments, diff).length, 3);
});

test("planBeats: a paged trace merges within a page before across pages", () => {
  // Steps 0-11 on page 0, 12-23 on page 1, all at the same place: page by step, and a merged
  // range is on the page its last step is on.
  const boxes = Array.from({ length: 24 }, () => [0, 0, 10, 10]);
  const base = fake(boxes);
  const pageOf = (to) => (to > 12 ? 1 : 0);
  const diff = (from, to) => ({ ...base.diff(from, to), page: pageOf(to) });
  const segments = base.segments.map((s) => ({ ...s, page: pageOf(s.to) }));
  const beats = planBeats(segments, diff, { max: 4, min: 2 });
  assert.equal(beats.length, 2);
  assert.deepEqual(beats.map((b) => [b.from, b.to, b.page]), [[0, 12, 0], [12, 24, 1]]);
});

test("kinds: command names by the rule table, beats by majority", () => {
  assert.equal(commandKind("layer.delete"), "delete");
  assert.equal(commandKind("shape.move"), "move");
  assert.equal(commandKind("text.insert"), "text");
  assert.equal(commandKind("styles.modify"), "style");
  assert.equal(commandKind("shape.rect"), "create");
  assert.equal(commandKind("slide.add"), "create");
  assert.equal(commandKind("selection.set"), "select");
  assert.equal(commandKind("document.setProperties"), "modify");
  assert.equal(beatKind(["text.insert", "text.insert", "styles.modify"]), "text");
  assert.equal(beatKind(["shape.rect", "styles.modify"]), "style"); // a tie goes to the earlier rule
  assert.equal(beatKind([]), "modify");
});

test("humanise", () => {
  assert.equal(humanise("styles.modify"), "Modify styles");
  assert.equal(humanise("table.insertRow"), "Insert row table");
  assert.equal(humanise("plain"), "Plain");
});

const SOURCE = `format: 1
title: X
steps:
  # Masthead
  - { command: text.insert, params: { text: Hi } }
  - command: styles.modify
    params:
      bold: true

  # Body: three paragraphs, each styled.
  - { command: text.insert, params: { text: "# not a comment" } }
  - { command: para.style }
expected:
  - actual: inspect
`;

test("stepLines: each step's lines and the comment above it", () => {
  const lines = stepLines(SOURCE);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((l) => [l.first, l.last, l.above]), [[4, 4, 3], [5, 7, 5], [10, 10, 9], [11, 11, 11]]);
  assert.deepEqual(lines.map((l) => l.caption), ["Masthead", null, "Body: three paragraphs, each styled.", null]);
  assert.deepEqual(stepLines("format: 1\n"), []);
  // The site shows the section from its `steps:` line: the same items, shifted.
  assert.equal(stepLines(SOURCE.slice(SOURCE.indexOf("steps:")))[0].first, 2);
});

test("captions: the comment above, else the section with the command, else the command", () => {
  const steps = stepLines(SOURCE);
  assert.equal(beatCaption(steps, 0, 2, ["text.insert", "styles.modify"]), "Masthead");
  assert.equal(beatCaption(steps, 1, 2, ["styles.modify"]), "Masthead · modify styles");
  assert.equal(beatCaption(steps, 2, 4, ["text.insert", "para.style"]), "Body: three paragraphs, each styled");
  assert.equal(beatCaption(steps, 1, 4, ["styles.modify", "text.insert", "para.style"]), "Masthead · modify styles +2"); // the section it starts in
  assert.equal(beatCaption([null, { caption: "Later" }], 0, 2, ["a.b", "c.d"]), "Later");
  assert.equal(beatCaption([null, null], 0, 2, ["shape.rect", "shape.rect"]), "Rect shape +1");
  assert.equal(shortCaption("Line items: header row in ink, amounts right-aligned."), "Line items: header row in ink, amounts right-aligned");
  assert.equal(shortCaption("Billing block and invoice details: two cells, right-aligned."), "Billing block and invoice details");
  assert.equal(shortCaption("1 — Cover"), "1 — Cover");
  assert.ok(shortCaption("word ".repeat(40)).length <= 56);
});
