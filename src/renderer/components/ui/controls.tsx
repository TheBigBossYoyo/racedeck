import { forwardRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@renderer/lib/utils'

// ── Switch ───────────────────────────────────────────────────────────────────
export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'no-drag peer inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border border-hairline/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 data-[state=checked]:border-accent/50 data-[state=checked]:bg-accent/80 data-[state=unchecked]:bg-white/5',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-[14px] w-[14px] translate-x-[3px] rounded-full bg-fg shadow-lg transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-black" />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'

// ── Slider ───────────────────────────────────────────────────────────────────
export const Slider = forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('no-drag relative flex w-full touch-none select-none items-center', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/10">
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-accent/70 to-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-black shadow-glow transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
  </SliderPrimitive.Root>
))
Slider.displayName = 'Slider'

// ── Tooltip ──────────────────────────────────────────────────────────────────
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200} skipDelayDuration={100}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export function Tooltip({
  children,
  content,
  side = 'top'
}: {
  children: React.ReactNode
  content: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[100] max-w-[280px] animate-fade-in rounded-lg border border-hairline/50 bg-bg-overlay/95 px-2.5 py-1.5 text-xs text-fg shadow-glass-lg backdrop-blur-xl"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-bg-overlay" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
