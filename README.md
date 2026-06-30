# World Clock

A clean, full-screen **world clock** for digital signage: many cities at once,
each with its own local time, date, GMT offset and a day/night accent that reacts
to that city's hour. Every clock is configured through the URL, the site is
**fully static**, and it deploys to **GitHub Pages** with no server.

Modelled loosely on the [Screenly clock-app](../clock-app)'s "Observatory" look
(Fraunces display serif over a deep night sky), adapted from a single
edge-rendered clock to a self-contained, URL-driven board of zones.

The clock face renders with `Intl.DateTimeFormat`, so times, dates, 12/24-hour
format and AM/PM are correct and localizable. It is a
[Screenly Playground](https://github.com/Screenly/Playground) app, with a quiet
Screenly lockup in the footer.

## Settings (URL parameters)

Everything on screen is driven by the query string — no build step or config
file needed to change the board. All settings are optional; with **no parameters
at all**, a default board of major world cities is shown in 24-hour `en-GB`.

| Setting   | Values / syntax                                   | Default        | Repeatable | What it does |
| --------- | ------------------------------------------------- | -------------- | ---------- | ------------ |
| `tz`      | `Area/City` or `Area/City\|Label`                 | —              | yes        | Adds one clock. Repeat the parameter for more cities. |
| `clocks`  | comma-separated list of the `tz` syntax           | —              | yes        | Adds several clocks in a single parameter. |
| `locale`  | a [BCP-47 tag](https://en.wikipedia.org/wiki/IETF_language_tag) (`en-US`, `de-DE`, `fr-FR`, `ja-JP`) | `en-GB` | no | **Global** display language for every card's date and time, and the default 12/24h cycle. |
| `format`  | `12` or `24`                                      | the locale's default | no | Forces the hour cycle on every card, overriding the locale. |
| `seconds` | present, or `=1` / `=0`                            | off            | no | Shows seconds and ticks every second (otherwise ticks each minute). |
| `title`   | any text                                          | `World Clock`  | no | Replaces the masthead label. |

### `tz` and `clocks` — choosing the cities

A clock is an [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
(`Europe/London`, `America/New_York`, `Asia/Kolkata`) with an optional label
after a `|`:

- `tz=Asia/Tokyo` → labelled "Tokyo" (derived from the zone)
- `tz=Asia/Tokyo|HQ Tokyo` → labelled "HQ Tokyo"

Add as many as you like, either by repeating `tz` or with one `clocks` list — the
two can be combined and the order is preserved. **Unknown timezones are skipped**
rather than shown broken, so a typo drops one card instead of breaking the board.

> The `clocks` list is comma-separated, so a **label can't contain a comma**
> there (the text after the comma would start a new entry). For a label with a
> comma, use a repeated `tz` parameter instead, e.g.
> `?tz=Asia/Tokyo|Tokyo, Japan`.

### `locale` is global, not per-city

A world clock shows every city in **one** language and time format — the
viewer's, set once with `locale`. The timezone is the only thing that differs
per card. (Localizing each city into its own local language would make a board of
clocks unreadable, so it is deliberately not supported.)

> Non-Latin locales (CJK, Arabic, …) render their text using the **device's own
> fonts** — only Latin webfonts are vendored to keep the site small and CDN-free.
> The time digits are always Latin, so they render in Fraunces everywhere.

### Examples

```
# Three named desks, forced 12-hour with seconds, custom title
?title=Trading%20Desk&format=12&seconds&tz=America/New_York|New%20York&tz=Europe/London|London&tz=Asia/Tokyo|Tokyo

# Exactly the same board, written as one clocks= list
?title=Trading%20Desk&format=12&seconds&clocks=America/New_York|New%20York,Europe/London|London,Asia/Tokyo|Tokyo

# The whole board in German
?locale=de-DE&tz=America/New_York|New%20York&tz=Europe/Berlin|Berlin&tz=Asia/Tokyo|Tokyo
```

## Resolutions

Responsive from a Raspberry Pi touch display (480×800) up to 4K (4096×2160), in
both orientations — see [`Playground/docs/resolutions.md`](../../Playground/docs/resolutions.md).
The grid divides the screen into equal cells, so any number of cities fills the
board without scrolling or clipping.

## Development

Uses [Bun](https://bun.sh/) as package manager, test runner and bundler.

```bash
bun install        # install deps
bun run build      # build the static site into ./dist
bun run serve      # build, then serve ./dist locally
bun run lint       # Biome lint (warnings are errors)
bun run typecheck  # tsc --noEmit
bun test           # run unit tests
bun run sync-fonts # vendor webfonts only
```

All client code is **TypeScript**. The pure logic (URL parsing + `Intl`
formatting) lives in [`src/clocks.ts`](src/clocks.ts) and is unit-tested in
[`src/clocks.test.ts`](src/clocks.test.ts); [`src/main.ts`](src/main.ts) is the
DOM driver. [`build.ts`](build.ts) bundles to one ES module, minifies the CSS,
and copies the HTML shell + vendored fonts into `./dist`.

## Deployment (GitHub Pages)

Pushing to `master` runs [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml),
which lints, typechecks, tests, builds `./dist`, and publishes it to Pages.

**One-time setup:** in the repo's **Settings → Pages → Build and deployment**, set
**Source** to **GitHub Actions**. All asset paths are relative, so the site works
whether it's served from a domain root or a project subpath
(`https://<org>.github.io/world-clock/`).
