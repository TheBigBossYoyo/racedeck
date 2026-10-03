import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Button } from '@renderer/components/ui/primitives'
import { WIDGET_CATALOG, type WidgetKey } from '@renderer/core/engines/LayoutManager'
import { errorMessage } from '@renderer/lib/errorMessage'

interface WidgetErrorBoundaryProps {
  widgetKey: WidgetKey
  /**
   * When any entry changes (Object.is) while the widget is in its crashed state, the
   * boundary retries rendering. Pass the inputs the widget derives from (e.g. the
   * snapshot clock and session id) so one bad tick recovers on the next good one.
   */
  resetKeys?: readonly unknown[]
  children: ReactNode
}

interface WidgetErrorBoundaryState {
  error: Error | null
}

function keysChanged(prev: readonly unknown[] = [], next: readonly unknown[] = []): boolean {
  return prev.length !== next.length || prev.some((key, i) => !Object.is(key, next[i]))
}

/**
 * Isolates a single dashboard widget: a render/derivation crash in one card
 * must not take down the rest of the 40+ widget dashboard.
 */
export class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): WidgetErrorBoundaryState {
    // Anything can be thrown; a null/string would otherwise read as "no error" or lack .message.
    return { error: error instanceof Error ? error : new Error(errorMessage(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[WidgetErrorBoundary] "${this.props.widgetKey}" crashed:`,
      error,
      info.componentStack
    )
  }

  componentDidUpdate(
    prevProps: WidgetErrorBoundaryProps,
    prevState: WidgetErrorBoundaryState
  ): void {
    // prevState.error guards against resetting in the very commit that caught the error
    // (keys changed AND the child threw), which would loop.
    if (
      this.state.error !== null &&
      prevState.error !== null &&
      keysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset()
    }
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const title = WIDGET_CATALOG[this.props.widgetKey]?.title ?? this.props.widgetKey
    return (
      <WidgetFrame title={title} icon={<AlertTriangle className="text-danger" />}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
          <AlertTriangle className="h-6 w-6 text-danger" />
          <p className="text-sm text-fg-muted">This widget crashed and has been isolated.</p>
          <p className="max-w-[85%] break-words text-2xs text-fg-subtle">{error.message}</p>
          <Button size="sm" variant="outline" onClick={this.reset}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </WidgetFrame>
    )
  }
}
