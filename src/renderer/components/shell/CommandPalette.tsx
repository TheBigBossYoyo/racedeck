import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Command as CommandIcon, Search } from 'lucide-react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useAppStore, type Route } from '@renderer/store/appStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useOnboardingStore } from '@renderer/store/onboardingStore'
import { pickDriver } from '@renderer/lib/useFocusDriver'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { buildDebrief, debriefToMarkdown } from '@renderer/core/engines/DebriefBuilder'
import { useAnnotationsStore } from '@renderer/store/annotationsStore'
import {
  LAYOUT_ORDER,
  LAYOUT_PRESETS,
  WIDGET_CATALOG,
  type WidgetKey
} from '@renderer/core/engines/LayoutManager'
import type { ColorVision, ThemeMode } from '@renderer/core/engines/ThemeEngine'
import type { Driver } from '@shared/models'
import { cn, formatDuration } from '@renderer/lib/utils'

/** Stable empty reference — a selector must never return a fresh array each call. */
const NO_DRIVERS: Driver[] = []

/**
 * Command palette (Ctrl/⌘+K) — a searchable launcher for the things a power user
 * reaches for constantly: switch workspace, jump to a view, focus a driver, add
 * a widget, control playback, and flip theme / accessibility modes. It's a
 * `role="dialog"`, so the surface-occlusion guard keeps it above the TOD video.
 */

export interface Command {
  id: string
  label: string
  hint?: string
  group: string
  keywords?: string
  run: () => void
}

function scoreCommand(command: Command, query: string): number {
  const label = command.label.toLowerCase()
  const haystack =
    `${label} ${command.hint ?? ''} ${command.keywords ?? ''} ${command.group}`.toLowerCase()
  if (label === query) return 100
  if (label.startsWith(query)) return 80
  if (label.includes(query)) return 60
  const tokens = query.split(/\s+/).filter(Boolean)
  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) return 40
  return 0
}

