import { Component } from "react";
import { track } from "@/lib/analytics";

// A render-phase error in any child unmounts the whole React tree by default,
// leaving the user staring at a blank screen (reads as a hard "crash"). This
// boundary catches that error, keeps the rest of the app shell alive, and shows
// an on-brand recovery panel instead.
//
// `resetKey` lets a parent (e.g. the router) clear a caught error when the user
// navigates away — without it, the panel would stick around on every route.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    // Recover automatically when the reset key changes (e.g. route change).
    if (
      this.state.hasError &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error, errorInfo) {
    // Always log so the crash is diagnosable in the browser console.
    console.error("[ErrorBoundary] caught render error:", error, errorInfo);
    // Best-effort analytics (no-op until initialized + consent granted).
    try {
      track("Error Boundary Triggered", {
        message: error?.message || String(error),
        component_stack: errorInfo?.componentStack?.slice(0, 500),
      });
    } catch {
      /* never let error reporting throw */
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-primary/30 bg-[#090912] shadow-[0_0_30px_rgba(34,211,238,0.15)] p-8 text-center">
          <div className="mx-auto mb-5 w-12 h-12 flex items-center justify-center border border-primary/40 rounded-full">
            <span className="text-primary text-xl font-mono">!</span>
          </div>
          <h2 className="font-mono text-xs tracking-[0.3em] uppercase text-primary/90 mb-3">
            Something went wrong
          </h2>
          <p className="font-mono text-[11px] leading-relaxed text-primary/50 mb-6">
            This screen hit an unexpected error. The rest of the app is still
            running — reload to try again.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="font-mono text-[10px] tracking-[0.2em] uppercase bg-primary/15 text-primary border border-primary/40 px-5 py-2.5 hover:bg-primary/25 transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
