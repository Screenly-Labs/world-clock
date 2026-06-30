import { describe, expect, it } from 'bun:test'
import {
  buildFormatters,
  type ClockConfig,
  DEFAULT_CLOCKS,
  deriveLabel,
  formatDate,
  formatTimeParts,
  getDayPeriod,
  getOffsetLabel,
  getZonedHour,
  isRtlLocale,
  isValidTimeZone,
  parseClockEntry,
  parseClocks
} from './clocks.ts'

// A fixed absolute instant: Saturday 2026-06-20 13:30:45 UTC. Pairing it with an
// explicit zone makes every assertion independent of the machine timezone.
const INSTANT = new Date('2026-06-20T13:30:45Z')

const configFor = (overrides: Partial<ClockConfig> = {}): ClockConfig => ({
  clocks: [],
  locale: 'en-GB',
  format: 'auto',
  seconds: false,
  title: '',
  ...overrides
})

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
  })

  it('rejects junk and empty strings', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('not a zone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('deriveLabel', () => {
  it('uses the last path segment with underscores as spaces', () => {
    expect(deriveLabel('America/New_York')).toBe('New York')
    expect(deriveLabel('Asia/Kolkata')).toBe('Kolkata')
    expect(deriveLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(deriveLabel('UTC')).toBe('UTC')
  })
})

describe('parseClockEntry', () => {
  it('parses a bare timezone, deriving the label', () => {
    expect(parseClockEntry('Europe/London')).toEqual({
      timeZone: 'Europe/London',
      label: 'London'
    })
  })

  it('parses an explicit label', () => {
    expect(parseClockEntry('Asia/Tokyo|HQ Tokyo')).toEqual({
      timeZone: 'Asia/Tokyo',
      label: 'HQ Tokyo'
    })
  })

  it('ignores any extra pipe segments (locale is global, not per-clock)', () => {
    expect(parseClockEntry('Asia/Tokyo|HQ|ja-JP')).toEqual({
      timeZone: 'Asia/Tokyo',
      label: 'HQ'
    })
  })

  it('falls back to the derived label when the label segment is empty', () => {
    expect(parseClockEntry('Asia/Tokyo|')?.label).toBe('Tokyo')
  })

  it('returns null for an invalid timezone', () => {
    expect(parseClockEntry('Mars/Olympus|Mars')).toBeNull()
    expect(parseClockEntry('')).toBeNull()
  })
})

describe('parseClocks', () => {
  it('falls back to DEFAULT_CLOCKS when no clocks are given', () => {
    const config = parseClocks('')
    expect(config.clocks.map((c) => c.timeZone)).toEqual(DEFAULT_CLOCKS.map((c) => c.timeZone))
  })

  it('reads repeated tz params in order', () => {
    const config = parseClocks('?tz=America/New_York|NYC&tz=Europe/London')
    expect(config.clocks).toEqual([
      { timeZone: 'America/New_York', label: 'NYC' },
      { timeZone: 'Europe/London', label: 'London' }
    ])
  })

  it('reads a single comma-separated clocks param', () => {
    const config = parseClocks('?clocks=America/New_York|NYC,Asia/Tokyo')
    expect(config.clocks.map((c) => c.label)).toEqual(['NYC', 'Tokyo'])
  })

  it('skips invalid zones but keeps the valid ones', () => {
    const config = parseClocks('?tz=Mars/Olympus&tz=Europe/Paris')
    expect(config.clocks.map((c) => c.timeZone)).toEqual(['Europe/Paris'])
  })

  it('resolves a single global locale, defaulting to en-GB', () => {
    expect(parseClocks('').locale).toBe('en-GB')
    expect(parseClocks('?locale=de-DE').locale).toBe('de-DE')
    // An unsupported locale falls back to the neutral default.
    expect(parseClocks('?locale=not-a-locale').locale).toBe('en-GB')
  })

  it('parses the global format, seconds and title flags', () => {
    expect(parseClocks('?format=12').format).toBe('12')
    expect(parseClocks('?format=24').format).toBe('24')
    expect(parseClocks('?format=nonsense').format).toBe('auto')
    expect(parseClocks('?seconds').seconds).toBe(true)
    expect(parseClocks('?seconds=0').seconds).toBe(false)
    expect(parseClocks('?title=Trading%20Desk').title).toBe('Trading Desk')
  })
})

describe('time formatting (zoned, 12/24h, localized)', () => {
  // Locale is global, so it travels in the config, not the per-clock spec.
  const fmt = (spec: { timeZone: string; locale: string }, config: Partial<ClockConfig> = {}) =>
    buildFormatters(
      { timeZone: spec.timeZone, label: 'x' },
      configFor({ locale: spec.locale, ...config })
    )

  it('renders a zoned 24h clock for en-GB', () => {
    const f = fmt({ timeZone: 'Europe/London', locale: 'en-GB' })
    const { time, period } = formatTimeParts(f.time, INSTANT)
    expect(time).toBe('14:30')
    expect(period).toBe('')
  })

  it('renders a zoned 12h clock with AM/PM for en-US', () => {
    const f = fmt({ timeZone: 'America/New_York', locale: 'en-US' })
    const { time, period } = formatTimeParts(f.time, INSTANT)
    expect(time).toBe('9:30')
    expect(period).toMatch(/AM/i)
  })

  it('forces 12h when format=12 even for a 24h locale', () => {
    const f = fmt({ timeZone: 'Europe/London', locale: 'en-GB' }, { format: '12' })
    const { time, period } = formatTimeParts(f.time, INSTANT)
    expect(time).toBe('2:30')
    expect(period).toMatch(/PM/i)
  })

  it('forces 24h when format=24 even for a 12h locale', () => {
    const f = fmt({ timeZone: 'America/New_York', locale: 'en-US' }, { format: '24' })
    // en-US under a 24h cycle zero-pads the hour ("09:30"), and there is no period.
    const { time, period } = formatTimeParts(f.time, INSTANT)
    expect(time).toBe('09:30')
    expect(period).toBe('')
  })

  it('includes seconds when requested', () => {
    const f = fmt({ timeZone: 'Europe/London', locale: 'en-GB' }, { seconds: true })
    expect(formatTimeParts(f.time, INSTANT).time).toBe('14:30:45')
  })

  it('flags periodFirst for locales that print the period before the time', () => {
    const f = fmt({ timeZone: 'Asia/Seoul', locale: 'ko-KR' })
    const parts = formatTimeParts(f.time, INSTANT)
    expect(parts.periodFirst).toBe(true)
    expect(parts.period).not.toBe('')

    const us = fmt({ timeZone: 'America/New_York', locale: 'en-US' })
    expect(formatTimeParts(us.time, INSTANT).periodFirst).toBe(false)
  })

  it('preserves the locale-native hour:minute separator', () => {
    const f = fmt({ timeZone: 'Europe/Helsinki', locale: 'fi-FI' })
    expect(formatTimeParts(f.time, INSTANT).time).toBe('16.30')
  })
})

describe('date localization', () => {
  const fmt = (locale: string, timeZone: string) =>
    buildFormatters({ timeZone, label: 'x' }, configFor({ locale }))

  it('renders month/weekday names in the global locale', () => {
    expect(formatDate(fmt('en-US', 'America/New_York').date, INSTANT)).toMatch(/Jun/)
    expect(formatDate(fmt('fr-FR', 'Europe/Paris').date, INSTANT)).toMatch(/juin/)
    expect(formatDate(fmt('de-DE', 'Europe/Berlin').date, INSTANT)).toMatch(/Juni/)
  })

  it('pins the Gregorian calendar even for ar-SA (not Hijri)', () => {
    const date = formatDate(fmt('ar-SA', 'Asia/Riyadh').date, INSTANT)
    expect(date).toMatch(/20|٢٠/)
    expect(date).not.toMatch(/محرم/)
  })

  it('rolls the date across the day line by zone', () => {
    // 13:30 UTC is still the 20th in Tokyo (22:30) but Auckland is already the 21st.
    expect(formatDate(fmt('en-GB', 'Asia/Tokyo').date, INSTANT)).toMatch(/20/)
    expect(formatDate(fmt('en-GB', 'Pacific/Auckland').date, INSTANT)).toMatch(/21/)
  })
})

describe('zoned hour, offset and day period', () => {
  const fmt = (timeZone: string) => buildFormatters({ timeZone, label: 'x' }, configFor())

  it('reads the hour in the clock zone', () => {
    expect(getZonedHour(fmt('Asia/Tokyo').hour, INSTANT)).toBe(22)
    expect(getZonedHour(fmt('America/New_York').hour, INSTANT)).toBe(9)
  })

  it('reads the short GMT offset for the zone', () => {
    expect(getOffsetLabel(fmt('Asia/Tokyo').offset, INSTANT)).toBe('GMT+9')
    // New York is on EDT (-4) in June.
    expect(getOffsetLabel(fmt('America/New_York').offset, INSTANT)).toBe('GMT-4')
  })

  it('bands the hour into dawn / day / dusk / night', () => {
    expect(getDayPeriod(6)).toBe('dawn')
    expect(getDayPeriod(12)).toBe('day')
    expect(getDayPeriod(18)).toBe('dusk')
    expect(getDayPeriod(23)).toBe('night')
    expect(getDayPeriod(3)).toBe('night')
  })
})

describe('isRtlLocale', () => {
  it('detects RTL primary languages', () => {
    expect(isRtlLocale('ar-SA')).toBe(true)
    expect(isRtlLocale('he-IL')).toBe(true)
    expect(isRtlLocale('en-GB')).toBe(false)
    expect(isRtlLocale('ja-JP')).toBe(false)
  })
})
