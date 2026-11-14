import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { webglProbe } from "@/lib/webglSupport";
import { diagnosticLine, retryDelay, tierForAttempt, webglUnavailable, type GLTier } from "./glLadder";

/** Catches a renderer crash (e.g. three's "Error creating WebGL context.") and reports it instead of rendering a dead end. */
class GLBoundary extends Component<{ onError: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[cyberworld] WebGL renderer failed", error);
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "unknown error"));

/**
 * Mounts the scene on the current GL tier; on a crash or an unrecovered
 * context loss, remounts (fresh canvas) on the next tier with backoff, up to
 * MAX_GL_ATTEMPTS. Then shows a Retry button with a one-line diagnostic.
 */
export function GLHost({ children }: { children: (gl: { tier: GLTier; onLost: (reason: string) => void }) => ReactNode }) {
  const probe = useMemo(() => webglProbe(), []);
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
  const [last, setLast] = useState<{ tier: GLTier; error: string } | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const tier = tierForAttempt(attempt);
  const debug = typeof window !== "undefined" && /[?&]debug\b/.test(window.location.search);

  const fail = useCallback(
    (error: string) => {
      setLast({ tier, error });
      setFailures((f) => {
        const n = f + 1;
        const delay = retryDelay(n);
        if (delay == null) setGaveUp(true);
        else {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setAttempt((a) => a + 1), delay);
        }
        return n;
      });
    },
    [tier],
  );

  const retry = () => {
    setGaveUp(false);
    setFailures(0);
    setAttempt((a) => a + 1);
  };

  if (webglUnavailable(probe) || gaveUp) {
    const line = last ? diagnosticLine({ tier: last.tier.name, error: last.error, probe, attempts: failures }) : diagnosticLine({ tier: "webgl2", error: probe.error ?? "no WebGL2 or WebGL1 context", probe, attempts: 0 });
    return (
      <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-cyan-300/70">
        <div className="max-w-sm space-y-3">
          <p>{!probe.webgl2 && probe.webgl1 ? "This browser only offers WebGL1; the cyberworld needs WebGL2." : "The cyberworld couldn’t start its 3D view."}</p>
          <button type="button" onClick={retry} className="border border-cyan-300/60 bg-black/70 px-3 py-1.5 uppercase tracking-widest text-cyan-200">
            Retry
          </button>
          <p className={`break-words text-[9px] text-cyan-300/40 ${debug ? "" : "line-clamp-2"}`}>{line}</p>
        </div>
      </div>
    );
  }
  return (
    <GLBoundary key={attempt} onError={(e) => fail(message(e))}>
      {children({ tier, onLost: fail })}
    </GLBoundary>
  );
}
