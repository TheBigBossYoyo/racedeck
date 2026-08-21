import { net } from 'electron'
import { PDFParse } from 'pdf-parse'
import {
  MAX_PRACTICE_PDF_BYTES,
  openF1PracticeYears,
  parseUpgradeDocument,
  practiceBriefCacheKey,
  validatePracticePdfLength
} from '@shared/practice'
import type {
  PracticeBriefRequest,
  PracticeBriefResult,
  PracticeDriverSwap,
  PracticeSourceLink,
  WeekendUpgrade
} from '@shared/practice'

const REQUEST_TIMEOUT_MS = 15_000
const CACHE_MS = 6 * 60 * 60 * 1000
const MAX_PDF_PAGES = 50
const MAX_PDF_TEXT_BYTES = 1024 * 1024
const UA = 'RaceDeck/0.1 (+https://racedeck.app)'

interface RegularDriver {
  fullName: string
  teamName: string
  sourceUrl: string | null
}

interface OpenF1Session {
  session_key?: unknown
  session_name?: unknown
  meeting_name?: unknown
  country_name?: unknown
  date_start?: unknown
}

interface OpenF1DriverRecord {
  session_key?: unknown
  full_name?: unknown
}

interface Profile {
  originSeries: string
  originTeam: string | null
  pedigree: string
  recentResults: string[]
  sources: PracticeSourceLink[]
  practiceAppearances?: Array<{
    meeting: string
    date: string
    source: PracticeSourceLink
  }>
}

