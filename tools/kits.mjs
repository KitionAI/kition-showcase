// The kits the showcase builds samples for: where each kit's repository is, which example builds a
// sample, and how a sample's inspection reads as one line in the gallery.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The KitionAI checkouts sit side by side; KITION_ROOT points elsewhere.
export const KITION_ROOT = path.resolve(process.env.KITION_ROOT ?? path.join(ROOT, ".."));
export const FONTS = path.join(KITION_ROOT, "kition-fonts", "fonts");

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function photoLayers(layers, out = []) {
  for (const layer of layers ?? []) {
    out.push(layer);
    photoLayers(layer.children, out);
  }
  return out;
}

function filmItems(tracks) {
  return (tracks ?? []).flatMap((track) => track.items ?? []);
}

// The order every list of all kits follows: Office, Design, Media, Engineering.
export const KIT_ORDER = ["note", "table", "board", "doc", "sheet", "slide", "pdf", "html", "photo", "vector", "layout", "design", "film", "motion", "cad", "scene"];
export const byKitOrder = (a, b) => KIT_ORDER.indexOf(a) - KIT_ORDER.indexOf(b);

export const KITS = {
  film: {
    repo: "kition-film",
    package: "kition-film-kit",
    title: "Film",
    tagline: "Video edits: synthetic footage, titles, shapes, effects, keyframes, transitions and audio. Saved as .kfilm.",
    extensions: [".kfilm"],
    // The command that moves the frame being rendered, for thumbnails and previews.
    seek: "playhead.set",
    // Only the bundled fonts and the sample's `fonts:`: the machine's own fonts differ between machines.
    env: { KITION_FILM_NO_SYSTEM_FONTS: "1" },
    // Steps a sample can start with (`prelude: <name>`).
    preludes: {
      // The demo project's footage without its sequences: items 5 Ocean_Sunset, 6 Aurora_Timelapse,
      // 7 City_Night_Drive, 8 Desert_Dunes, 9 Misty_Forest, 10 Neon_Loop (moving pictures with
      // sound), 11 Ambient_Score.wav (sound), 12 Bars and Tone, 13 Universal Counting Leader,
      // 14 Color Matte. The next new item is 15.
      "demo-footage": [
        { command: "file.openDemoProject", as: "demo" },
        { command: "project.delete", params: { items: ["$demo.sequence", 27] } },
      ],
    },
    stats(inspect) {
      const sequence = inspect.sequence ?? {};
      const video = filmItems(sequence.video);
      const audio = filmItems(sequence.audio);
      const effects = video.flatMap((clip) => clip.effects ?? []).filter((effect) => !["motion", "opacity", "time_remap"].includes(effect.effect));
      const keyframed = [...video, ...audio].flatMap((clip) => clip.effects ?? []).filter((effect) => Object.values(effect.params ?? {}).some((param) => (param.keyframes?.length ?? 0) > 0));
      const transitions = [...(sequence.video ?? []), ...(sequence.audio ?? [])].flatMap((track) => track.transitions ?? []);
      const fps = sequence.settings?.frame_rate;
      const seconds = (sequence.duration ?? 0) / (inspect.ticksPerSecond ?? 1);
      const parts = [
        `${sequence.settings?.width ?? "?"} × ${sequence.settings?.height ?? "?"}${fps ? ` @ ${+(fps.num / fps.den).toFixed(3)} fps` : ""}`,
        `${seconds.toFixed(1)} s`,
        plural(video.length, "video clip"),
      ];
      if (audio.length) parts.push(plural(audio.length, "audio clip"));
      if (effects.length) parts.push(plural(effects.length, "effect"));
      if (keyframed.length) parts.push(plural(keyframed.length, "animated effect"));
      if (transitions.length) parts.push(plural(transitions.length, "transition"));
      if (sequence.markers?.length) parts.push(plural(sequence.markers.length, "marker"));
      return parts.join("; ");
    },
  },
  photo: {
    repo: "kition-photo",
    package: "kition-photo-kit",
    title: "Photo",
    tagline: "Layered images: shapes, type, adjustment and fill layers, styles, masks, filters. Saved as PSD.",
    extensions: [".psd", ".kphoto"],
    // Only the built-in fonts and the sample's `fonts:`: the machine's own fonts differ between machines.
    env: { KITION_PHOTO_NO_SYSTEM_FONTS: "1" },
    // The built-in Inter is Regular, Medium and SemiBold; kition-fonts' variable Inter has every weight.
    defaultFonts: ["inter/Inter-Variable.ttf"],
    stats(inspect) {
      const layers = photoLayers(inspect.layers);
      const count = (kind) => layers.filter((layer) => layer.kind === kind).length;
      const styled = layers.filter((layer) => (layer.effects?.items ?? []).length > 0).length;
      const masked = layers.filter((layer) => layer.hasMask).length;
      const parts = [`${inspect.width} × ${inspect.height} px`, plural(layers.length, "layer")];
      for (const [kind, name] of [["Type", "type layer"], ["Shape", "shape layer"], ["Adjustment", "adjustment layer"], ["Fill", "fill layer"], ["Smart Object", "smart object"], ["Group", "group"]]) {
        if (count(kind)) parts.push(plural(count(kind), name));
      }
      if (styled) parts.push(plural(styled, "styled layer"));
      if (masked) parts.push(plural(masked, "mask"));
      return parts.join("; ");
    },
  },
  sheet: {
    repo: "kition-sheet",
    package: "kition-sheet-kit",
    title: "Sheet",
    tagline: "Spreadsheets: formulas, number formats, styles, merged cells, tables, charts and several sheets. Saved as .xlsx.",
    extensions: [".xlsx"],
    // The grid's top-left corner, headings included.
    thumbnailArea: [0, 0, 1280, 800],
    stats(inspect) {
      const parts = [plural(inspect.sheets?.length ?? 1, "sheet")];
      if (inspect.used) parts.push(`used range ${inspect.used}`);
      if (inspect.shapes?.length) parts.push(plural(inspect.shapes.length, "shape"));
      return parts.join("; ");
    },
  },
  doc: {
    repo: "kition-doc",
    package: "kition-doc-kit",
    title: "Doc",
    tagline: "Word-processing documents: styles, lists, tables, headers and footers, sections, columns and fields. Saved as .docx.",
    extensions: [".docx"],
    thumbnailArea: "$inspect.pages.0.area",
    stats(inspect) {
      const parts = [plural(inspect.pages?.length ?? 1, "page"), plural(inspect.words ?? 0, "word")];
      if (inspect.shapes?.length) parts.push(plural(inspect.shapes.length, "shape"));
      return parts.join("; ");
    },
  },
  slide: {
    repo: "kition-slide",
    package: "kition-slide-kit",
    title: "Slide",
    tagline: "Presentations: layouts, themes, shapes, text, tables, charts, transitions and animations. Saved as .pptx.",
    extensions: [".pptx"],
    thumbnailArea: "$inspect.slides.0.area",
    stats(inspect) {
      const size = inspect.slideSize ? `${inspect.slideSize.width} × ${inspect.slideSize.height} pt` : null;
      return [plural(inspect.slides?.length ?? 1, "slide"), size].filter(Boolean).join("; ");
    },
  },
  pdf: { repo: "kition-pdf", package: "kition-pdf-kit", title: "PDF", extensions: [".pdf"], thumbnailArea: "$inspect.pages.0.area",
    // Added text is drawn from these and embedded: Arimo, Tinos and Cousine stand in for
    // Helvetica, Times and Courier (their metrics), Droid Sans Fallback draws Chinese and Japanese.
    defaultFonts: ["arimo/Arimo-Variable.ttf", "arimo/Arimo-Italic-Variable.ttf", "tinos/Tinos-Regular.ttf", "tinos/Tinos-Bold.ttf", "tinos/Tinos-Italic.ttf",
      "tinos/Tinos-BoldItalic.ttf", "cousine/Cousine-Regular.ttf", "cousine/Cousine-Bold.ttf", "droid-sans-fallback/DroidSansFallbackFull.ttf"],
    stats: (i) => [plural(i.pages?.length ?? 0, "page"), Array.isArray(i.formFields) ? i.formFields.length && plural(i.formFields.length, "form field") : i.formFields && plural(i.formFields, "form field")].filter(Boolean).join("; "),
    tagline: "PDF documents: pages, text, annotations, forms, bookmarks, links and redaction. Saved as PDF." },
  board: { repo: "kition-board", package: "kition-board-kit", title: "Board", extensions: [".kboard"],
    stats: (i) => [plural(i.pages?.length ?? 1, "page"), plural(Array.isArray(i.elements) ? i.elements.length : i.elements ?? 0, "element")].join("; "),
    tagline: "Infinite whiteboards: shapes, sticky notes, connectors, freehand, frames and mind maps. Saved as .kboard." },
  table: { repo: "kition-table", package: "kition-table-kit", title: "Table", extensions: [".ktable"],
    // The faces the picture draws with (kition-table-fonts CHECKOUT_FILES); a sample's fonts: replace them.
    defaultFonts: ["inter/Inter-Variable.ttf", "droid-sans-fallback/DroidSansFallbackFull.ttf", "noto-color-emoji/Noto-COLRv1.ttf"],
    stats: (i) => [plural(i.tables?.length ?? 0, "table"), i.dashboards?.length && plural(i.dashboards.length, "dashboard")].filter(Boolean).join("; "),
    tagline: "Relational tables: typed fields, linked records, views, filters, sorts and grouping. Saved as .ktable." },
  vector: { repo: "kition-vector", package: "kition-vector-kit", title: "Vector", extensions: [".kvector"],
    stats: (i) => [plural(i.artboards?.length ?? 1, "artboard"), plural(i.layers?.length ?? 0, "layer"), plural(Array.isArray(i.objects) ? i.objects.length : i.objects ?? 0, "object")].join("; "),
    tagline: "Vector illustration: paths, shapes, gradients, strokes, type and artboards. Saved as .kvector." },
  cad: { repo: "kition-cad", package: "kition-cad-kit", title: "CAD", extensions: [".dxf"],
    stats: (i) => [plural(Array.isArray(i.entities) ? i.entities.length : i.entities ?? 0, "object"), plural(i.layers?.length ?? 0, "layer")].join("; "),
    tagline: "2D drafting: lines, arcs, polylines, hatches, dimensions, layers and blocks. Saved as DXF." },
  note: { repo: "kition-note", package: "kition-note-kit", title: "Note", extensions: [".md"],
    stats: (i) => [plural(i.pages ?? 1, "page"), plural(i.words ?? 0, "word"), i.headings && plural(Array.isArray(i.headings) ? i.headings.length : i.headings, "heading"), i.tables?.length && plural(i.tables.length, "table")].filter(Boolean).join("; "),
    // The faces the editor hands the view (kition-note-fonts CHECKOUT_FILES); a sample's fonts: replace them.
    defaultFonts: ["inter/Inter-Variable.ttf", "jetbrains-mono/JetBrainsMono-Variable.ttf", "droid-sans-fallback/DroidSansFallbackFull.ttf", "noto-color-emoji/Noto-COLRv1.ttf"],
    tagline: "Markdown notes, Obsidian-flavoured: headings, lists, tasks, tables, callouts, links and code. Saved as .md." },
  layout: { repo: "kition-layout", package: "kition-layout-kit", title: "Layout", extensions: [".klayout"],
    stats: (i) => [plural(i.pageCount ?? 1, "page"), plural(i.stories?.length ?? 0, "story", "stories"), plural(i.paragraphStyles?.length ?? 0, "paragraph style")].join("; "),
    tagline: "Page layout: frames, text flow, master pages, styles, colour swatches and grids. Saved as .klayout." },
  design: { repo: "kition-design", package: "kition-design-kit", title: "Design", extensions: [".kdesign"],
    stats: (i) => [plural(i.pages?.length ?? 1, "page"), plural(Array.isArray(i.layers) ? i.layers.length : i.layers ?? 0, "layer"), i.contentBounds && `${Math.round(i.contentBounds.width)} × ${Math.round(i.contentBounds.height)} design`].filter(Boolean).join("; "),
    tagline: "Interface design and prototyping: frames, auto layout, components, variants and constraints. Saved as .kdesign." },
  html: { repo: "kition-html", package: "kition-html-kit", title: "HTML", extensions: [".html"],
    // The faces a host adds (add_font) beside the bundled Inter: serif, monospace, Chinese and emoji; a sample's fonts: replace them.
    defaultFonts: ["lora/Lora-Variable.ttf", "jetbrains-mono/JetBrainsMono-Variable.ttf", "droid-sans-fallback/DroidSansFallbackFull.ttf", "noto-color-emoji/Noto-COLRv1.ttf"],
    stats: (i) => `${i.width} × ${i.height} px; ${(String(i.source ?? "").length / 1024).toFixed(1)} KB of HTML`,
    tagline: "Web pages drawn by Kition's own HTML and CSS renderer: layout, typography, flex, grid and tables. Saved as .html." },
  motion: { repo: "kition-motion", package: "kition-motion-kit", title: "Motion", extensions: [".kmotion"], seek: "time.set", seekParam: "time",
    stats: (i) => [`${i.comp?.duration} s at ${i.comp?.frameRate} fps`, plural(i.info?.layers?.length ?? 0, "layer"), plural((i.info?.layers ?? []).filter((l) => (l.animated ?? []).length).length, "animated layer")].join("; "),
    tagline: "Motion graphics and visual effects: layers, shapes, text animators, keyframes and effects. Saved as .kmotion." },
  scene: { repo: "kition-scene", package: "kition-scene-kit", title: "Scene", extensions: [".kscene"],
    stats: (i) => { const of = (t) => (i.objects ?? []).filter((o) => o.type === t).length; return [plural(of("mesh"), "mesh", "meshes"), plural(i.materials?.length ?? 0, "material"), plural(of("light"), "light")].join("; "); },
    tagline: "3D scenes: primitives, modifiers, sculpting, curves, text, materials, lights and cameras. Saved as .kscene." },
};

// The Rust toolchain the kits need (their rust-version); a Homebrew rustc earlier on PATH is too old.
export function cargoEnv() {
  const toolchain = process.env.KITION_TOOLCHAIN ?? path.join(process.env.HOME, ".rustup", "toolchains", "1.95-aarch64-apple-darwin", "bin");
  return {
    cargo: path.join(toolchain, "cargo"),
    env: { ...process.env, PATH: `${toolchain}:${process.env.PATH}`, RUSTC: path.join(toolchain, "rustc") },
  };
}
