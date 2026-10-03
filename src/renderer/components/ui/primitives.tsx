import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, hexColor } from '@renderer/lib/utils'
import { TYRE_LABELS } from '@shared/constants'
import { useTyreColors } from '@renderer/lib/useTyreColors'
import type { DataProvenance, TyreCompound } from '@shared/models'

// ── Button ───────────────────────────────────────────────────────────────────
const buttonVariants = cva(
  'no-drag inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default:
          'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 hover:border-accent/50',
        solid: 'bg-accent text-black hover:brightness-110 shadow-glow',
        ghost: 'text-fg-muted hover:text-fg hover:bg-white/5',
        outline:
          'border border-hairline/40 text-fg-muted hover:text-fg hover:border-hairline/70 hover:bg-white/5',
        subtle:
          'bg-white/[0.04] text-fg-muted hover:bg-white/[0.08] hover:text-fg border border-white/5',
        danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25'
      },
      size: {
        xs: 'h-6 px-2 text-2xs',
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-[13px]',
        icon: 'h-7 w-7',
        'icon-sm': 'h-6 w-6'
      }
    },
    defaultVariants: { variant: 'ghost', size: 'sm' }
  }
)

/**
 * Explicit keyboard-focus ring for row/list buttons that are not a `Button`.
 * The `Inset` form is for rows inside a clipped (overflow-hidden) scroll body,
 * where an outer ring would be cut off at the panel edge.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
export const FOCUS_RING_INSET =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60'

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)
Button.displayName = 'Button'

// ── Segmented control ────────────────────────────────────────────────────────
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className
}: {
  options: { value: T; label: ReactNode; title?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="group"
      className={cn(
        'no-drag inline-flex items-center gap-0.5 rounded-lg border border-hairline/30 bg-black/20 p-0.5',
        className
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-all',
            FOCUS_RING_INSET,
            size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
            value === o.value
              ? 'bg-accent/20 text-accent shadow-inner-hairline'
              : 'text-fg-subtle hover:text-fg-muted'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Badge ────────────────────────────────────────────────────────────────────
export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'danger' | 'purple'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-white/5 text-fg-muted border-white/10',
    accent: 'bg-accent/15 text-accent border-accent/30',
    good: 'bg-good/15 text-good border-good/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    purple: 'bg-purple/15 text-purple border-purple/30'
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

// ── Provenance badge ─────────────────────────────────────────────────────────

const PROVENANCE_META: Record<
  DataProvenance,
  { label: string; tone: 'good' | 'accent' | 'warn' | 'neutral' }
> = {
  measured: { label: 'measured', tone: 'good' },
  'feed-derived': { label: 'feed', tone: 'accent' },
  modelled: { label: 'modelled', tone: 'warn' },
  insufficient: { label: 'insufficient', tone: 'neutral' }
}

/**
 * A consistent "how trustworthy is this number" marker (APP_IMPROVEMENT_ROADMAP.md
 * P0 item 4). Similar-looking values across different widgets otherwise carry
 * different evidentiary strength with no visible signal of that difference.
 */
export function ProvenanceBadge({
  provenance,
  detail,
  className
}: {
  provenance: DataProvenance
  /** Source/sample-count/replay-boundary text shown in the tooltip. */
  detail?: string
  className?: string
}) {
  const meta = PROVENANCE_META[provenance]
  return (
    <span title={detail}>
      <Badge tone={meta.tone} className={className}>
        {meta.label}
      </Badge>
    </span>
  )
}

// ── Tyre compound pill ───────────────────────────────────────────────────────
export function TyrePill({
  compound,
  age,
  size = 'md'
}: {
  compound: TyreCompound | null
  age?: number | null
  size?: 'sm' | 'md'
}) {
  const tyreColors = useTyreColors()
  if (!compound) return <span className="text-fg-subtle">—</span>
  const color = tyreColors[compound]
  const hardTyre = compound === 'HARD'
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          'grid place-items-center rounded-full border-2 font-bold',
          size === 'sm' ? 'h-4 w-4 text-[9px]' : 'h-5 w-5 text-[10px]'
        )}
        style={{
          borderColor: hardTyre ? 'rgb(var(--fg-muted))' : color,
          backgroundColor: `${color}22`,
          color: hardTyre ? 'rgb(var(--fg))' : color
        }}
        title={compound}
        role="img"
        aria-label={`${compound} tyre`}
      >
        {TYRE_LABELS[compound]}
      </span>
      {age != null && (
        <span className="tnum text-2xs text-fg-subtle" title={`${age} laps on this tyre`}>
          L{age}
        </span>
      )}
    </span>
  )
}

// ── Driver color dot / team stripe ───────────────────────────────────────────
export function TeamStripe({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block h-full w-[3px] shrink-0 rounded-full"
      style={{ backgroundColor: hexColor(color) }}
    />
  )
}

export function StatusDot({
  tone,
  pulse = false,
  label
}: {
  tone: 'good' | 'warn' | 'danger' | 'neutral' | 'accent'
  pulse?: boolean
  /** Text alternative for a dot that stands alone; omit when adjacent text already says it. */
  label?: string
}) {
  const colors: Record<string, string> = {
    good: 'bg-good',
    warn: 'bg-warn',
    danger: 'bg-danger',
    neutral: 'bg-fg-subtle',
    accent: 'bg-accent'
  }
  return (
    <span
      className="relative inline-flex h-2 w-2"
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    >
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            colors[tone]
          )}
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', colors[tone])} />
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-hairline/50 bg-black/30 px-1.5 py-0.5 text-2xs font-medium text-fg-muted">
      {children}
    </kbd>
  )
}

export function EmptyState({
  icon,
  title,
  hint
}: {
  icon?: ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      {icon && <div className="text-fg-subtle/60 [&>svg]:h-7 [&>svg]:w-7">{icon}</div>}
      <div className="text-xs font-medium text-fg-muted">{title}</div>
      {hint && <div className="max-w-[240px] text-2xs text-fg-subtle">{hint}</div>}
    </div>
  )
}
