import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// ── Time / gap formatting ────────────────────────────────────────────────────

/** 83.456 → "1:23.456". Handles sub-minute and null. */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  if (m === 0) return s.toFixed(3)
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

/** 23.456 → "23.456"; null → "—". For sectors. */
export function formatSector(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return '—'
  return seconds.toFixed(3)
}

/** Gap/interval: number → "+1.234", "+1 LAP" preserved, null → "—". */
export function formatGap(gap: number | '+1 LAP' | null | undefined): string {
  if (gap == null) return '—'
  if (gap === '+1 LAP') return '+1 LAP'
  if (typeof gap === 'string') return gap
  if (!isFinite(gap)) return '—'
  if (gap === 0) return 'LEADER'
  return `+${gap.toFixed(3)}`
}

/** Signed delta: -0.234 → "-0.234", 0.5 → "+0.500". */
export function formatDelta(seconds: number | null | undefined, digits = 3): string {
  if (seconds == null || !isFinite(seconds)) return '—'
  const sign = seconds > 0 ? '+' : seconds < 0 ? '' : '±'
  return `${sign}${seconds.toFixed(digits)}`
}

/** ISO timestamp → "14:05:33" (24h, local). */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-GB', { hour12: false })
}

/** seconds → "42.5s" for the sync badge. */
export function formatOffset(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '-'
  return `${sign}${Math.abs(seconds).toFixed(1)}s`
}

/** seconds → "mm:ss" for scrubber/session clock. */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Hex color (with or without '#') → "#rrggbb". */
export function hexColor(hex: string | null | undefined, fallback = '#8A8F98'): string {
  if (!hex) return fallback
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback
  return `#${clean}`
}

/** Clamp helper. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Linear interpolate. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1)
}
