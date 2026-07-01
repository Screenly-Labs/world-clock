// DOM driver for the World Clock. All the pure logic (URL parsing, Intl
// formatting, day-period banding) lives in ./clocks.ts and is unit-tested; this
// file only reads the query string, builds one card per clock, and re-renders
// them on a shared timer. Loaded as a `type="module"` script from the static
// index.html — no framework, no server.

import {
  buildFormatters,
  type ClockConfig,
  type ClockSpec,
  buildUtcFormatter,
  formatDate,
  formatTimeParts,
  getDayPeriod,
  getOffsetLabel,
  getZonedHour,
  isRtlLocale,
  parseClocks
} from './clocks.ts'

// gtag() is defined by the inline GA4 snippet in index.html. It may be missing
// (ad/tracker blockers strip it), so every call site guards for it.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

// Report how the board is configured — the whole app is URL-driven, so the
// query string *is* the usage. Fired once at load so we can see, in aggregate,
// how many cities people show, which zones, and which locale/format options
// they pick. No free-text (the custom title) is sent, only whether one is set.
const reportUsage = (config: ClockConfig): void => {
  if (typeof window.gtag !== 'function') return
  // GA4 params should be strings or numbers — booleans can coerce
  // inconsistently or get dropped in reports, so flags are sent as 0/1.
  window.gtag('event', 'clock_config', {
    clock_count: config.clocks.length,
    zones: encodeZones(config.clocks),
    locale: config.locale,
    hour_format: config.format,
    show_seconds: config.seconds ? 1 : 0,
    custom_title: config.title !== '' ? 1 : 0,
    // Whether the URL supplied real clocks vs. the DEFAULT_CLOCKS fallback,
    // read from parseClocks' explicit flag (not a brittle reference check).
    configured: config.configured ? 1 : 0
  })
}

// Comma-joined IANA zones (deduped, sorted) for the analytics dimension. GA4
// caps a param value at 100 chars, so drop WHOLE zones — never a mid-name slice
// like "America/Los_A…" — until the list plus a trailing "…" marker fits. The
// marker keeps a truncated board distinguishable from an exact list.
const ZONES_MAX = 100
const encodeZones = (clocks: ClockSpec[]): string => {
  const zones = [...new Set(clocks.map((c) => c.timeZone))].sort()
  if (zones.join(',').length <= ZONES_MAX) return zones.join(',')
  const kept: string[] = []
  for (const zone of zones) {
    if ([...kept, zone, '…'].join(',').length > ZONES_MAX) break
    kept.push(zone)
  }
  return [...kept, '…'].join(',')
}

// One rendered clock: its root element plus an update(date) that repaints it
// from an absolute instant. Formatters are built once and captured in the
// closure — rebuilding a DateTimeFormat every tick is the expensive part.
interface ClockCard {
  el: HTMLElement
  update(now: Date): void
}

const setText = (el: Element, value: string): void => {
  if (el.textContent !== value) el.textContent = value
}

const createCard = (spec: ClockSpec, config: ClockConfig, index: number): ClockCard => {
  const fmt = buildFormatters(spec, config)
  // Direction comes from the single global locale — every card shares it.
  const dir = isRtlLocale(config.locale) ? 'rtl' : 'ltr'

  const el = document.createElement('article')
  el.className = 'card anim'
  // Stagger the entrance reveal across cards.
  el.style.setProperty('--d', `${index * 70}ms`)

  el.innerHTML = `
    <span class="card-glow" aria-hidden="true"></span>
    <header class="card-head">
      <span class="card-label"><i class="card-pip" aria-hidden="true"></i><span class="card-name"></span></span>
      <span class="card-offset"></span>
    </header>
    <div class="card-clock">
      <span class="card-time"></span><span class="card-period"></span>
    </div>
    <span class="card-date"></span>`

  const nameEl = el.querySelector('.card-name') as HTMLElement
  const offsetEl = el.querySelector('.card-offset') as HTMLElement
  const clockEl = el.querySelector('.card-clock') as HTMLElement
  const timeEl = el.querySelector('.card-time') as HTMLElement
  const periodEl = el.querySelector('.card-period') as HTMLElement
  const dateEl = el.querySelector('.card-date') as HTMLElement

  nameEl.textContent = spec.label
  // Tag the localized time/date with the global locale + direction so RTL scripts
  // and assistive tech are handled without mirroring the (LTR) card chrome.
  for (const node of [timeEl, dateEl]) {
    node.lang = config.locale
    node.dir = dir
  }

  // The date, GMT offset and day-period band change at most once a minute, so we
  // skip recomputing them (three formatToParts calls per card) on the sub-minute
  // ticks that the `seconds` option produces.
  let lastMinuteKey = Number.NaN

  const update = (now: Date): void => {
    const { time, period, periodFirst } = formatTimeParts(fmt.time, now)
    setText(timeEl, time)
    setText(periodEl, period)
    clockEl.classList.toggle('period-first', periodFirst && period !== '')

    const minuteKey = Math.floor(now.getTime() / 60000)
    if (minuteKey !== lastMinuteKey) {
      lastMinuteKey = minuteKey
      setText(dateEl, formatDate(fmt.date, now))
      setText(offsetEl, getOffsetLabel(fmt.offset, now))
      el.dataset.period = getDayPeriod(getZonedHour(fmt.hour, now))
    }
  }

  return { el, update }
}

