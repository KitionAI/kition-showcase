# Writing a sample

A sample is one folder, `<kit>/<slug>/`, with one hand-written file, `showcase.yaml`. Everything
else in the folder is made by `node tools/build.mjs <kit>/<slug>` and committed with it:

| File | What |
|---|---|
| `showcase.yaml` | The sample: what it is, the kit commands that build it, and the checks it must pass |
| `<document.name>` | The document the kit saved (`.kfilm`, `.psd`, …); the build also checks that it opens again |
| `thumb.png` | The kit's own render, at most 640 px on the long side (the frame at `thumbnail.at` for film) |
| `preview.webp` | Kits with time: an animated preview of frames the kit rendered |
| `build.json` | What was built: the kit commit, size, contents line, checksums, timings |
| `README.md` | The sample's page (generated; never edit it) |

The galleries (`README.md`, `<kit>/README.md`) are generated too.

## `showcase.yaml`

```yaml
format: 1
id: film/aurora-title-card          # <kit>/<slug>; the folder's path
title: Aurora Title Card            # Title Case, at most ~32 characters (it is a card title)
summary: An opening title fades in over a moving aurora, with a slow push-in on the footage.
category: Titles & Graphics         # one of the kit's categories below
tags: [titles, keyframes, opacity]  # lowercase-with-dashes; reuse the tags already in <kit>/README.md
features: [film.graphics.text-basics, film.effects.keyframes]   # ids from the kit's features.yaml
featured: true                      # optional: shown on the front page (a few per kit)
description: |                      # optional: a paragraph for the sample page
  What the sample shows and what is worth noticing.
document: { name: aurora-title-card.kfilm, width: 1280, height: 720 }
fonts: [droid-sans-fallback/DroidSansFallbackFull.ttf]   # optional: files under ../kition-fonts/fonts
prelude: demo-footage               # optional: steps the kit defines in tools/kits.mjs
steps:                              # the kit's engine commands, in order
  - { command: timeline.place, params: { item: 6, track: V1, seconds: 0 }, as: footage }
  - { command: effects.setParam, params: { clip: $footage.clips.0, effect: motion, param: scale, value: 112, seconds: 4 } }
thumbnail: { at: 2 }                # film: the second to show; optional `max` (640) and `steps`
preview: { from: 0, to: 3, fps: 10, max: 400 }   # film only: the animated preview
expected:                           # checks on the result (at least one; see below)
  - actual: inspect
    values:
      sequence.video.0.items: { count: 1 }
diagnostics: []                     # the codes the kit's check must report: none by default
since: "2026-11-09"
```

`$name.path` in a parameter is the value at `path` in the result of the step saved `as: name`
(`$footage.clips.0`, `$card.layer`). Only a string that *starts* with `$` is a reference: write
`$$` at the start for a literal one (`"$$4.82M"`); a `$` later in a string (`"A $14B market"`) is plain text. Run a step alone first if you do not
know what it answers: the build prints the error with the result it got.

### Checks

`expected` is what makes a sample a test. Each entry reads one source:

- `inspect`: the kit's `inspect()` JSON of the finished document (film: `sequence.*`, `project.*`;
  photo: `layers.*`, `width`, …),
- `results`: the answers of the steps saved with `as`,
- `report`: the build report (`width`, `height`, `steps`, `saved.bytes`, …),

and checks paths in it (`a.b.0.c`; negative indexes count from the end) with these matchers:

| Matcher | Holds when |
|---|---|
| a plain value | equal (deep) |
| `{ name: Title, kind: Type }` | every named field matches (other fields are ignored) |
| `{ count: 3 }` | a list or string has that length |
| `{ approx: 0.4, tol: 0.01 }` | a number within `tol` |
| `{ min: 2 }`, `{ max: 9 }` | a number (or a length) in range |
| `{ any: {…} }`, `{ all: {…} }`, `{ none: {…} }` | some / every / no entry of a list matches |
| `{ contains: x }` | a string contains `x`, or a list has an entry equal to `x` |
| `{ matches: "^Layer" }`, `{ oneOf: [a, b] }`, `{ exists: false }` | as named |

Matchers combine in one map (`{ count: 9, any: { name: Headline } }`). Check what the sample is
about: the layer stack and the styled layer, the clip count and the keyframed parameter, the
transition's length. A check that cannot fail checks nothing.

`diagnostics` lists the codes the kit's own check must report; a clean sample has none. A sample
about a problem (a gap in the timeline, text off the canvas) names its code here.

## Kits

Build each kit's example once (`node tools/build.mjs <kit>/` does it), then print its command
catalogue with every command's parameters:

```sh
../kition-film/target/release/examples/showcase --commands > /tmp/film-commands.json
../kition-photo/target/release/examples/showcase --commands > /tmp/photo-commands.json
```

### Film

