/**
 * Settings > Day Rhythm > Calendar awareness. Minimal, functional UI; visual
 * polish is Builder's. Busy/free only, never event titles.
 */
import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  CALENDAR_PROVIDER_LABELS,
  calendarOutcomeMessage,
  disconnectCalendarProvider,
  loadCalendarStatus,
  startCalendarConnect,
  type CalendarProvider,
  type CalendarStatus,
} from "@/lib/calendarAwareness";

const PROVIDERS: CalendarProvider[] = ["google", "microsoft"];

function readOutcome(): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("calendar");
  } catch {
    return null;
  }
}

export default function CalendarAwarenessSection({
  refreshKey = 0,
  navigate = (url: string) => globalThis.location.assign(url),
}: {
  refreshKey?: number;
  navigate?: (url: string) => void;
}) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<CalendarProvider | null>(null);
  const [outcome] = useState(() => calendarOutcomeMessage(readOutcome()));

  const reload = async () => {
    const res = await loadCalendarStatus();
    if ("status" in res) setStatus(res.status);
    else setError(res.message);
  };

  useEffect(() => {
    void reload();
  }, [refreshKey]);

  const connect = async (provider: CalendarProvider) => {
    setBusy(provider);
    setError("");
    const res = await startCalendarConnect(provider);
    if ("url" in res) {
      navigate(res.url);
      return;
    }
    setBusy(null);
    setError(res.message);
  };

  const disconnect = async (provider: CalendarProvider) => {
    setBusy(provider);
    setError("");
    const res = await disconnectCalendarProvider(provider);
    setBusy(null);
    if (!res.ok) setError("Could not disconnect your calendar. Please try again.");
    await reload();
  };

  return (
    <div className="space-y-2 border-t border-primary/10 pt-4" data-testid="calendar-awareness">
      <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
        <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
        Calendar awareness
      </p>
      <p className="text-[9px] font-mono text-primary/35 leading-relaxed max-w-md">
        Connect a calendar so she holds off while you are busy. Only busy and
        free times are read — never event titles. The latest set is kept for
        6 hours at most. Disconnect any time.
      </p>
      <div aria-live="polite" className="space-y-1">
        {outcome && (
          <p
            className={`text-[9px] font-mono leading-relaxed ${
              outcome.tone === "ok" ? "text-primary/60" : "text-destructive/80"
            }`}
          >
            {outcome.text}
          </p>
        )}
        {error && <p className="text-[9px] font-mono text-destructive/80 leading-relaxed">{error}</p>}
        {status && !status.enabled && (
          <p className="text-[9px] font-mono text-amber-400/80 leading-relaxed">
            Day rhythm is turned off on the server.
          </p>
        )}
      </div>
      {status &&
        PROVIDERS.map((provider) => {
          const conn = status.connections.find((c) => c.provider === provider);
          const configured = status.providers[provider];
          const label = CALENDAR_PROVIDER_LABELS[provider];
          return (
            <div key={provider} className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] text-primary/70">{label}</p>
                <p className="text-[9px] font-mono text-primary/35">
                  {conn
                    ? conn.status === "reauth_required"
                      ? "Sign-in expired. Connect again."
                      : conn.lastSyncedAt
                        ? `Connected. Last read ${new Date(conn.lastSyncedAt).toLocaleTimeString()}.`
                        : "Connected."
                    : configured
                      ? "Not connected."
                      : "Not set up on the server yet."}
                </p>
              </div>
              {conn ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void disconnect(provider)}
                  className="min-h-[44px] px-3 border border-primary/20 text-primary/70 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
                >
                  {busy === provider ? "Disconnecting…" : "Disconnect"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || !configured || !status.enabled}
                  onClick={() => void connect(provider)}
                  className="min-h-[44px] px-3 border border-primary/30 text-primary/80 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
                >
                  {busy === provider ? "Opening…" : "Connect"}
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}