/** Rank commands against a query (pure; unit-tested). Empty query = all, in order. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}

const ROUTES: { route: Route; label: string }[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'replay', label: 'Replay' },
  { route: 'settings', label: 'Settings' },
  { route: 'about', label: 'About' }
]
const THEME_MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'dark', label: 'Dark' },
  { mode: 'light', label: 'Light' },
  { mode: 'system', label: 'System' }
]
const COLOR_VISIONS: { vision: ColorVision; label: string }[] = [
  { vision: 'default', label: 'Default colours' },
  { vision: 'deuteranopia', label: 'Colour-blind: deuteranopia' },
  { vision: 'protanopia', label: 'Colour-blind: protanopia' },
  { vision: 'tritanopia', label: 'Colour-blind: tritanopia' }
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const drivers = useSessionStore((s) => s.snapshot?.drivers) ?? NO_DRIVERS

  // Ctrl/⌘+K toggles the palette (Escape is handled on the dialog itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    // Remember what had focus so closing hands it back (a modal that drops focus
    // on <body> strands keyboard users at the top of the page).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    // aria-modal only tells assistive tech the page is inert; keep real focus in too.
    const onFocusIn = (e: FocusEvent) => {
      const dialog = dialogRef.current
      if (dialog && e.target instanceof Node && !dialog.contains(e.target)) inputRef.current?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const close = () => setOpen(false)
    const wrap = (run: () => void) => () => {
      run()
      close()
    }
    const app = useAppStore.getState()
    const layout = useLayoutStore.getState()
    const session = useSessionStore.getState()
    const settings = useSettingsStore.getState()

    const list: Command[] = []
    for (const { route, label } of ROUTES) {
      list.push({
        id: `go-${route}`,
        group: 'Go to',
        label: `Go to ${label}`,
        keywords: 'navigate open view',
        run: wrap(() => app.setRoute(route))
      })
    }
    for (const id of LAYOUT_ORDER) {
      const name = LAYOUT_PRESETS[id]?.name ?? id
      list.push({
        id: `layout-${id}`,
        group: 'Workspace',
        label: `Workspace: ${name}`,
        keywords: 'layout switch',
        run: wrap(() => {
          layout.setLayout(id)
          if (app.route !== 'dashboard' && app.route !== 'replay') app.setRoute('dashboard')
        })
      })
    }
    list.push({
      id: 'play',
      group: 'Playback',
      label: session.playing ? 'Pause' : 'Play',
      keywords: 'space start stop',
      run: wrap(() => session.togglePlay())
    })
    list.push({
      id: 'restart',
      group: 'Playback',
      label: 'Jump to session start',
      keywords: 'seek beginning',
      run: wrap(() => session.seek(0))
    })
    list.push({
      id: 'edit',
      group: 'Workspace',
      label: layout.editMode ? 'Exit edit mode' : 'Edit layout (drag/resize)',
      keywords: 'move widgets',
      run: wrap(() => layout.toggleEdit())
    })

    for (const { mode, label } of THEME_MODES) {
      list.push({
        id: `theme-${mode}`,
        group: 'Appearance',
        label: `Theme: ${label}`,
        keywords: 'colour scheme dark light',
        run: wrap(() => settings.setTheme({ mode }))
      })
    }
    for (const { vision, label } of COLOR_VISIONS) {
      list.push({
        id: `vision-${vision}`,
        group: 'Accessibility',
        label,
        keywords: 'colour blind deficiency accessible tyre',
        run: wrap(() => settings.setTheme({ colorVision: vision }))
      })
    }
    list.push({
      id: 'voice',
      group: 'Accessibility',
      label: settings.voice.enabled ? 'Voice read-out: off' : 'Voice read-out: on',
      keywords: 'speak notes audio',
      run: wrap(() => settings.setVoice({ enabled: !settings.voice.enabled }))
    })
    list.push({
      id: 'tour',
      group: 'Help',
      label: 'Show welcome tour',
      keywords: 'onboarding guide intro help',
      run: wrap(() => useOnboardingStore.getState().openTour())
    })

    if (hasBridge()) {
      list.push({
        id: 'export-debrief',
        group: 'Export',
        label: 'Export race debrief (Markdown)',
        keywords: 'download save summary report',
        run: wrap(() => {
          const full = session.getFullSnapshot()
          if (!full) return
          const debrief = buildDebrief(
            full,
            session.bookmarks,
            undefined,
            useAnnotationsStore.getState().annotations
          )
          void bridge().app.exportDebrief(
            debriefToMarkdown(debrief),
            'md',
            `racedeck-debrief-${Date.now()}.md`
          )
        })
      })
      list.push({
        id: 'export-debrief-json',
        group: 'Export',
        label: 'Export race debrief (JSON)',
        keywords: 'download save summary report data',
        run: wrap(() => {
          const full = session.getFullSnapshot()
          if (!full) return
          const debrief = buildDebrief(
            full,
            session.bookmarks,
            undefined,
            useAnnotationsStore.getState().annotations
          )
          void bridge().app.exportDebrief(
            JSON.stringify(debrief, null, 2),
            'json',
            `racedeck-debrief-${Date.now()}.json`
          )
        })
      })
    }

    // Recent seeks first (APP_IMPROVEMENT_ROADMAP.md P2 item 26) — shown at the
    // top of the unfiltered list, the same way an empty-query palette already
    // lists everything else in the order it was pushed.
    for (const t of session.recentSeeks) {
      list.push({
        id: `recent-${t}`,
        group: 'Recent',
        label: `Resume at ${formatDuration(t)}`,
        keywords: 'recent last seek jump',
        run: wrap(() => session.seek(t))
      })
    }
    for (const bookmark of session.bookmarks) {
      list.push({
        id: `bookmark-${bookmark.kind}-${bookmark.t}`,
        group: 'Jump to',
        label: `Jump to: ${bookmark.label} (${formatDuration(bookmark.t)})`,
        keywords: `bookmark event ${bookmark.kind}`,
        run: wrap(() => session.seek(bookmark.t))
      })
    }
    for (const driver of drivers) {
      const name =
        [driver.firstName, driver.lastName].filter(Boolean).join(' ') ||
        driver.fullName ||
        driver.code
      list.push({
        id: `focus-${driver.number}`,
        group: 'Focus driver',
        label: `Focus ${driver.code} — ${name}`,
        keywords: `${driver.number} ${driver.teamName ?? ''}`,
        run: wrap(() => pickDriver(driver.number))
      })
    }
    for (const key of Object.keys(WIDGET_CATALOG) as WidgetKey[]) {
      const meta = WIDGET_CATALOG[key]
      if (meta.isVideo) continue
      list.push({
        id: `add-${key}`,
        group: 'Add widget',
        label: `Add ${meta.title}`,
        keywords: 'panel insert',
        run: wrap(() => layout.addWidget(key))
      })
    }
    return list
  }, [drivers])

  const results = useMemo(() => filterCommands(commands, query), [commands, query])
  const clampedIndex = Math.min(index, Math.max(0, results.length - 1))

  if (!open) return null

  const runAt = (i: number) => results[i]?.run()
  const optionId = (i: number) => `${listboxId}-opt-${i}`
  const hasResults = results.length > 0

  // Escape closes from anywhere inside; Tab is held inside the dialog. The input is
  // the only tab stop (options are reached with arrow keys), so wrapping is a no-op
  // move in practice but stays correct if a control is ever added.
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key !== 'Tab') return
    const tabbables = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    )
    e.preventDefault()
    if (tabbables.length === 0) return
    const at = tabbables.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (at <= 0 ? tabbables.length - 1 : at - 1) : (at + 1) % tabbables.length
    tabbables[next].focus()
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mx-4 w-full max-w-xl overflow-hidden rounded-2xl border border-hairline/30 bg-bg-overlay shadow-glass"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-hairline/20 px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex(Math.min(clampedIndex + 1, Math.max(0, results.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex(Math.max(clampedIndex - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                runAt(clampedIndex)
              }
            }}
            placeholder="Search commands, drivers, widgets…"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded={hasResults}
            aria-controls={hasResults ? listboxId : undefined}
            aria-activedescendant={hasResults ? optionId(clampedIndex) : undefined}
          />
          <kbd className="rounded border border-hairline/30 px-1.5 py-0.5 text-2xs text-fg-subtle">
            Esc
          </kbd>
        </div>

        {hasResults ? (
          <ul
            id={listboxId}
            className="max-h-[52vh] overflow-y-auto py-1.5"
            role="listbox"
            aria-label="Commands"
          >
            {results.map((command, i) => (
              <PaletteOption
                key={command.id}
                id={optionId(i)}
                command={command}
                active={i === clampedIndex}
                onHover={() => setIndex(i)}
                onRun={() => runAt(i)}
              />
            ))}
          </ul>
        ) : (
          <p role="status" className="px-3.5 py-6 text-center text-xs text-fg-subtle">
            No matching command.
          </p>
        )}
      </div>
    </div>
  )
}

function PaletteOption({
  id,
  command,
  active,
  onHover,
  onRun
}: {
  id: string
  command: Command
  active: boolean
  onHover: () => void
  onRun: () => void
}) {
  const ref = useRef<HTMLLIElement>(null)
  // The active option is never focused (aria-activedescendant), so keyboard
  // navigation has to scroll it into view itself.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      // Keep focus on the input: a click on an option must not blur the combobox.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onRun}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors',
        active ? 'bg-accent/15 text-fg' : 'text-fg-muted hover:bg-white/[0.03]'
      )}
    >
      <CommandIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{command.label}</span>
      <span className="shrink-0 text-2xs text-fg-subtle">{command.group}</span>
    </li>
  )
}
