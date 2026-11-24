import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bug, RefreshCw, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import * as bugApi from "@/lib/bugSquasher/api";
import { openBugReport } from "@/lib/bugSquasher/api";
import {
  KIND_LABEL,
  matchesFilter,
  STATUS_CLASS,
  STATUS_LABEL,
  relativeTime,
} from "@/components/bugSquasher/statusStyles";

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "new", label: "New" },
  { id: "triaged", label: "Triaged" },
  { id: "fixed", label: "Fixed" },
  { id: "ignored", label: "Ignored" },
  { id: "all", label: "All" },
];

function StatusChip({ status }) {
  return (
    <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] ${STATUS_CLASS[status] || ""}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function Field({ label, children }) {
  if (children == null || children === "") return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-[11px]">
      <span className="uppercase tracking-[0.15em] text-primary/40">{label}</span>
      <span className="break-all text-primary/80">{children}</span>
    </div>
  );
}

function ReportDetail({ report, api }) {
  const [shot, setShot] = useState(null);
  const [loadingShot, setLoadingShot] = useState(false);
  const crumbs = Array.isArray(report.context?.breadcrumbs) ? report.context.breadcrumbs : [];
  return (
    <li className="space-y-2 border border-primary/10 p-3" data-testid="bug-report-row">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="text-primary/70">
          {report.user_id} · ×{report.count}
          {report.reopen_count ? ` · reopened ${report.reopen_count}×` : ""}
        </span>
        <span className="flex items-center gap-2 text-primary/40">
          {relativeTime(report.last_seen)}
          <StatusChip status={report.status} />
        </span>
      </div>
      {report.description && (
        <p className="whitespace-pre-wrap border-l-2 border-primary/30 pl-2 text-xs text-primary/90">{report.description}</p>
      )}
      <Field label="Route">{report.route}</Field>
      <Field label="Version">{report.app_version}</Field>
      <Field label="Browser">{report.user_agent}</Field>
      <Field label="First seen">{report.first_seen ? new Date(report.first_seen).toLocaleString() : ""}</Field>
      {report.context?.api && (
        <Field label="Request">
          {report.context.api.method} {report.context.api.path} → {report.context.api.status || "network error"}
          {report.context.api.duration_ms ? ` (${report.context.api.duration_ms} ms)` : ""}
        </Field>
      )}
      {report.context?.chat && (
        <Field label="Chat">
          {report.context.chat.failure_type} / {report.context.chat.phase}
          {report.context.chat.turn_id ? ` · turn ${report.context.chat.turn_id}` : ""}
        </Field>
      )}
      {report.stack && (
        <details>
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-primary/50">Stack</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all bg-black/50 p-2 text-[10px] text-primary/60">{report.stack}</pre>
        </details>
      )}
      {report.context?.component_stack && (
        <details>
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-primary/50">Component stack</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all bg-black/50 p-2 text-[10px] text-primary/60">{report.context.component_stack}</pre>
        </details>
      )}
      {crumbs.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-primary/50">
            Breadcrumbs ({crumbs.length})
          </summary>
          <ol className="mt-1 max-h-48 space-y-0.5 overflow-auto bg-black/50 p-2 text-[10px] text-primary/60">
            {crumbs.map((c, i) => (
              <li key={i}>
                <span className="text-primary/30">{String(c.at || "").slice(11, 19)} </span>
                <span className="text-primary/50">[{c.type}]</span> {c.message}
              </li>
            ))}
          </ol>
        </details>
      )}
      {report.has_screenshot &&
        (shot ? (
          <img src={shot} alt="Attached screenshot" className="max-h-96 border border-primary/20" />
        ) : (
          <button
            type="button"
            disabled={loadingShot}
            onClick={async () => {
              setLoadingShot(true);
              try {
                setShot(await api.getBugScreenshot(report.id));
              } catch (err) {
                toast.error(err?.message || "Couldn't load the screenshot.");
              } finally {
                setLoadingShot(false);
              }
            }}
            className="border border-primary/30 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-primary/70 hover:border-primary/60"
          >
            {loadingShot ? "Loading…" : "View screenshot"}
          </button>
        ))}
    </li>
  );
}

