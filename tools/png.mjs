// Pixel comparison of two PNGs with the tolerance fields of the kits' `case.yaml` `png` compare.

import fs from "node:fs";
import { PNG } from "pngjs";

// `render` is kition-film testkit's Tolerance::RENDER, the preset for an engine's own renders.
export const PRESETS = {
  exact: { max_abs: 0 },
  render: { min_psnr: 45, max_abs: 12, p99: 2 },
};

export function comparePng(actualPath, expectedPath, tolerance = PRESETS.render) {
  const limits = typeof tolerance === "string" ? PRESETS[tolerance] : tolerance;
  const a = PNG.sync.read(fs.readFileSync(actualPath));
  const b = PNG.sync.read(fs.readFileSync(expectedPath));
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, problems: [`size ${a.width}×${a.height}, expected ${b.width}×${b.height}`] };
  }
  const histogram = new Uint32Array(256);
  let maxAbs = 0;
  let squared = 0;
  const pixels = a.width * a.height;
  for (let i = 0; i < pixels; i += 1) {
    let largest = 0;
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
      squared += d * d;
      if (d > largest) largest = d;
    }
    histogram[largest] += 1;
    if (largest > maxAbs) maxAbs = largest;
  }
  let p99 = 0;
  for (let seen = 0; p99 < 256; p99 += 1) {
    seen += histogram[p99];
    if (seen >= pixels * 0.99) break;
  }
  const mse = squared / (pixels * 4);
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  const problems = [];
  if (limits.max_abs !== undefined && maxAbs > limits.max_abs) problems.push(`max_abs ${maxAbs} > ${limits.max_abs}`);
  if (limits.p99 !== undefined && p99 > limits.p99) problems.push(`p99 ${p99} > ${limits.p99}`);
  if (limits.min_psnr !== undefined && psnr < limits.min_psnr) problems.push(`psnr ${psnr.toFixed(1)} < ${limits.min_psnr}`);
  return { ok: problems.length === 0, problems, maxAbs, p99, psnr };
}
