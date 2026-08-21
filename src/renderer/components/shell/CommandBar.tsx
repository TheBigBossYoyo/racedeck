import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronDown,
  LayoutGrid,
  Pencil,
  RotateCcw,
  Save,
  Check,
  Boxes,
  Crosshair,
  X
} from 'lucide-react'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore, isModuleEnabled } from '@renderer/store/settingsStore'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import { hexColor } from '@renderer/lib/utils'
import {
  LAYOUT_ORDER,
  LAYOUT_PRESETS,
  WIDGET_CATALOG,
  type WidgetKey,
  type WidgetMeta
} from '@renderer/core/engines/LayoutManager'
import { Button } from '@renderer/components/ui/primitives'
import { Dialog, DialogContent, DialogTrigger, DialogClose } from '@renderer/components/ui/Dialog'
import { TransportBar } from './TransportBar'
import { SessionPicker } from './SessionPicker'
import { VideoModeIndicator } from './VideoModeIndicator'
import { cn } from '@renderer/lib/utils'

export function CommandBar() {
  const { currentLayoutId, setLayout, savedLayouts, loadSaved, editMode, toggleEdit, resetLayout } =
    useLayoutStore()

  return (
    <div className="z-20 flex h-11 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-hairline/25 bg-bg-raised/40 px-2 backdrop-blur-xl 2xl:gap-2 2xl:px-3">
      {/* Layout switcher */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="no-drag flex min-w-0 max-w-[135px] items-center gap-1.5 rounded-lg border border-hairline/30 bg-black/20 px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-hairline/60 hover:text-fg min-[1800px]:max-w-[180px] min-[1800px]:px-2.5">
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-accent/80" />
            <span className="truncate text-fg">{LAYOUT_PRESETS[currentLayoutId].name}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-[100] w-64 animate-fade-in rounded-xl border border-hairline/40 bg-bg-overlay/95 p-1.5 shadow-glass-lg backdrop-blur-xl"
          >
            <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-widest text-fg-subtle">
              Workspaces
            </div>
            {LAYOUT_ORDER.map((id) => (
              <DropdownMenu.Item
                key={id}
                onSelect={() => setLayout(id)}
                className="flex cursor-pointer flex-col rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-white/5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs font-medium',
                      currentLayoutId === id ? 'text-accent' : 'text-fg'
                    )}
                  >
                    {LAYOUT_PRESETS[id].name}
                  </span>
                  {currentLayoutId === id && <Check className="ml-auto h-3.5 w-3.5 text-accent" />}
                </div>
                <span className="text-2xs text-fg-subtle">{LAYOUT_PRESETS[id].description}</span>
              </DropdownMenu.Item>
            ))}
            {savedLayouts.length > 0 && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-hairline/30" />
                <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-widest text-fg-subtle">
                  Saved
                </div>
                {savedLayouts.map((l) => (
                  <DropdownMenu.Item
                    key={l.id}
                    onSelect={() => loadSaved(l.id)}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-muted outline-none data-[highlighted]:bg-white/5"
                  >
                    <Save className="h-3 w-3" />
                    {l.name}
                    <span className="ml-auto text-2xs text-fg-subtle">
                      {LAYOUT_PRESETS[l.base].name}
                    </span>
                  </DropdownMenu.Item>
                ))}
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Button
        size="sm"
        variant={editMode ? 'default' : 'ghost'}
        onClick={toggleEdit}
        title="Toggle edit / drag layout"
        className="shrink-0"
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden min-[1800px]:inline">{editMode ? 'Editing' : 'Edit'}</span>
      </Button>
      <AddWidgetMenu />
      <SaveLayoutDialog />
      <Button size="icon" variant="ghost" onClick={resetLayout} title="Reset layout to preset" className="shrink-0">
        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
      </Button>

      <div className="mx-0.5 hidden h-5 w-px shrink-0 bg-hairline/30 xl:block 2xl:mx-1" />
      <SessionPicker />
      <FocusDriverPicker />

      <div className="mx-0.5 hidden h-5 w-px shrink-0 bg-hairline/30 xl:block 2xl:mx-1" />
      <TransportBar />

      <div className="mx-0.5 hidden h-5 w-px shrink-0 bg-hairline/30 xl:block 2xl:mx-1" />
      <VideoModeIndicator />
    </div>
  )
}

