// Pure clock + URL-parameter helpers, kept apart from main.ts (the DOM driver)
// so they can be unit-tested with a real ES-module import. This mirrors how the
// reference clock-app splits its tested locale helpers out of main.js.
//
// Everything here is side-effect free: functions take an explicit Date and the
// caller's parsed config, so tests are independent of the machine clock and
// timezone. main.ts owns the DOM, the ticking timer and `window`.

// A single clock to render: which IANA zone, and what to call it. The display
// language (locale) is NOT per-clock — a world clock shows every city in the
// viewer's one chosen language and 12/24h format; only the timezone differs.
export interface ClockSpec {
  timeZone: string
  label: string
}

// 12h / 24h override, or 'auto' to let the locale decide its hour cycle.
export type HourFormat = '12' | '24' | 'auto'

// The whole page configuration, parsed from the query string. `locale` is the
// single, global display language applied to every clock's time and date.
export interface ClockConfig {
  clocks: ClockSpec[]
  locale: string
  format: HourFormat
  seconds: boolean
  title: string
  // True when the URL supplied at least one usable clock, false when `clocks`
  // is the bare-URL DEFAULT_CLOCKS fallback. An explicit flag rather than a
  // `clocks !== DEFAULT_CLOCKS` reference check, so cloning the defaults can't
  // silently flip it.
  configured: boolean
}

// Neutral default locale: en-GB gives 24h time and plain English month/weekday
// names — a sane, predictable baseline for signage when no locale is requested.
export const FALLBACK_LOCALE = 'en-GB'

// Shown when the URL carries no clocks: a spread of major cities across the
// globe so the live demo is immediately legible as a *world* clock.
export const DEFAULT_CLOCKS: ClockSpec[] = [
  { timeZone: 'America/Los_Angeles', label: 'San Francisco' },
  { timeZone: 'America/New_York', label: 'New York' },
  { timeZone: 'Europe/London', label: 'London' },
  { timeZone: 'Europe/Berlin', label: 'Berlin' },
  { timeZone: 'Asia/Dubai', label: 'Dubai' },
  { timeZone: 'Asia/Tokyo', label: 'Tokyo' },
  { timeZone: 'Australia/Sydney', label: 'Sydney' }
]

// Right-to-left primary language subtags, so when the global locale is e.g.
// Arabic the time/date text gets dir="rtl".
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'dv', 'ur', 'ckb', 'sd', 'yi'])

// BCP-47 subtags are case-insensitive, so lowercase the primary language before
// the lookup — otherwise "AR-SA" would be mis-classified as LTR.
export const isRtlLocale = (locale: string): boolean =>
  RTL_LANGUAGES.has((locale.split('-')[0] ?? '').toLowerCase())

// True only for a real, resolvable IANA zone. The DateTimeFormat constructor
// throws on an unknown timeZone, which is how we reject junk like "Mars/Olympus".
export const isValidTimeZone = (tz: string): boolean => {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// True for a usable BCP-47 locale string. An empty/garbage tag falls back to the
// neutral default rather than throwing when formatters are built.
export const isValidLocale = (locale: string): boolean => {
  if (!locale) return false
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0
  } catch {
    return false
  }
}

// Human label derived from the zone's last path segment: the city name with
// underscores turned into spaces, e.g. "America/New_York" -> "New York",
// "Asia/Kolkata" -> "Kolkata". Used when the URL gives no explicit label.
export const deriveLabel = (tz: string): string => {
  const segment = tz.split('/').pop() ?? tz
  return segment.replace(/_/g, ' ')
}

// Parse one clock token: "Area/City" or "Area/City|Label" (label optional; an
// empty label segment falls back to the derived city name). Returns null for an
// unknown timezone so the caller can skip it instead of rendering a broken card.
export const parseClockEntry = (raw: string): ClockSpec | null => {
  const [tzPart = '', labelPart = ''] = raw.split('|')
  const timeZone = tzPart.trim()
  if (!isValidTimeZone(timeZone)) return null

  const label = labelPart.trim() || deriveLabel(timeZone)
  return { timeZone, label }
}

// Normalize the global 12/24 override; anything else means "let the locale decide".
const parseFormat = (value: string | null): HourFormat =>
  value === '12' || value === '24' ? value : 'auto'

// Build the page config from a query string (location.search). Clocks come from
// repeated `tz=` params and/or a single comma-separated `clocks=` param. The
// display language is a single global `locale` applied to every clock. With no
// clocks at all we fall back to DEFAULT_CLOCKS so the bare URL still shows a
// world clock.
export const parseClocks = (search: string): ClockConfig => {
  const params = new URLSearchParams(search)

  const localeReq = (params.get('locale') ?? '').trim()
  const locale = isValidLocale(localeReq) ? localeReq : FALLBACK_LOCALE

  const tokens: string[] = []
  for (const value of params.getAll('tz')) tokens.push(value)
  for (const value of params.getAll('clocks')) {
    for (const token of value.split(',')) tokens.push(token)
  }

  const clocks: ClockSpec[] = []
  for (const token of tokens) {
    if (!token.trim()) continue
    const spec = parseClockEntry(token)
    if (spec) clocks.push(spec)
  }

  const configured = clocks.length > 0
  return {
    clocks: configured ? clocks : DEFAULT_CLOCKS,
    locale,
    format: parseFormat(params.get('format')),
    seconds: params.has('seconds') && params.get('seconds') !== '0',
    title: (params.get('title') ?? '').trim(),
    configured
  }
}