- Times are `seconds` in parameters (or `frame`, or `time` in ticks: 254 016 000 000 per second).
- `prelude: demo-footage` brings the kit's procedural footage: items **5** Ocean_Sunset (18 s),
  **6** Aurora_Timelapse (16 s), **7** City_Night_Drive (14 s), **8** Desert_Dunes (15 s),
  **9** Misty_Forest (12 s), **10** Neon_Loop (10 s), all with sound; **11** Ambient_Score.wav
  (60 s, sound only); **12** Bars and Tone, **13** Universal Counting Leader, **14** Color Matte.
  New items made by the sample get the next ids (use `as` and `$name.item` rather than counting).
- Without the prelude, `file.newColorMatte`, `file.newBarsAndTone`, `file.newBlackVideo`,
  `file.newTransparentVideo`, `file.newCountingLeader` and `file.newAdjustmentLayer` make items, and
  `graphics.newText` / `graphics.newShape` make graphic clips.
- With `prelude: demo-footage`, start with `file.newSequence` (name, width, height, fps, video and
  audio track counts); it opens the new sequence. Without the prelude the new document already has
  an empty `Sequence 01`: set it up with `sequence.settings { name, width, height, fps }` instead, or
  the check reports the empty one (`film.empty-sequence`).
- `timeline.place` answers `clips` (video and linked audio); `graphics.newText` answers `clip`;
  `timeline.razor` answers the pieces it made. A shape's `position` is its centre; path `points` and
  mask vertices are frame pixels. A graphic clip's layers start at effect index 3 (after motion,
  opacity and time_remap). Scale Width is refused while Uniform Scale is on (`uniform_scale: false`).
- Effects, parameters and choices may be named (`effect: "Gaussian Blur"`, `blend: Screen`); marker
  colours take names (Red, Orange…) and markers take `seconds`. In the inspection, parameter values
  are JSON and keyframes list `{ time, value, interpolation }` (times in ticks).
- Renders use no machine fonts (`KITION_FILM_NO_SYSTEM_FONTS`): name only fonts loaded with `fonts:`
  (or Inter); any other family is reported as `film.font-missing`.
- Opacity and dissolves blend in linear light, as Premiere composites by default: a black layer at
  50 % over white looks about 74 % white, so dark bands need 85–90 % opacity.
- Categories: **Titles & Graphics**, **Editing & Timeline**, **Transitions**, **Effects & Color**,
  **Keyframes & Motion**, **Audio**, **Markers & Captions**, **Formats & Social**.

### Photo

- Documents start with a white `Background` pixel layer. Coordinates are document pixels; `y` of
  point text is its baseline.
- There are no photographs: make pictures from fill layers, shapes, `filter.render.*` (clouds,
  fibers, lens flare, lighting, flame, tree, picture frame), noise and blur filters and adjustment
  layers.
- Shape and type commands answer `layer`; `layer.new.*` answers the new layer.
- Fonts: Inter is built in as Regular, Medium and SemiBold; load `inter/Inter-Variable.ttf` for other
  weights (Light, Bold, Black) and axes. Colour emoji draw from `noto-color-emoji/Noto-COLRv1.ttf`.
  Add others with `fonts:` (see `../kition-fonts/fonts`: Lora, Bricolage
  Grotesque, Arimo, Tinos, Cousine, Carlito, Caladea, JetBrains Mono, Droid Sans Fallback for
  Chinese and Japanese, Noto Color Emoji) and name the family in `font`.
- Categories: **Posters & Marketing**, **Social Media**, **Typography**, **Adjustments & Color**,
  **Layer Styles**, **Masks & Compositing**, **Shapes & Illustration**, **Filters & Textures**,
  **UI & Web Design**, **Print & Stationery**.

### Sheet, Doc and Slide

- `thumbnail.area` picks what the thumbnail shows, in document pixels: `[x, y, width, height]`, or
  a place in the inspection such as `$inspect.pages.1.area`. The defaults are the first page (doc),
  the first slide (slide) and the grid's top-left 1280 × 800 (sheet). Renders never scale up, so
  choose an area at most about 1280 px wide.
- New slide documents start with one slide whose title and subtitle placeholders are empty; fill or
  delete them, or the check reports `slide.empty-placeholder`.
- Sheet thumbnails show the grid with its headings: keep the data near A1, size the columns, and
  make the first screen look like the finished workbook.
- Sheet categories: **Finance & Budgets**, **Formulas & Functions**, **Formatting & Styles**,
  **Charts**, **Tables & Data**, **Planners & Trackers**, **Business Templates**.
- Doc categories: **Letters & Memos**, **Reports & Proposals**, **Resumes**, **Academic**,
  **Contracts & Forms**, **Newsletters & Layout**.
- Slide categories: **Pitch Decks**, **Business Reports**, **Education**, **Layouts & Themes**,
  **Charts & Tables**, **Animations & Transitions**, **Events & Marketing**.

