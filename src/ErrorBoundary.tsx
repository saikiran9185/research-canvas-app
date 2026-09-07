import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Catches a render crash and says what happened.
 *
 * Without this, a single thrown error unmounts the entire tree and leaves a
 * blank window with no message — the app simply disappears, and the only way
 * to learn anything is to open developer tools, which nobody using the app is
 * going to do. Most of the "unknown bugs" in an app this age are really this:
 * something threw, and there was nothing left on screen to say so.
 *
 * The board itself is safe either way — it is a file on disk, already saved.
 * That is worth telling the person outright, because a blank screen in a
 * drawing app reads as lost work.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack: it is the difference between "something broke"
    // and knowing which card was rendering when it did.
    console.error("Research Canvas crashed while rendering:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>
          The app hit an error while drawing the screen. <strong>Your board is safe</strong> —
          it is a file on disk and was saved before this happened.
        </p>
        <pre className="crash-detail">{error.message}</pre>
        <div className="crash-actions">
          <button className="cta" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button onClick={() => window.location.reload()}>Reload the app</button>
        </div>
        <p className="crash-hint">
          If it keeps happening, the full details are in the developer console, and this is
          worth reporting as an issue.
        </p>
      </div>
    );
  }
}
