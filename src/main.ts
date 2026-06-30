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

const start = (): void => {
  const config = parseClocks(window.location.search)

  const titleEl = document.querySelector('#title')
  if (titleEl && config.title) titleEl.textContent = config.title

  const grid = document.querySelector('#grid') as HTMLElement | null
  if (!grid) return

  const cards = config.clocks.map((spec, i) => createCard(spec, config, i))
  const fragment = document.createDocumentFragment()
  for (const card of cards) fragment.appendChild(card.el)
  grid.replaceChildren(fragment)
  // Drives column-count tuning in CSS (data-count + the --count custom prop).
  grid.dataset.count = String(cards.length)
  grid.style.setProperty('--count', String(cards.length))

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
