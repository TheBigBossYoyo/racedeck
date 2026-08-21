import { type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * WidgetFrame — the glass panel shell used by every dashboard widget.
 * Its header doubles as the react-grid-layout drag handle (`.rd-drag-handle`).
 */
export function WidgetFrame({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  accent = false,
  noPadding = false,
  scroll = true
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  accent?: boolean
  noPadding?: boolean
  scroll?: boolean
}) {
  return (
    <div
      className={cn(
        'glass relative flex h-full w-full flex-col overflow-hidden rounded-2xl',
        accent && 'accent-top',
        className
      )}
    >
      <header className="rd-drag-handle flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-hairline/25 px-3 active:cursor-grabbing">
        {icon && <span className="text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        <div className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
            {title}
          </span>
        </div>
        {subtitle && (
          <span className="truncate text-2xs text-fg-subtle">{subtitle}</span>
        )}
        <div className="no-drag ml-auto flex items-center gap-1">{actions}</div>
      </header>
      <div
        className={cn(
          'min-h-0 flex-1',
          scroll ? 'overflow-auto' : 'overflow-hidden',
          !noPadding && 'p-3',
          bodyClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}