function FocusDriverPicker() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const driver = useFocusDriver()
  if (!snapshot || snapshot.timing.length === 0) return null
  const meta = snapshot.drivers.find((d) => d.number === driver)
  const ordered = [...snapshot.timing].filter((t) => t.position != null)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="no-drag flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/30 bg-black/20 px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-hairline/60 hover:text-fg"
          title="Focus a single driver across the dashboard"
        >
          <Crosshair className="h-3.5 w-3.5 shrink-0 text-accent/80" />
          {meta ? (
            <>
              <span className="h-3 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: hexColor(meta.teamColour) }} />
              <span className="text-fg">{meta.code}</span>
            </>
          ) : (
            <span className="hidden min-[1800px]:inline">Focus</span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-[100] max-h-[70vh] w-56 animate-fade-in overflow-auto rounded-xl border border-hairline/40 bg-bg-overlay/95 p-1.5 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-2xs font-semibold uppercase tracking-widest text-fg-subtle">Focus driver</span>
            <button
              onClick={() => pickDriver(null)}
              className="flex items-center gap-0.5 text-2xs text-fg-subtle hover:text-fg"
              title="Clear focus (auto)"
            >
              <X className="h-3 w-3" /> auto
            </button>
          </div>
          {ordered.map((t) => {
            const d = snapshot.drivers.find((x) => x.number === t.driverNumber)
            const active = t.driverNumber === driver
            return (
              <DropdownMenu.Item
                key={t.driverNumber}
                onSelect={() => pickDriver(t.driverNumber)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-white/5"
              >
                <span className="tnum w-5 text-center text-2xs text-fg-subtle">{t.position}</span>
                <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: hexColor(d?.teamColour) }} />
                <span className={cn('font-bold', active ? 'text-accent' : 'text-fg')}>{d?.code ?? t.driverNumber}</span>
                <span className="truncate text-2xs text-fg-subtle">{d?.teamName ?? ''}</span>
                {active && <Check className="ml-auto h-3.5 w-3.5 text-accent" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const GROUP_LABELS: Record<WidgetMeta['group'], string> = {
  video: 'Video',
  timing: 'Timing',
  strategy: 'Strategy & AI',
  charts: 'Charts',
  tools: 'Tools'
}
const GROUP_ORDER: WidgetMeta['group'][] = ['video', 'timing', 'strategy', 'charts', 'tools']

function AddWidgetMenu() {
  const grid = useLayoutStore((s) => s.grid)
  const toggleWidget = useLayoutStore((s) => s.toggleWidget)
  const modules = useSettingsStore((s) => s.modules)
  const present = new Set(grid.map((g) => g.i))

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="ghost" title="Add or remove panels" className="shrink-0">
          <Boxes className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden min-[1800px]:inline">Widgets</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-[100] max-h-[70vh] w-64 animate-fade-in overflow-auto rounded-xl border border-hairline/40 bg-bg-overlay/95 p-1.5 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-widest text-fg-subtle">
            Add / remove panels
          </div>
          {GROUP_ORDER.map((group) => {
            const items = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter(
              (w) => w.group === group && isModuleEnabled(modules, w.key)
            )
            if (items.length === 0) return null
            return (
              <div key={group}>
                <div className="px-2 pb-0.5 pt-1.5 text-2xs font-medium text-fg-subtle/80">
                  {GROUP_LABELS[group]}
                </div>
                {items.map((w) => {
                  const on = present.has(w.key as WidgetKey)
                  return (
                    <DropdownMenu.Item
                      key={w.key}
                      onSelect={(e) => {
                        e.preventDefault() // keep the menu open for multi-add
                        toggleWidget(w.key)
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-white/5"
                    >
                      <span
                        className={cn(
                          'grid h-4 w-4 place-items-center rounded border',
                          on ? 'border-accent/50 bg-accent/20 text-accent' : 'border-hairline/40 text-transparent'
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className={cn(on ? 'text-fg' : 'text-fg-muted')}>{w.title}</span>
                    </DropdownMenu.Item>
                  )
                })}
              </div>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function SaveLayoutDialog() {
  const saveCurrentAs = useLayoutStore((s) => s.saveCurrentAs)
  const [name, setName] = useState('')
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Save current layout" className="shrink-0">
          <Save className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden min-[1800px]:inline">Save</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Save layout"
        description="Store the current panel arrangement as a reusable workspace."
        className="w-[min(92vw,420px)]"
      >
        <div className="p-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Race Wall"
            className="w-full rounded-lg border border-hairline/40 bg-black/30 px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50"
          />
          <div className="mt-3 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="md">
                Cancel
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button
                variant="solid"
                size="md"
                disabled={!name.trim()}
                onClick={() => name.trim() && void saveCurrentAs(name.trim())}
              >
                Save layout
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
