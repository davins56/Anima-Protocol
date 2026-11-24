import type { ReactNode } from "react";

export const SAPPHIRE = "#3b82f6";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-blue-400/15 bg-slate-950/50 backdrop-blur-sm p-4 ${className}`}>{children}</section>;
}

export function Heading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <header className="mb-4">
      {eyebrow ? <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-blue-300/60">{eyebrow}</p> : null}
      <h2 className="font-serif text-2xl text-slate-100">{title}</h2>
      {sub ? <p className="text-sm text-slate-400 mt-1">{sub}</p> : null}
    </header>
  );
}

/** Honest "not wired yet" note for anything waiting on another team's route. */
export function PendingNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="text-xs text-amber-200/80 border border-amber-300/20 bg-amber-950/20 rounded-md px-3 py-2">
      {children}
    </p>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-blue-400/10 bg-slate-900/40 px-3 py-2 text-center" title={hint}>
      <div className="font-serif text-xl text-slate-100">{value}</div>
      <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-slate-400">{label}</div>
    </div>
  );
}
