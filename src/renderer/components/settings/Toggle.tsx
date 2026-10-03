import { Switch } from '@renderer/components/ui/controls'

export function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-fg">{label}</div>
        {hint && <div className="text-2xs text-fg-subtle">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
