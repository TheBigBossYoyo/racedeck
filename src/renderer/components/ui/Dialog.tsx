import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  children,
  className,
  title,
  description
}: {
  children: ReactNode
  className?: string
  title?: string
  description?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'glass-strong fixed left-1/2 top-1/2 z-[95] max-h-[85vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl shadow-glass-lg data-[state=open]:animate-fade-in',
          className
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between border-b border-hairline/25 p-4">
            <div>
              {title && (
                <DialogPrimitive.Title className="text-sm font-semibold text-fg">
                  {title}
                </DialogPrimitive.Title>
              )}
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-fg-muted">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogClose className="rounded-lg p-1 text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg">
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
