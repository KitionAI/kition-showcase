import assert from "node:assert/strict";
import { test } from "node:test";

import { at, checkExpected, match } from "./expect.mjs";

const doc = { layers: [{ name: "Title", kind: "Type", opacity: 0.4, text: { text: "Fall Sale" } }, { name: "Background", kind: "Pixel", opacity: 1 }] };

test("paths read objects and lists, negative indexes from the end", () => {
  assert.equal(at(doc, "layers.0.name"), "Title");
  assert.equal(at(doc, "layers.-1.name"), "Background");
  assert.equal(at(doc, "layers.5.name"), undefined);
  assert.equal(at(doc, ""), doc);
});

test("plain values compare deeply; partial objects ignore other fields", () => {
  assert.deepEqual(match(at(doc, "layers.0"), { name: "Title", text: { text: "Fall Sale" } }), []);
  assert.equal(match(at(doc, "layers.0"), { name: "Other" }).length, 1);
  assert.deepEqual(match([1, 2], [1, 2]), []);
  assert.deepEqual(match([1, 2.0004], [1, { approx: 2, tol: 0.001 }]), []);
  assert.equal(match([1, 2, 3], [1, 2]).length, 1);
  assert.equal(match([1, 2], [2, 1]).length, 2);
});

test("matchers: count, approx, min/max, any/all/none, contains, matches, oneOf, exists", () => {
  assert.deepEqual(match(doc.layers, { count: 2, any: { name: "Background" } }), []);
  assert.equal(match(doc.layers, { count: 3 }).length, 1);
  assert.deepEqual(match(0.4, { approx: 0.41, tol: 0.02 }), []);
  assert.equal(match(0.4, { approx: 0.5, tol: 0.01 }).length, 1);
  assert.deepEqual(match(5, { min: 2, max: 9 }), []);
  assert.equal(match(10, { max: 9 }).length, 1);
  assert.deepEqual(match(doc.layers, { all: { kind: { oneOf: ["Type", "Pixel"] } } }), []);
  assert.equal(match(doc.layers, { none: { kind: "Pixel" } }).length, 1);
  assert.deepEqual(match("Layer 3", { contains: "yer", matches: "^Layer \\d$" }), []);
  assert.deepEqual(match(undefined, { exists: false }), []);
  assert.equal(match(1, { exists: false }).length, 1);
});

test("a failing matcher names where it failed", () => {
  const [problem] = match(at(doc, "layers.1.opacity"), { approx: 0.5, tol: 0.01 }, "inspect.layers.1.opacity");
  assert.match(problem, /^inspect\.layers\.1\.opacity: expected 0\.5/);
});

test("diagnostics must equal the sample's codes, none by default", () => {
  const build = { inspect: doc, report: { results: {}, diagnostics: [{ code: "photo.font-substituted" }] } };
  assert.equal(checkExpected({}, build).length, 1);
  assert.deepEqual(checkExpected({ diagnostics: ["photo.font-substituted"] }, build), []);
});

test("expected entries read inspect, results or report", () => {
  const build = { inspect: doc, report: { width: 1200, results: { card: { layer: 6 } }, diagnostics: [] } };
  const sample = {
    expected: [
      { actual: "inspect", values: { layers: { count: 2 } } },
      { actual: "results", values: { "card.layer": 6 } },
      { actual: "report", values: { width: 1200 } },
    ],
  };
  assert.deepEqual(checkExpected(sample, build), []);
  assert.equal(checkExpected({ expected: [{ actual: "nope", values: {} }] }, build).length, 1);
});