const PROFILES: Record<string, Profile> = {
  arvidlindblad: {
    originSeries: 'FIA Formula 2',
    originTeam: 'Campos Racing',
    pedigree: 'Promoted after finishing fourth in the 2024 FIA Formula 3 championship with four wins.',
    recentResults: ['2024 FIA F3: P4', '4 wins in the 2024 F3 season'],
    sources: [{ label: 'Official 2024 FIA F3 standings', url: 'https://www.fiaformula3.com/en/standings/2024/drivers' }]
  },
  lukebrowning: {
    originSeries: 'FIA Formula 2',
    originTeam: 'Hitech TGR',
    pedigree: 'Williams academy driver promoted after finishing third in the 2024 FIA Formula 3 championship.',
    recentResults: ['2024 FIA F3: P3', '2 wins in the 2024 F3 season'],
    sources: [{ label: 'Official 2024 FIA F3 standings', url: 'https://www.fiaformula3.com/en/standings/2024/drivers' }]
  },
  paularon: {
    originSeries: 'FIA Formula 2',
    originTeam: 'Hitech Pulse-Eight',
    pedigree: 'Finished third in the 2024 FIA Formula 2 championship before becoming an Alpine reserve driver.',
    recentResults: ['2024 FIA F2: P3', '8 podiums in the 2024 F2 season'],
    sources: [{ label: 'Official 2024 FIA F2 standings', url: 'https://www.fiaformula2.com/en/standings/2024/drivers' }]
  },
  felipedrugovich: {
    originSeries: 'FIA Formula 2',
    originTeam: 'MP Motorsport',
    pedigree: '2022 FIA Formula 2 champion and Aston Martin reserve driver.',
    recentResults: ['2022 FIA F2 champion'],
    sources: [{ label: 'Official 2022 FIA F2 standings', url: 'https://www.fiaformula2.com/en/standings/2022/drivers' }]
  },
  frederikvesti: {
    originSeries: 'FIA Formula 2',
    originTeam: 'PREMA Racing',
    pedigree: 'Runner-up in the 2023 FIA Formula 2 championship and Mercedes reserve driver.',
    recentResults: ['2023 FIA F2: P2'],
    sources: [{ label: 'Official 2023 FIA F2 standings', url: 'https://www.fiaformula2.com/en/standings/2023/drivers' }]
  },
  ayumuiwasa: {
    originSeries: 'Super Formula',
    originTeam: 'Team Mugen',
    pedigree: 'Honda and Red Bull development driver with two seasons of FIA Formula 2 experience.',
    recentResults: ['2023 FIA F2: P4'],
    sources: [{ label: 'Official 2023 FIA F2 standings', url: 'https://www.fiaformula2.com/en/standings/2023/drivers' }]
  },
  jakcrawford: {
    originSeries: 'FIA Formula 2',
    originTeam: 'DAMS Lucas Oil',
    pedigree: 'Aston Martin third driver for 2026 after finishing runner-up in the 2025 FIA Formula 2 championship.',
    recentResults: ['2025 FIA F2: P2', '2024 FIA F2: P5 · 1 win · 6 podiums'],
    sources: [
      {
        label: 'Aston Martin third-driver announcement',
        url: 'https://www.astonmartinf1.com/en-GB/news/announcement/jak-crawford-confirmed-as-aston-martin-aramco-third-driver-for-2026'
      },
      { label: 'Official FIA F2 profile', url: 'https://www.fiaformula2.com/Drivers/1234/Jak-Crawford' },
      {
        label: 'Official 2025 F2 finale report',
        url: 'https://www.formula1.com/en/latest/article/f2-duerksen-takes-final-win-of-2025-as-invicta-racing-retain-teams-title.401jcgdkbJcQZWPwAY6l5w'
      }
    ],
    practiceAppearances: [
      {
        meeting: 'Mexico City GP',
        date: '2025-10-24T00:00:00Z',
        source: {
          label: 'Mexico City 2025 FP1',
          url: 'https://www.formula1.com/en/results/2025/races/1272/mexico/practice/1'
        }
      },
      {
        meeting: 'Abu Dhabi GP',
        date: '2025-12-05T00:00:00Z',
        source: {
          label: 'Abu Dhabi 2025 FP1',
          url: 'https://www.formula1.com/en/latest/article/fp1-norris-heads-verstappen-and-leclerc-during-first-practice-in-abu-dhabi.7plaSA7r9WAX1PH0yd09tC'
        }
      },
      {
        meeting: 'Japanese GP',
        date: '2026-03-27T00:00:00Z',
        source: {
          label: 'Japan 2026 FP1',
          url: 'https://www.formula1.com/en/latest/article/fp1-russell-heads-mercedes-1-2-in-opening-practice-session-for-japanese.1WB5ian2z0xW2JirY293oM'
        }
      },
      {
        meeting: 'Austrian GP',
        date: '2026-06-26T00:00:00Z',
        source: {
          label: 'Austria 2026 FP1',
          url: 'https://www.formula1.com/en/latest/article/antonelli-sets-the-pace-in-free-practice-1-from-russell-and-piastri-as-mercedes-dominate-ahead-of-austrian-gp.3KQzRZKdP5gbERaPBKH7rP'
        }
      }
    ]
  }
}

