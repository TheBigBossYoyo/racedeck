import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Keeps high-frequency source data fresh while publishing it at a bounded rate.
 * Identity changes bypass the interval so switching sessions never shows stale data.
 */
export function useSampledValue<T>(value: T, intervalMs: number, identity: unknown): T {
  const [sampled, setSampled] = useState(value)
  const latestRef = useRef(value)
  const identityRef = useRef(identity)
  const lastPublishRef = useRef(performance.now())
  const timeoutRef = useRef<number | null>(null)

  latestRef.current = value

  useLayoutEffect(() => {
    const publish = () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      lastPublishRef.current = performance.now()
      setSampled(latestRef.current)
    }

    if (identityRef.current !== identity) {
      identityRef.current = identity
      publish()
      return
    }

    const remaining = intervalMs - (performance.now() - lastPublishRef.current)
    if (remaining <= 0) {
      publish()
    } else if (timeoutRef.current == null) {
      timeoutRef.current = window.setTimeout(publish, remaining)
    }
  }, [value, intervalMs, identity])

  useEffect(
    () => () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current)
    },
    []
  )

  return sampled
}