// The cached Intl formatters for one clock. Built once per spec and reused on
// every tick — constructing a DateTimeFormat per render is the costly part.
// `offset` is undefined on engines that lack the 'shortOffset' option (see
// buildFormatters); the card simply omits the GMT label there.
export interface ClockFormatters {
  time: Intl.DateTimeFormat
  date: Intl.DateTimeFormat
  hour: Intl.DateTimeFormat
  offset: Intl.DateTimeFormat | undefined
}

// hour12 from the global format override; undefined lets the locale pick.
const hour12From = (format: HourFormat): boolean | undefined =>
  format === '12' ? true : format === '24' ? false : undefined

export const buildFormatters = (spec: ClockSpec, config: ClockConfig): ClockFormatters => {
  const { timeZone } = spec
  const { locale } = config
  const hour12 = hour12From(config.format)

  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    // Force Latin digits regardless of locale: only Latin webfonts are vendored,
    // so e.g. ar-EG must not render the time in Arabic-Indic numerals (which the
    // Fraunces face has no glyphs for). The locale still drives names/AM-PM.
    numberingSystem: 'latn',
    timeZone
  }
  if (config.seconds) timeOpts.second = '2-digit'
  if (hour12 !== undefined) timeOpts.hour12 = hour12

  // Pin Gregorian so the date is stable across locales (ar-SA would otherwise
  // render a Hijri date); names/order/numerals stay localized.
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    calendar: 'gregory',
    timeZone
  }

  // hour12:false in a neutral locale so the parsed 0-23 hour drives the
  // dawn/day/dusk/night band for *this* zone, regardless of the display locale.
  const hourOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', hour12: false, timeZone }

  return {
    time: new Intl.DateTimeFormat(locale, timeOpts),
    date: new Intl.DateTimeFormat(locale, dateOpts),
    hour: new Intl.DateTimeFormat('en-GB', hourOpts),
    offset: buildOffsetFormatter(timeZone)
  }
}

// Short GMT offset for the zone, e.g. "GMT+9" — useful orientation on a board of
// many cities. 'shortOffset' only landed in ~Chrome 91 and throws where it is
// unsupported; since isValidTimeZone validates with a plain formatter, an old
// signage webview would otherwise crash the whole page here. Degrade to no offset
// label instead of taking the board down.
const buildOffsetFormatter = (timeZone: string): Intl.DateTimeFormat | undefined => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZoneName: 'shortOffset', timeZone })
  } catch {
    return undefined
  }
}

// Time split into the clock face ("9:30") and the day period ("AM"/"PM"), so the
// UI can typeset the period as a smaller marker. period is '' for 24h locales.
// periodFirst is true where the locale prints the period before the time (ko,
// zh-Hant), so the UI can reorder the marker rather than always trailing it.
export const formatTimeParts = (
  formatter: Intl.DateTimeFormat,
  date: Date
): { time: string; period: string; periodFirst: boolean } => {
  const parts = formatter.formatToParts(date)
  const periodIndex = parts.findIndex((p) => p.type === 'dayPeriod')
  const hourIndex = parts.findIndex((p) => p.type === 'hour')
  const period = periodIndex === -1 ? '' : (parts[periodIndex]?.value ?? '')
  const periodFirst = periodIndex !== -1 && periodIndex < hourIndex
  // Keep the locale's own hour:minute separator by joining the remaining parts;
  // only the day period is dropped, and trim removes the now-dangling space.
  const time = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim()
  return { time, period, periodFirst }
}

export const formatDate = (formatter: Intl.DateTimeFormat, date: Date): string =>
  formatter.format(date)

// Hour (0-23) of an absolute instant in the clock's zone — feeds getDayPeriod.
export const getZonedHour = (formatter: Intl.DateTimeFormat, date: Date): number =>
  Number.parseInt(formatter.format(date), 10)

// The GMT offset label for the zone, e.g. "GMT+9" / "GMT-5:30". Returns '' when
// the formatter is undefined (engine without 'shortOffset' support).
export const getOffsetLabel = (formatter: Intl.DateTimeFormat | undefined, date: Date): string =>
  formatter?.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? ''

// The masthead's neutral live UTC reference, e.g. "18:30". Kept here (not in
// main.ts) so every Intl formatter the app builds lives in one tested module.
export const buildUtcFormatter = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false
  })

export type DayPeriod = 'dawn' | 'day' | 'dusk' | 'night'

// Coarse time-of-day band that drives each card's ambient accent.
export const getDayPeriod = (hour: number): DayPeriod => {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}
