# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **fully static** world clock for digital signage: a board of cities, each
showing its own local time, date, GMT offset and a day/night accent. Everything
on screen is driven by **URL query parameters** — there is no server and no
backend. The site builds to `./dist` and is published to **GitHub Pages**.

It is modelled loosely on the sibling [`../clock-app`](../clock-app) (the
"Observatory" aesthetic — Fraunces serif over a night sky), but where clock-app
is a single edge-rendered Cloudflare Worker clock, this is a self-contained,
multi-zone, client-only static site. All client code is **TypeScript**.

## Commands

Bun is the package manager, test runner and bundler.

```bash
bun install        # install deps
bun run build      # bundle TS + minify CSS + copy HTML/fonts into ./dist
bun run dev        # build, serve ./dist on 0.0.0.0:8080 (LAN), rebuild on change
bun run serve      # build then serve ./dist (no watch)
bun run lint       # biome lint, warnings are errors (must pass in CI)
bun run lint:fix   # autofix lint
bun run format     # biome format --write
bun run typecheck  # tsc --noEmit
bun test           # run unit tests
bun run sync-fonts # vendor webfonts from @fontsource only
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on every PR.
Pushing to `master` runs `deploy-pages.yml`, which re-runs those checks and
publishes `./dist` to GitHub Pages.

## Architecture

### Pure logic vs. DOM (the split to preserve)

- **`src/clocks.ts`** — pure, side-effect-free helpers: URL parsing
  (`parseClocks`), `Intl` formatter construction (`buildFormatters`), and the
  formatting/banding helpers. Every function takes an explicit `Date`, so tests
  are independent of the machine clock and timezone. This is the **only** file
  with unit tests (`src/clocks.test.ts`). Keep testable logic here.
- **`src/main.ts`** — the DOM driver: reads `location.search`, builds one card
  per clock, and repaints them on a shared timer. No `Intl`/parsing logic of its
  own — it imports it from `clocks.ts`. Loaded as a `type="module"` script.

This mirrors clock-app's `locale.js` / `main.js` split, but here `main.ts` is a
normal ES module (the static page uses `<script type="module">`), so there is no
"export-free bundle" constraint to worry about.

### Build (`build.ts`)

Bundles `src/main.ts` (which imports `clocks.ts`) into one minified ES module at
`dist/main.js`, minifies `assets/styles/main.css` → `dist/styles/main.css`
(`external: ['*']` leaves `url(../fonts/...)` refs untouched), and copies
`index.html`, the vendored fonts (`assets/fonts/` → `dist/fonts/`), the brand
images (`assets/images/` → `dist/images/`) and a `.nojekyll` marker. **All paths
in `index.html` and the CSS are relative**
(`./main.js`, `../fonts/...`) so the site works from a domain root or a Pages
project subpath (`https://<org>.github.io/world-clock/`) unchanged.

### Fonts

`sync-fonts.ts` vendors the Bun-managed `@fontsource` woff2 files into
`assets/fonts/` (run automatically by `build.ts`). **Only Latin fonts are
vendored** — non-Latin locales (CJK, Arabic, …) fall back to the device's own
fonts. The time digits are always Latin, so the hero always renders in Fraunces.

## URL parameters (the configuration surface)

| Param     | Repeatable | Meaning                                                                |
| --------- | ---------- | ---------------------------------------------------------------------- |
| `tz`      | yes        | One clock: `Area/City[\|Label]` (IANA zone; label optional)             |
| `clocks`  | yes        | Comma-separated list of the same `tz` syntax                            |
| `locale`  | no         | **Global** BCP-47 display language for every card (default `en-GB`)     |
| `format`  | no         | `12` / `24` to force the hour cycle; omit to let the locale decide      |
| `seconds` | no         | Present (or `=1`) → tick every second; otherwise tick by the minute     |
| `title`   | no         | Replaces the "World Clock" masthead label                              |

**Locale is global, not per-clock** — a world clock shows every city in one
language; only the timezone differs per card. Invalid IANA zones are dropped
(not thrown), and an unsupported `locale` falls back to `en-GB`. With no clock
params, `DEFAULT_CLOCKS` (a spread of major cities) is shown. See the
table-driven tests in `src/clocks.test.ts` for the exact parsing contract.

## Branding

This is a [Screenly Playground](https://github.com/Screenly/Playground) app, so a
quiet Screenly lockup sits in the footer (`assets/images/screenly-logo.svg`,
copied to `dist/images/` by `build.ts`) and the masthead pip carries the brand
gradient. Card accents are reserved for the data-driven day/night bands — keep
the brand colour in the chrome, not on the clocks.

## Conventions

- Biome: single quotes, no semicolons, no trailing commas, 2-space indent, 100
  cols. Run `bun run lint:fix` before committing.
- TypeScript is `strict` with `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax` — use `import type` for type-only imports and keep
  array access guarded.

### Signature design element (don't flatten it)

Each card's accent (the pip, the tinted top "sky band", and the glow) is set from
**that city's own local hour** via `data-period` (`dawn`/`day`/`dusk`/`night`),
so a wall of cities reads at a glance as who is awake. The grid uses
`grid-auto-rows: 1fr` to give every card a definite size, and `.card-time` is
sized with `min(24cqw, 40cqh)` so the time fits both the card's width and height
— this is what keeps any number of cities from overflowing on any resolution
(480×800 portrait through 4K). Test layout changes across the resolutions in
[`Playground/docs/resolutions.md`](../../Playground/docs/resolutions.md).

## Running / screenshotting locally

`bun run dev` serves `dist` on the LAN with rebuild-on-save. To screenshot,
serve `dist` with `Bun.serve` and drive it with Playwright using absolute paths.
