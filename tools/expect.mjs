// The `expected` checks of a sample: values read from the build's report, results and inspection,
// with the matchers of the kits' `case.yaml` `values` compare (literal, count, approx, any, …).

import { isDeepStrictEqual } from "node:util";

// `a.b.0.c` → the value at that path; a missing step is `undefined`.
export function at(value, dotted) {
  if (dotted === "" || dotted === undefined) return value;
  let current = value;
  for (const key of String(dotted).split(".")) {
    if (current === null || current === undefined) return undefined;
    current = Array.isArray(current) && /^-?\d+$/.test(key) ? current.at(Number(key)) : current[key];
  }
  return current;
}

const OPERATORS = new Set(["count", "approx", "tol", "any", "all", "none", "contains", "min", "max", "exists", "matches", "oneOf"]);

function isMatcher(spec) {
  return spec !== null && typeof spec === "object" && !Array.isArray(spec) && Object.keys(spec).length > 0 && Object.keys(spec).every((key) => OPERATORS.has(key));
}

// Problems with `actual` against `spec`, each a sentence naming `where`.
export function match(actual, spec, where = "value") {
  if (!isMatcher(spec)) {
    if (Array.isArray(spec)) {
      // Entry by entry, so entries may be matchers too.
      if (!Array.isArray(actual) || actual.length !== spec.length) return [`${where}: expected ${spec.length} entries ${JSON.stringify(spec)}, got ${JSON.stringify(actual)}`];
      return spec.flatMap((inner, index) => match(actual[index], inner, `${where}.${index}`));
    }
    if (spec !== null && typeof spec === "object") {
      // A partial object: every named field must match.
      if (actual === null || typeof actual !== "object") return [`${where}: expected an object, got ${JSON.stringify(actual)}`];
      return Object.entries(spec).flatMap(([key, inner]) => match(at(actual, key), inner, `${where}.${key}`));
    }
    return isDeepStrictEqual(actual, spec) ? [] : [`${where}: expected ${JSON.stringify(spec)}, got ${JSON.stringify(actual)}`];
  }
  const problems = [];
  if ("exists" in spec && (actual !== undefined) !== spec.exists) problems.push(`${where}: expected it ${spec.exists ? "to exist" : "to be absent"}`);
  if ("count" in spec) {
    const length = Array.isArray(actual) || typeof actual === "string" ? actual.length : undefined;
    if (length !== spec.count) problems.push(`${where}: expected ${spec.count} entries, got ${length ?? JSON.stringify(actual)}`);
  }
  if ("approx" in spec && !(typeof actual === "number" && Math.abs(actual - spec.approx) <= (spec.tol ?? 1e-9))) {
    problems.push(`${where}: expected ${spec.approx} ± ${spec.tol ?? 1e-9}, got ${JSON.stringify(actual)}`);
  }
  if ("min" in spec && !(typeof actual === "number" ? actual >= spec.min : actual?.length >= spec.min)) problems.push(`${where}: expected at least ${spec.min}, got ${JSON.stringify(actual)}`);
  if ("max" in spec && !(typeof actual === "number" ? actual <= spec.max : actual?.length <= spec.max)) problems.push(`${where}: expected at most ${spec.max}, got ${JSON.stringify(actual)}`);
  if ("contains" in spec) {
    const ok = typeof actual === "string" ? actual.includes(spec.contains) : Array.isArray(actual) && actual.some((item) => isDeepStrictEqual(item, spec.contains));
    if (!ok) problems.push(`${where}: expected it to contain ${JSON.stringify(spec.contains)}`);
  }
  if ("matches" in spec && !(typeof actual === "string" && new RegExp(spec.matches).test(actual))) problems.push(`${where}: expected to match /${spec.matches}/, got ${JSON.stringify(actual)}`);
  if ("oneOf" in spec && !spec.oneOf.some((option) => isDeepStrictEqual(option, actual))) problems.push(`${where}: expected one of ${JSON.stringify(spec.oneOf)}, got ${JSON.stringify(actual)}`);
  const list = Array.isArray(actual) ? actual : undefined;
  if ("any" in spec && !(list ?? []).some((item) => match(item, spec.any, where).length === 0)) problems.push(`${where}: no entry matches ${JSON.stringify(spec.any)}`);
  if ("all" in spec) {
    if (!list) problems.push(`${where}: expected a list`);
    else list.forEach((item, index) => problems.push(...match(item, spec.all, `${where}.${index}`)));
  }
  if ("none" in spec && (list ?? []).some((item) => match(item, spec.none, where).length === 0)) problems.push(`${where}: an entry matches ${JSON.stringify(spec.none)}`);
  return problems;
}

// The sample's `expected` against the build: `{ actual: inspect|results|report, values: { path: matcher } }`
// entries, and the diagnostics, which must be exactly the sample's `diagnostics` codes (none by default).
export function checkExpected(sample, build) {
  const sources = { inspect: build.inspect, results: build.report.results, report: build.report };
  const problems = [];
  for (const [index, entry] of (sample.expected ?? []).entries()) {
    const source = sources[entry.actual ?? "inspect"];
    if (source === undefined) {
      problems.push(`expected.${index}: unknown actual ${JSON.stringify(entry.actual)} (inspect, results or report)`);
      continue;
    }
    for (const [dotted, spec] of Object.entries(entry.values ?? {})) {
      const value = at(source, dotted);
      const found = match(value, spec, `${entry.actual ?? "inspect"}.${dotted}`);
      if (found.length && value === undefined) {
        // Say what is there instead, so the path can be fixed.
        const keys = String(dotted).split(".");
        let depth = keys.length - 1;
        while (depth > 0 && at(source, keys.slice(0, depth).join(".")) === undefined) depth -= 1;
        const parent = at(source, keys.slice(0, depth).join("."));
        const shown = parent !== null && typeof parent === "object" ? JSON.stringify(parent).slice(0, 300) : JSON.stringify(parent);
        found.push(`  (${[entry.actual ?? "inspect", ...keys.slice(0, depth)].join(".")} is ${shown})`);
      }
      problems.push(...found);
    }
  }
  const codes = (build.report.diagnostics ?? []).map((diagnostic) => diagnostic.code).sort();
  const allowed = [...(sample.diagnostics ?? [])].sort();
  if (!isDeepStrictEqual(codes, allowed)) problems.push(`diagnostics: expected ${JSON.stringify(allowed)}, got ${JSON.stringify(codes)}`);
  return problems;
}