### PDF, Note, HTML, Board, Table, CAD, Vector, Layout, Design, Motion and Scene

- Print each kit's catalogue with `../kition-<kit>/target/release/examples/showcase --commands`
  (HTML: `../kition-html/target/release/examples/showcase`). HTML has five commands: build the page
  with `html.setSource { source }`.
- `fonts:` works for every kit but CAD and Scene, which draw only their bundled fonts and refuse a
  sample that names `fonts:`. A sample's `fonts:` replace its kit's defaults: PDF gets Arimo, Tinos,
  Cousine and Droid Sans Fallback; Photo gets Inter's variable font (its built-in Inter has no
  Bold); Table gets Inter, Droid Sans Fallback and Noto Color Emoji; Note gets Inter, JetBrains
  Mono, Droid Sans Fallback and Noto Color Emoji; HTML gets Lora, JetBrains Mono, Droid Sans
  Fallback and Noto Color Emoji.
- Thumbnails show the whole document unless `thumbnail.area` says otherwise; PDF defaults to its
  first page (`$inspect.pages.0.area`). Motion has time: `thumbnail.at` and `preview` work as for
  Film (through `time.set`).
- Categories (pick the closest; add one only when none fits):
  - PDF: **Forms**, **Annotations & Review**, **Reports & Documents**, **Bookmarks & Links**, **Redaction**
  - Note: **Notes & Journals**, **Project Docs**, **Knowledge Base**, **Checklists & Tasks**, **Technical Writing**
  - HTML: **Landing Pages**, **Flex & Grid Layout**, **Typography**, **Tables & Data**, **Email Templates**, **Components**
  - Board: **Brainstorming**, **Diagrams & Flows**, **Mind Maps**, **Planning**, **Retrospectives**
  - Table: **CRM & Sales**, **Projects & Tasks**, **Inventory**, **Content Calendars**, **Databases**
  - CAD: **Floor Plans**, **Mechanical Parts**, **Site & Landscape**, **Schematics**, **Dimensions & Annotation**
  - Vector: **Illustration**, **Icons & Logos**, **Lettering**, **Patterns**, **Infographics**
  - Layout: **Magazines & Books**, **Brochures & Flyers**, **Posters**, **Stationery**, **Reports**
  - Design: **Mobile Apps**, **Web Pages**, **Components & Variants**, **Dashboards**, **Prototypes**
  - Motion: **Titles & Typography**, **Shape Animation**, **Visual Effects**, **Lower Thirds**, **Logo Reveals**
  - Scene: **Product Renders**, **Architecture & Interiors**, **Sculpting & Characters**, **Abstract & Motion**, **Materials & Lighting**

## Quality bar

- **Real scenarios.** A sample is something a person would make: a product launch title, a podcast
  audiogram, a café menu, an app store screenshot, a wedding invitation. Name it that way.
- **It looks good as a thumbnail.** It is seen at 300 px wide next to others: a clear composition,
  a deliberate palette, readable type, no clutter. Look at `thumb.png` (and the preview) before you
  commit, and fix what looks wrong.
- **One idea per sample**, shown clearly, plus whatever makes it a believable document.
- **Original content only.** Our own words, no real brands, logos, people or trademarks; no assets
  from other products. Only the kit's procedural media, generated content and kition-fonts.
- **Deterministic.** The build must give the same bytes every time; no dates, random seeds or
  system fonts that differ between machines (use `fonts:` for anything beyond Inter).
- **Small.** Keep photo documents at or below about 1600 px on the long side and film previews at
  a few seconds.

## Build and check

```sh
node tools/build.mjs photo/autumn-sale-poster   # build one sample (and the galleries)
node tools/build.mjs --check                    # rebuild everything into a temporary folder and compare
```

`--check` fails when a check fails, a thumbnail moves beyond the `render` tolerance (PSNR ≥ 45 dB,
largest channel difference ≤ 12, 99th percentile ≤ 2), or a contents line changes. When a kit
change is meant to change a sample, rebuild it and commit the new files with the kit commit named in
the message.

## Export

```sh
node tools/export.mjs --out <dir> --kits sheet,slide,doc,photo,note --max-document-mb 20
```

Copies the committed files of the chosen kits' samples (document, `thumb.png`, `preview.webp`) to
`<dir>/<kit>/<slug>/` and writes `<dir>/index.json`: each sample's title, summary, category, tags,
featured flag, and its files' sizes and SHA-256, with this repository's commit. Nothing is rebuilt;
a document that no longer matches its `build.json` stops the export. Samples with no build, or with
a document over the limit, are listed under `skipped`. Photo documents are Git LFS objects: run
`git lfs pull` first, or the export stops at the first pointer. The kition.ai site build runs
it to fill kits.kition.ai `/samples/`.