function GroupDetail({ group, api, onChanged }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(group.admin_note || "");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let live = true;
    setReports(null);
    setError("");
    setNote(group.admin_note || "");
    api
      .getBugGroup(group.fingerprint)
      .then((rows) => live && setReports(rows))
      .catch((err) => live && setError(err?.message || "Couldn't load this bug."));
    return () => {
      live = false;
    };
  }, [group.fingerprint, group.admin_note, api]);

  const setStatus = async (status) => {
    setBusy(status);
    try {
      await api.setBugGroupStatus(group.fingerprint, status, note.trim() || null);
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}.`);
      onChanged();
    } catch (err) {
      toast.error(err?.message || "Couldn't update this bug.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section aria-label="Bug details" className="space-y-3 border border-primary/20 bg-card p-4" data-testid="bug-group-detail">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={group.status} />
        <span className="text-[10px] uppercase tracking-[0.15em] text-primary/40">{KIND_LABEL[group.kind] || group.kind}</span>
        {group.reopen_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-amber-300">
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reopened {group.reopen_count}×
          </span>
        )}
      </div>
      <h2 className="break-words text-sm text-primary">{group.title}</h2>
      {group.message && group.message !== group.title && (
        <p className="break-words text-xs text-primary/70">{group.message}</p>
      )}
      <div className="space-y-1">
        <Field label="Occurrences">{`${group.total_count} from ${group.user_count} ${group.user_count === 1 ? "user" : "users"}`}</Field>
        <Field label="First seen">{group.first_seen ? new Date(group.first_seen).toLocaleString() : ""}</Field>
        <Field label="Last seen">{group.last_seen ? new Date(group.last_seen).toLocaleString() : ""}</Field>
        <Field label="Last version">{group.app_version}</Field>
        <Field label="Fingerprint">{group.fingerprint}</Field>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.2em] text-primary/40">Note (e.g. PR or cause)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          className="w-full border border-primary/30 bg-black/40 px-2 py-1.5 text-xs text-primary/90 outline-none focus:border-primary/60"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {["triaged", "fixed", "ignored", "new"].map((s) => (
          <button
            key={s}
            type="button"
            disabled={Boolean(busy) || (group.status === s && !note.trim())}
            onClick={() => setStatus(s)}
            className={`border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] disabled:opacity-40 ${STATUS_CLASS[s]}`}
          >
            {busy === s ? "Saving…" : s === "new" ? "Reopen" : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-primary/30">
        Fixed bugs reopen automatically if they happen again.
      </p>

      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {!reports && !error && <p role="status" className="text-[10px] text-primary/40">Loading reports…</p>}
      {reports && (
        <ul className="space-y-2" aria-label="Reports in this bug">
          {reports.map((r) => (
            <ReportDetail key={r.id} report={r} api={api} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Bug Squasher triage (admins). Bugs are grouped by fingerprint across users,
 * newest-first within New → Triaged → Fixed → Ignored.
 *
 * `api` lets tests swap the network layer.
 */
export default function BugSquasher({ api: apiOverride }) {
  const api = apiOverride || bugApi;
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const isAdmin = user?.role === "admin";
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [state, setState] = useState({ loading: true, groups: [], error: "" });
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const groups = await api.listBugGroups({ q: submittedQuery });
      setState({ loading: false, groups, error: "" });
      setSelected((prev) => (prev ? groups.find((g) => g.fingerprint === prev.fingerprint) || null : null));
    } catch (err) {
      setState({ loading: false, groups: [], error: err?.message || "Couldn't load bugs." });
    }
  }, [api, submittedQuery]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  const counts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) out[f.id] = state.groups.filter((g) => matchesFilter(f.id, g)).length;
    return out;
  }, [state.groups]);
  const visible = state.groups.filter((g) => matchesFilter(filter, g));

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-background scanline font-mono">
      <div className="border-b border-primary/20 bg-card/90 backdrop-blur-md px-4 sm:px-6 py-4 flex-shrink-0 relative z-40">
        <div className="max-w-5xl mx-auto flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-primary/40 hover:text-primary transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 sm:w-5 h-4 sm:h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-primary glow-text tracking-[0.2em] uppercase text-lg flex items-center gap-2">
              <Bug className="h-4 w-4" aria-hidden="true" /> // Bug Squasher
            </h1>
            <p className="text-[10px] text-primary/30 tracking-widest uppercase mt-0.5">Triage crashes, failures and reports</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void load()}
              className="text-primary/40 hover:text-primary"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${state.loading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 pb-24 lg:pb-6 min-h-0">
        <div className="max-w-5xl mx-auto space-y-4">
          {isLoadingAuth ? (
            <p role="status" className="text-xs text-primary/40">Loading account access…</p>
          ) : !isAdmin ? (
            <div className="border border-primary/15 bg-card p-5 space-y-3">
              <p className="text-xs text-primary/70">Bug Squasher triage is available to admins.</p>
              <button
                type="button"
                onClick={() => openBugReport()}
                className="border border-primary/40 bg-primary/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-primary"
              >
                Report a bug instead
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter bugs by status">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.id}
                      onClick={() => setFilter(f.id)}
                      className={`whitespace-nowrap px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] border ${
                        filter === f.id ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-primary/40 hover:text-primary/70"
                      }`}
                    >
                      {f.label} <span className="text-primary/30">{counts[f.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
                <form
                  className="flex items-center gap-2 border border-primary/20 px-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSubmittedQuery(query.trim());
                  }}
                >
                  <Search className="h-3.5 w-3.5 text-primary/40" aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search title, message, route"
                    aria-label="Search bugs"
                    className="w-56 bg-transparent py-1.5 text-xs text-primary/90 outline-none"
                  />
                </form>
              </div>

              {state.error && (
                <p role="alert" className="border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">{state.error}</p>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <ul className="space-y-1" aria-label="Bugs">
                  {!state.loading && visible.length === 0 && !state.error && (
                    <li className="border border-primary/10 p-4 text-xs text-primary/40">
                      {filter === "open" ? "No open bugs. Nice work." : "Nothing here."}
                    </li>
                  )}
                  {visible.map((g) => (
                    <li key={g.fingerprint}>
                      <button
                        type="button"
                        onClick={() => setSelected(g)}
                        aria-current={selected?.fingerprint === g.fingerprint ? "true" : undefined}
                        className={`w-full border p-3 text-left transition-colors ${
                          selected?.fingerprint === g.fingerprint ? "border-primary/50 bg-primary/10" : "border-primary/10 bg-card hover:border-primary/30"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            <StatusChip status={g.status} />
                            <span className="truncate text-xs text-primary/90">{g.title}</span>
                          </span>
                          <span className="flex-shrink-0 text-xs text-primary" title="Occurrences">×{g.total_count}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-primary/40">
                          <span>{KIND_LABEL[g.kind] || g.kind}</span>
                          <span>{g.user_count} {g.user_count === 1 ? "user" : "users"}</span>
                          <span>{relativeTime(g.last_seen)}</span>
                          {g.route && <span className="truncate max-w-[12rem]">{g.route}</span>}
                          {g.reopen_count > 0 && <span className="text-amber-300">reopened</span>}
                          {g.has_screenshot && <span>screenshot</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <div>
                  {selected ? (
                    <GroupDetail group={selected} api={api} onChanged={() => void load()} />
                  ) : (
                    <p className="border border-dashed border-primary/15 p-6 text-center text-xs text-primary/30">
                      Pick a bug to see its reports.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
