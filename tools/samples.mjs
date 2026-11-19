// Reads the samples: every `<kit>/<slug>/showcase.yaml`, with its build when it has one.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { KITS, ROOT } from "./kits.mjs";

export function loadSamples(filters = []) {
  const samples = [];
  for (const kit of Object.keys(KITS)) {
    const kitDir = path.join(ROOT, kit);
    if (!fs.existsSync(kitDir)) continue;
    for (const slug of fs.readdirSync(kitDir).sort()) {
      const file = path.join(kitDir, slug, "showcase.yaml");
      if (!fs.existsSync(file)) continue;
      const id = `${kit}/${slug}`;
      if (filters.length && !filters.some((filter) => id.startsWith(filter))) continue;
      let sample;
      try {
        sample = YAML.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        // One broken sample must not stop the others (or the galleries); the build reports it.
        console.error(`✗ ${id}: showcase.yaml: ${error.message.split("\n")[0]}`);
        continue;
      }
      const buildFile = path.join(kitDir, slug, "build.json");
      const build = fs.existsSync(buildFile) ? JSON.parse(fs.readFileSync(buildFile, "utf8")) : null;
      samples.push({ ...sample, kit, slug, dir: path.dirname(file), source: fs.readFileSync(file, "utf8"), build });
    }
  }
  return samples;
}