function key(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

function teamKey(value: string | null): string {
  const normalized = key(value ?? '')
  return normalized
    .replace(/formulaone|formul1|f1team|racingteam|racing|team|scuderia|hp|aramco|petronas|moneygram|stake|kick|atlassian/g, '')
}

function words(value: string): string[] {
  return value.split(/\s+/).map((part) => part.trim()).filter(Boolean)
}

function sameDriver(a: string, b: string): boolean {
  const ak = key(a)
  const bk = key(b)
  if (!ak || !bk) return false
  const aLast = key(words(a).at(-1) ?? '')
  const bLast = key(words(b).at(-1) ?? '')
  return ak === bk || (!!aLast && aLast === bLast)
}

function knownPracticeRecord(
  profile: Profile | undefined,
  before: string | null
): { count: number; events: string[]; sources: PracticeSourceLink[] } {
  const beforeMs = before ? Date.parse(before) : Number.POSITIVE_INFINITY
  const appearances = (profile?.practiceAppearances ?? [])
    .filter((appearance) => !Number.isFinite(beforeMs) || Date.parse(appearance.date) < beforeMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  return {
    count: appearances.length,
    events: appearances.map((appearance) => appearance.meeting).slice(-3),
    sources: appearances.map((appearance) => appearance.source)
  }
}

export class PracticeService {
  private cache = new Map<string, { at: number; value: PracticeBriefResult }>()

  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await net.fetch(url, {
        headers: { accept: '*/*', 'user-agent': UA },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Public data request failed (${response.status}).`)
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  private async json(url: string): Promise<unknown> {
    return (await this.fetch(url)).json()
  }

  async briefing(request: PracticeBriefRequest): Promise<PracticeBriefResult> {
    const year = request.year ?? (request.dateStart ? new Date(request.dateStart).getUTCFullYear() : NaN)
    const meetingName = (request.meetingName ?? request.countryName ?? '').trim().slice(0, 120)
    const fail = (error: string): PracticeBriefResult => ({
      ok: false,
      error,
      swaps: [],
      upgrades: [],
      upgradeDocumentUrl: null,
      fetchedAt: new Date().toISOString()
    })
    if (!Number.isInteger(year) || year < 2018 || year > 2035 || !meetingName) {
      return fail('Practice intelligence needs a recognized event and season.')
    }

    const cacheKey = practiceBriefCacheKey(year, meetingName, request)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

    const [swaps, upgradeResult] = await Promise.all([
      this.driverSwaps(year, request).catch(() => []),
      this.weekendUpgrades(year, meetingName).catch(() => ({ upgrades: [], url: null }))
    ])
    const value: PracticeBriefResult = {
      ok: true,
      error: swaps.length === 0 && upgradeResult.upgrades.length === 0
        ? 'No sourced driver-swap or upgrade information was found for this event.'
        : null,
      swaps,
      upgrades: upgradeResult.upgrades,
      upgradeDocumentUrl: upgradeResult.url,
      fetchedAt: new Date().toISOString()
    }
    this.cache.set(cacheKey, { at: Date.now(), value })
    return value
  }

  private async regularDrivers(year: number): Promise<RegularDriver[]> {
    const raw = (await this.json(
      `https://api.jolpi.ca/ergast/f1/${year}/driverstandings/?limit=100`
    )) as {
      MRData?: { StandingsTable?: { StandingsLists?: Array<{ DriverStandings?: unknown[] }> } }
    }
    const rows = raw.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
    const drivers: RegularDriver[] = []
    for (const item of rows as Array<Record<string, unknown>>) {
      const driver = item.Driver as Record<string, unknown> | undefined
      const constructors = Array.isArray(item.Constructors) ? item.Constructors : []
      const constructor = constructors.at(-1) as Record<string, unknown> | undefined
      const fullName = `${String(driver?.givenName ?? '')} ${String(driver?.familyName ?? '')}`.trim()
      const teamName = String(constructor?.name ?? '').trim()
      if (!fullName || !teamName) continue
      drivers.push({
        fullName,
        teamName,
        sourceUrl: typeof driver?.url === 'string' ? driver.url : null
      })
    }
    return drivers
  }

  private async driverSwaps(year: number, request: PracticeBriefRequest): Promise<PracticeDriverSwap[]> {
    const regulars = await this.regularDrivers(year)
    if (regulars.length === 0) return []
    const currentByTeam = new Map<string, string[]>()
    for (const driver of request.drivers) {
      const tk = teamKey(driver.teamName)
      currentByTeam.set(tk, [...(currentByTeam.get(tk) ?? []), driver.fullName])
    }
    const swaps: PracticeDriverSwap[] = []
    for (const driver of request.drivers) {
      const tk = teamKey(driver.teamName)
      if (!tk) continue
      const teamRegulars = regulars.filter((regular) => teamKey(regular.teamName) === tk)
      if (teamRegulars.length === 0 || teamRegulars.some((regular) => sameDriver(regular.fullName, driver.fullName))) continue
      const currentNames = currentByTeam.get(tk) ?? []
      const replaces = teamRegulars
        .filter((regular) => !currentNames.some((name) => sameDriver(name, regular.fullName)))
        .map((regular) => regular.fullName)
      const profile = PROFILES[key(driver.fullName)]
      const prior = await this.priorPracticeRecord(driver.fullName, year, request.dateStart).catch(() => null)
      const knownPrior = knownPracticeRecord(profile, request.dateStart)
      const priorPracticeSessions = prior
        ? Math.max(prior.count, knownPrior.count)
        : knownPrior.count > 0 ? knownPrior.count : null
      const priorPracticeEvents = [...new Set([...(prior?.events ?? []), ...knownPrior.events])].slice(-3)
      const sources: PracticeSourceLink[] = [
        { label: 'Jolpica F1 roster', url: `https://api.jolpi.ca/ergast/f1/${year}/driverstandings/` },
        ...(prior ? [{ label: 'OpenF1 sessions', url: 'https://openf1.org/' }] : []),
        ...(profile?.sources ?? []),
        ...knownPrior.sources
      ]
      swaps.push({
        driverNumber: driver.number,
        code: driver.code,
        fullName: driver.fullName,
        teamName: driver.teamName,
        replaces,
        originSeries: profile?.originSeries ?? null,
        originTeam: profile?.originTeam ?? null,
        pedigree: profile?.pedigree ?? null,
        recentResults: profile?.recentResults ?? [],
        priorPracticeSessions,
        priorPracticeEvents,
        sources
      })
    }
    return swaps
  }

  private async priorPracticeRecord(
    fullName: string,
    year: number,
    before: string | null
  ): Promise<{ count: number; events: string[] }> {
    const years = openF1PracticeYears(year)
    const records = await this.json(
      `https://api.openf1.org/v1/drivers?full_name=${encodeURIComponent(fullName)}`
    )
    const sessionLists = await Promise.all(
      years.map((value) => this.json(`https://api.openf1.org/v1/sessions?year=${value}`))
    )
    const sessions = sessionLists.flatMap((value) => Array.isArray(value) ? value : []) as OpenF1Session[]
    const practice = new Map<number, { meeting: string; date: string }>()
    const beforeMs = before ? Date.parse(before) : Number.POSITIVE_INFINITY
    for (const session of sessions) {
      const sessionName = String(session.session_name ?? '')
      const date = String(session.date_start ?? '')
      const sessionKey = Number(session.session_key)
      if (!sessionName.toLowerCase().includes('practice') || !Number.isFinite(sessionKey)) continue
      if (Number.isFinite(beforeMs) && Date.parse(date) >= beforeMs) continue
      practice.set(sessionKey, { meeting: String(session.meeting_name ?? 'Practice'), date })
    }
    const seen = new Set<number>()
    const events: string[] = []
    for (const record of (Array.isArray(records) ? records : []) as OpenF1DriverRecord[]) {
      const sessionKey = Number(record.session_key)
      const match = practice.get(sessionKey)
      if (!match || seen.has(sessionKey)) continue
      seen.add(sessionKey)
      events.push(match.meeting)
    }
    return { count: seen.size, events: [...new Set(events)].slice(-3) }
  }

  private upgradeUrl(year: number, meetingName: string): string {
    const slug = meetingName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
    return `https://api.fia.com/system/files/decision-document/${year}_${slug}_-_car_presentation_submissions.pdf`
  }

  private async weekendUpgrades(
    year: number,
    meetingName: string
  ): Promise<{ upgrades: WeekendUpgrade[]; url: string | null }> {
    const url = this.upgradeUrl(year, meetingName)
    const response = await this.fetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('pdf')) return { upgrades: [], url: null }
    validatePracticePdfLength(response.headers.get('content-length'))
    if (!response.body) throw new Error('Official upgrade document had no response body.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_PRACTICE_PDF_BYTES) {
          await reader.cancel('PDF size limit exceeded')
          throw new Error('Official upgrade document exceeds the safe size limit.')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const data = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    const parser = new PDFParse({ data })
    try {
      const parsed = await parser.getText({ first: MAX_PDF_PAGES })
      if (new TextEncoder().encode(parsed.text).byteLength > MAX_PDF_TEXT_BYTES) {
        throw new Error('Official upgrade document text exceeds the safe size limit.')
      }
      return { upgrades: parseUpgradeDocument(parsed.text), url }
    } finally {
      await parser.destroy()
    }
  }
}
