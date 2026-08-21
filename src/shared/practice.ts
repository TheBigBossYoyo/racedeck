export interface PracticeDriverInput {
  number: number
  code: string
  fullName: string
  teamName: string | null
}

export interface PracticeBriefRequest {
  year: number | null
  meetingName: string | null
  countryName: string | null
  dateStart: string | null
  drivers: PracticeDriverInput[]
}

export interface PracticeSourceLink {
  label: string
  url: string
}

export interface PracticeDriverSwap {
  driverNumber: number
  code: string
  fullName: string
  teamName: string | null
  replaces: string[]
  originSeries: string | null
  originTeam: string | null
  pedigree: string | null
  recentResults: string[]
  priorPracticeSessions: number | null
  priorPracticeEvents: string[]
  sources: PracticeSourceLink[]
}

export interface WeekendUpgrade {
  teamName: string
  components: string[]
  noUpdates: boolean
  summary: string | null
}

export interface PracticeBriefResult {
  ok: boolean
  error: string | null
  swaps: PracticeDriverSwap[]
  upgrades: WeekendUpgrade[]
  upgradeDocumentUrl: string | null
  fetchedAt: string
}

const MAX_DRIVERS = 30
const MAX_EVENT_TEXT = 120
const MAX_DRIVER_NAME = 120
const MAX_DRIVER_CODE = 8
const MAX_DATE_TEXT = 64
export const MAX_PRACTICE_PDF_BYTES = 25 * 1024 * 1024

function cachePart(value: string | null): string {
  return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

export function practiceBriefCacheKey(
  year: number,
  meetingName: string,
  request: PracticeBriefRequest
): string {
  const drivers = request.drivers
    .map((driver) => `${driver.number}:${cachePart(driver.fullName)}:${cachePart(driver.teamName)}`)
    .sort()
    .join(',')
  return `${year}:${cachePart(meetingName)}:${request.dateStart ?? ''}:${drivers}`
}

export function openF1PracticeYears(year: number): number[] {
  const firstOpenF1Year = 2023
  return year < firstOpenF1Year
    ? []
    : Array.from({ length: year - firstOpenF1Year + 1 }, (_, index) => firstOpenF1Year + index)
}

export function validatePracticePdfLength(contentLength: string | null): number | null {
  if (contentLength === null || contentLength.trim() === '') {
    return null
  }
  const bytes = Number(contentLength)
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_PRACTICE_PDF_BYTES) {
    throw new Error('Official upgrade document exceeds the safe size limit.')
  }
  return bytes
}

function boundedOptionalString(value: unknown, maxLength: number, field: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`Invalid practice ${field}.`)
  }
  return value
}

/** Validate the renderer payload before it can trigger public network or PDF work. */
export function validatePracticeBriefRequest(value: unknown): PracticeBriefRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid practice request.')
  const request = value as Record<string, unknown>
  if (!Array.isArray(request.drivers) || request.drivers.length > MAX_DRIVERS) {
    throw new Error('Invalid practice driver list.')
  }
  const year = request.year
  if (year !== null && (!Number.isInteger(year) || Number(year) < 2018 || Number(year) > 2035)) {
    throw new Error('Invalid practice season.')
  }
  const drivers = request.drivers.map((item) => {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid practice driver.')
    const driver = item as Record<string, unknown>
    if (!Number.isInteger(driver.number) || Number(driver.number) < 0 || Number(driver.number) > 999) {
      throw new Error('Invalid practice driver number.')
    }
    const code = boundedOptionalString(driver.code, MAX_DRIVER_CODE, 'driver code')
    const fullName = boundedOptionalString(driver.fullName, MAX_DRIVER_NAME, 'driver name')
    const teamName = boundedOptionalString(driver.teamName, MAX_DRIVER_NAME, 'team name')
    if (code === null || fullName === null) throw new Error('Invalid practice driver identity.')
    return { number: Number(driver.number), code, fullName, teamName }
  })
  return {
    year: year === null ? null : Number(year),
    meetingName: boundedOptionalString(request.meetingName, MAX_EVENT_TEXT, 'meeting name'),
    countryName: boundedOptionalString(request.countryName, MAX_EVENT_TEXT, 'country name'),
    dateStart: boundedOptionalString(request.dateStart, MAX_DATE_TEXT, 'session date'),
    drivers
  }
}

/** Parse the text layer of an official FIA Car Presentation Submissions PDF. */
export function parseUpgradeDocument(text: string): WeekendUpgrade[] {
  const chunks = text.split(/Car Presentation\s+[–-][^\n]*\n/).slice(1)
  const upgrades: WeekendUpgrade[] = []
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const teamName = (lines[0] ?? '').replace(/^\*|\*$/g, '').trim()
    if (!teamName || /^updated component$/i.test(teamName)) continue
    const body = lines.slice(1).join(' ').replace(/\s+/g, ' ')
    const noUpdates = /no updates submitted/i.test(body)
    const components: string[] = []
    const componentPattern = /(?:^|\s)\d+\s+([A-Z][A-Za-z0-9/() -]{1,34}?)\s+(?:Performance|Circuit specific|Reliability)/g
    for (const match of body.matchAll(componentPattern)) {
      const component = match[1].trim().replace(/\s+/g, ' ')
      if (component && !components.includes(component)) components.push(component)
    }
    const summary = noUpdates
      ? null
      : body
          .replace(/Updated component.*?\(min 20, max 100 words\)/i, '')
          .replace(/-- \d+ of \d+ --/g, '')
          .trim()
          .slice(0, 320) || null
    upgrades.push({ teamName, components: components.slice(0, 8), noUpdates, summary })
  }
  return upgrades
}
