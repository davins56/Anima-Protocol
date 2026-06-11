import { Component, Fragment } from "react";
import { track } from "@/lib/analytics";

// A render-phase error in any child unmounts the whole React tree by default,
// leaving the user staring at a blank screen (reads as a hard "crash"). This
// boundary catches that error and tries to heal itself:
//   1. On the first crash it silently attempts ONE in-place recovery — it
//      remounts the child subtree (via `recoverKey`) after a short beat. Most
//      crashes are transient (a race, a momentarily-missing value), so this
//      brings the app back with no user action and no full reload.
//   2. If the crash persists, it shows an on-brand self-repair panel offering a
//      manual in-place "Self-repair" (remount) or a full "Reload".
// It also listens for uncaught runtime errors / promise rejections so they are
// logged and reported for diagnosis (these are usually non-fatal, so they don't
// trip the crash panel).
//
// `resetKey` lets a parent (e.g. the router) clear a caught error when the user
// navigates away; a route change also refreshes the auto-heal budget.

const AUTO_HEAL_DELAY_MS = 700;

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, attempts: 0, recoverKey: 0 };
    this.healTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidMount() {
    // Capture errors that escape React's render phase (event handlers, async
    // callbacks, rejected promises). Best-effort reporting only.
    this.onWindowError = (event) => {
      this.report("Runtime Error Captured", event?.error || event?.message);
    };
    this.onRejection = (event) => {
      this.report("Unhandled Promise Rejection", event?.reason);
    };
    try {
      window.addEventListener("error", this.onWindowError);
      window.addEventListener("unhandledrejection", this.onRejection);
    } catch {
      /* non-browser env */
    }
  }

  componentDidUpdate(prevProps) {
    // Recover automatically when the reset key changes (e.g. route change) and
    // give the new screen a fresh auto-heal budget.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.clearHealTimer();
      this.setState((s) => ({
        hasError: false,
        error: null,
        attempts: 0,
        recoverKey: s.recoverKey + 1,
      }));
    }
  }

  componentDidCatch(error, errorInfo) {
    // Always log so the crash is diagnosable in the browser console.
    console.error("[ErrorBoundary] caught render error:", error, errorInfo);
    this.report("Error Boundary Triggered", error, errorInfo);

    // First crash: attempt one silent in-place self-repair. If it throws again
    // the attempt counter blocks a retry loop and the manual panel takes over.
    if (this.state.attempts < 1) {
      this.clearHealTimer();
      this.healTimer = setTimeout(() => {
        this.setState((s) =>
          s.hasError
            ? {
                hasError: false,
                error: null,
                attempts: s.attempts + 1,
                recoverKey: s.recoverKey + 1,
              }
            : s,
        );
      }, AUTO_HEAL_DELAY_MS);
    }
  }

  componentWillUnmount() {
    this.clearHealTimer();
    try {
      window.removeEventListener("error", this.onWindowError);
      window.removeEventListener("unhandledrejection", this.onRejection);
    } catch {
      /* non-browser env */
    }
  }

  clearHealTimer() {
    if (this.healTimer) {
      clearTimeout(this.healTimer);
      this.healTimer = null;
    }
  }

  // Best-effort analytics that can never itself crash the boundary.
  report(eventName, error, errorInfo) {
    try {
      track(eventName, {
        message:
          (error && (error.message || String(error))) || "(unknown error)",
        component_stack: errorInfo?.componentStack?.slice(0, 500),
      });
    } catch {
      /* never let error reporting throw */
    }
  }

  handleSelfRepair = async () => {
  this.clearHealTimer();

  try {
    // 1. Try to cleanly sign out from both auth systems
    if (typeof window !== "undefined") {
      // Clerk (if present)
      if (window.Clerk && typeof window.Clerk.signOut === "function") {
        await window.Clerk.signOut();
      }

      // base44 custom auth (if present)
      if (window.base44 && window.base44.auth && typeof window.base44.auth.logout === "function") {
        await window.base44.auth.logout();
      }
    }

    // 2. Nuclear clear of any lingering auth/session data
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}

    // 3. Now remount the app (this is what the original did)
    this.setState((s) => ({
      hasError: false,
      error: null,
      attempts: s.attempts + 1,
      recoverKey: s.recoverKey + 1,
    }));
  } catch (err) {
    console.error("[ErrorBoundary] Self-repair failed, forcing reload:", err);
    window.location.reload();
  }
};

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      // Keyed so a self-repair remounts the subtree (clearing any bad state).
      return <Fragment key={this.state.recoverKey}>{this.props.children}</Fragment>;
    }

    // First crash: stay quiet while the one-shot auto-heal is pending. Remounting
    // the subtree fixes most transient errors (a race, a momentarily-missing
    // value) with no alarm — show only a subtle indicator, never the full panel.
    if (this.state.attempts < 1) {
      return (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <div className="flex items-center gap-2 text-primary/40 font-mono text-[10px] tracking-[0.3em] uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
            Re-syncing
          </div>
        </div>
      );
    }

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
            running — try a self-repair to rebuild this screen in place, or
            reload if it persists.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleSelfRepair}
              className="font-mono text-[10px] tracking-[0.2em] uppercase bg-primary/15 text-primary border border-primary/40 px-5 py-2.5 hover:bg-primary/25 transition-colors"
            >
              Self-repair
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/60 border border-primary/20 px-5 py-2.5 hover:text-primary hover:border-primary/40 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
