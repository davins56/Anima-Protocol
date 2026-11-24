import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bug } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { listMyReports as defaultListMine, openBugReport } from "@/lib/bugSquasher/api";
import { readShowTab, writeShowTab } from "./prefs";
import { KIND_LABEL, STATUS_CLASS, STATUS_LABEL, relativeTime } from "./statusStyles";

/**
 * Settings → Data & Privacy: report a bug, show/hide the edge tab, see your
 * own reports and their status, and (admins) open triage.
 */
export default function BugSquasherSettingsCard({ isAdmin = false, api }) {
  const listMine = api?.listMyReports || defaultListMine;
  const [showTab, setShowTab] = useState(() => readShowTab(isAdmin));
  const [state, setState] = useState({ loading: true, reports: [], error: "" });

  useEffect(() => {
    let live = true;
    listMine()
      .then((reports) => live && setState({ loading: false, reports, error: "" }))
      .catch((err) => live && setState({ loading: false, reports: [], error: err?.message || "" }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="border border-primary/15 bg-card p-5 space-y-4" data-testid="bug-squasher-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
            <Bug className="w-3.5 h-3.5" aria-hidden="true" />
            Bug Squasher
          </p>
          <p className="text-[9px] font-mono text-primary/30 mt-0.5 leading-relaxed">
            Crashes and failed requests are reported automatically (no messages or memories). Something else feel off? Tell us.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openBugReport()}
          className="flex-shrink-0 border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary hover:bg-primary/20"
        >
          Report a bug
        </button>
      </div>

      <label className="flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.15em] text-primary/60">
        Show the bug tab on every screen
        <Switch
          checked={showTab}
          onCheckedChange={(v) => {
            setShowTab(v);
            writeShowTab(v);
          }}
          aria-label="Show the bug tab on every screen"
        />
      </label>

      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/40">Your reports</p>
        {state.loading ? (
          <p role="status" className="font-mono text-[10px] text-primary/30">Loading…</p>
        ) : state.error ? (
          <p className="font-mono text-[10px] text-primary/40">{state.error}</p>
        ) : state.reports.length === 0 ? (
          <p className="font-mono text-[10px] text-primary/30">No reports yet.</p>
        ) : (
          <ul className="space-y-1" aria-label="Your bug reports">
            {state.reports.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 font-mono text-[10px] text-primary/60">
                <span className="truncate">
                  <span className="text-primary/30">{KIND_LABEL[r.kind] || r.kind} · </span>
                  {r.title}
                  {r.count > 1 ? <span className="text-primary/30"> ×{r.count}</span> : null}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-primary/30">{relativeTime(r.last_seen)}</span>
                  <span className={`border px-1.5 py-0.5 ${STATUS_CLASS[r.status] || ""}`}>{STATUS_LABEL[r.status] || r.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isAdmin && (
        <Link
          to="/bug-squasher"
          className="block border border-primary/30 px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-primary hover:border-primary/60"
        >
          Open Bug Squasher triage
        </Link>
      )}
    </div>
  );
}