// Choose a balanced grid shape for `count` cards on a board of the current
// aspect ratio, and centre a partial last row. The board is landscape signage,
// so we derive the ROW count from the aspect (a wide board wants few rows) and
// let the columns follow — 4 cities → 2x2, 7 → 4+3, 6 → 3x2. The last row is
// centred via the 2x sub-column grid: offsetting its first card by half the
// empty span lands an odd remainder (e.g. 4+3) exactly in the middle.
const layoutGrid = (grid: HTMLElement, cards: ClockCard[]): void => {
  const count = cards.length
  const aspect = (window.innerWidth || 1) / (window.innerHeight || 1)
  const rows = Math.max(1, Math.round(Math.sqrt(count / aspect)))
  const cols = Math.max(1, Math.ceil(count / rows))
  // Re-tighten rows to the chosen columns so there's never a trailing empty row.
  const usedRows = Math.ceil(count / cols)
  const lastRow = count - (usedRows - 1) * cols

  grid.style.setProperty('--cols', String(cols))

  // Clear any prior centring offset before re-applying (columns change on resize).
  for (const card of cards) card.el.style.removeProperty('grid-column')

  // Nudge the first card of an incomplete last row right by half the empty span
  // (in sub-column units, so an odd gap still centres); it still spans 2 tracks,
  // and the rest of the row auto-flows after it. A full last row stays put.
  if (lastRow < cols) {
    const first = cards[count - lastRow]
    if (first) first.el.style.gridColumn = `${1 + (cols - lastRow)} / span 2`
  }
}

const start = (): void => {
  const config = parseClocks(window.location.search)
  reportUsage(config)

  const titleEl = document.querySelector('#title')
  if (titleEl && config.title) titleEl.textContent = config.title

  const grid = document.querySelector('#grid') as HTMLElement | null
  if (!grid) return

  const cards = config.clocks.map((spec, i) => createCard(spec, config, i))
  const fragment = document.createDocumentFragment()
  for (const card of cards) fragment.appendChild(card.el)
  grid.replaceChildren(fragment)
  // Balance the grid shape (and centre a partial last row) for the current
  // aspect ratio, then keep it balanced as a signage panel is rotated/resized.
  layoutGrid(grid, cards)
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => layoutGrid(grid, cards), 150)
  })

  // A neutral live UTC reference in the masthead, so a board of many zones still
  // has one shared anchor instant.
  const metaEl = document.querySelector('#masthead-meta')
  const utcFmt = buildUtcFormatter()

  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = (): void => {
    if (timer) clearTimeout(timer)
    const now = new Date()
    for (const card of cards) card.update(now)
    if (metaEl) {
      const noun = cards.length === 1 ? 'city' : 'cities'
      metaEl.textContent = `${cards.length} ${noun} · UTC ${utcFmt.format(now)}`
    }

    // Re-render on the next second (when showing seconds) or the next minute
    // boundary otherwise; +30ms guards against firing a hair early.
    const msToNext = config.seconds
      ? 1000 - now.getMilliseconds()
      : (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
    timer = setTimeout(tick, msToNext + 30)
  }

  tick()

  // A device waking from sleep can be many minutes stale; repaint immediately
  // when the tab becomes visible again rather than waiting for the pending timer.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
