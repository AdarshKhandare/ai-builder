import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * ErrorBoundary — a defensive wrapper around the Code and Preview
 * panels. Catches render errors that would otherwise take the whole
 * builder down, and surfaces a calm "Something went wrong" affordance
 * in the "Calm Precision" light theme.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-background p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <span
              aria-hidden="true"
              className="
                flex size-10 items-center justify-center
                rounded-md bg-destructive/10 text-destructive
              "
            >
              <AlertTriangle className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Something went wrong. Try regenerating.
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
