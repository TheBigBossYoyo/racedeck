import type { ReactNode } from 'react'

export function Section({
  icon,
  title,
  desc,
  children
}: {
  icon: ReactNode
  title: string
  desc?: string
  children: ReactNode
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {desc && <p className="text-xs text-fg-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}
