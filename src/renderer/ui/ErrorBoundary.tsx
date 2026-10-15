// Error boundaries: a failing panel or dialog must not take the workspace (or open documents) down.
// Documents live in module-level stores, so re-rendering after an error keeps all artwork.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { toast, useUi } from '../state/ui';

interface Props {
  /** What failed, for the message ("Layers panel", "dialog", "workspace"). */
  name: string;
  kind: 'panel' | 'dialog' | 'app';
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Canvas Forge] ${this.props.name} failed`, error, info.componentStack);
    if (this.props.kind === 'dialog') {
      // close the broken dialog and explain; the next dialog starts from a clean boundary
      useUi.getState().closeDialog();
      toast('error', 'The dialog stopped because of an unexpected error.', error.message);
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error || this.props.kind === 'dialog') return error ? null : this.props.children;
    if (this.props.kind === 'panel') {
      return (
        <div className="error-surface is-panel" role="alert">
          <p>
            <strong>{this.props.name} could not be shown.</strong> {error.message}
          </p>
          <button type="button" className="btn btn-default" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="error-surface is-app" role="alert" data-testid="app-error">
        <h1>Something went wrong in the interface</h1>
        <p>{error.message}</p>
        <p className="muted">
          Your open documents are still in memory. Try to continue; if the problem repeats, reload the
          interface — recovery snapshots written before the problem are offered after reloading.
        </p>
        <div className="error-actions">
          <button type="button" className="btn btn-primary" onClick={this.reset}>
            Try to continue
          </button>
          <button type="button" className="btn btn-default" onClick={() => location.reload()}>
            Reload interface
          </button>
        </div>
      </div>
    );
  }
}

let lastMessage = '';
let lastAt = 0;

/** Surfaces uncaught errors and rejected promises as toasts (rate-limited) instead of failing silently. */
export function installGlobalErrorHandlers() {
  const report = (message: string) => {
    const now = Date.now();
    if (message === lastMessage && now - lastAt < 5000) return;
    lastMessage = message;
    lastAt = now;
    toast('error', 'Unexpected error', message);
  };
  window.addEventListener('error', (e) => {
    // resource loading errors have no message and are not actionable for the user
    if (!e.message) return;
    report(e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: unknown } | undefined;
    report(typeof r?.message === 'string' ? r.message : String(e.reason));
  });
}
