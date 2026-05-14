import { Component } from 'react'

/**
 * Last-line-of-defense error boundary for the whole app. Any uncaught render
 * exception below the root would otherwise white-screen the page; here we
 * catch it, log to console, and show a recoverable fallback with a "reload"
 * button. The router is below this, so a navigation that crashes one route
 * still surfaces the rest of the chrome (and "reload" pulls fresh JS in case
 * the build is mid-deploy).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen grid place-items-center px-6 bg-white text-ink-900 font-display">
        <div className="max-w-sm text-center">
          <img src="/gemmi-64.png?v=3" alt="" className="w-16 h-16 mx-auto" />
          <h1 className="mt-4 text-xl font-extrabold">Something broke on our end.</h1>
          <p className="mt-2 text-sm font-semibold text-ink-500">
            The page hit an error while loading. Reloading usually fixes it.
            If it keeps happening, try again in a minute.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-steppe-500 text-white px-5 py-2.5 font-extrabold hover:bg-steppe-600"
          >
            Reload
          </button>
          <details className="mt-4 text-left text-xs text-ink-400 font-mono">
            <summary className="cursor-pointer">Error detail</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{String(this.state.error?.stack || this.state.error)}</pre>
          </details>
        </div>
      </div>
    )
  }
}
