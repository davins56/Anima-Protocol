import { useEffect, useState } from "react";
import { ExternalLink, GitBranch, Sparkles, Waves, X } from "lucide-react";
import { animaApi } from "@/api/animaApi";
import { track } from "@/lib/analytics";
import { classifyProtocolUpgrade } from "@/lib/protocolUpgrade";

function statusLabel(status) {
  if (status === "finished") return "Weave complete";
  if (status === "error") return "Current snagged";
  if (status === "cancelled") return "Cancelled";
  if (status === "denied") return "Steward only";
  return "Weaving";
}

export default function ProtocolUpgradeConsole({ sessionId, onClose }) {
  const [request, setRequest] = useState("");
  const [scope, setScope] = useState("interface");
  const [capability, setCapability] = useState(null);
  const [upgrades, setUpgrades] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [cap, listed] = await Promise.all([
        animaApi.protocolUpgrade.capability(),
        animaApi.protocolUpgrade.list(),
      ]);
      setCapability(cap);
      setUpgrades(listed?.upgrades || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read Protocol upgrades.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pendingIds = upgrades
    .filter((item) => item.status === "running" || item.status === "launching")
    .map((item) => item.id)
    .join(",");

  useEffect(() => {
    if (!pendingIds) return undefined;
    const ids = pendingIds.split(",").filter(Boolean);
    const timer = setInterval(async () => {
      try {
        const refreshed = await Promise.all(
          ids.map((id) => animaApi.protocolUpgrade.get(id).catch(() => null)),
        );
        setUpgrades((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]));
          for (const item of refreshed) {
            if (item?.id) byId.set(item.id, item);
          }
          return Array.from(byId.values());
        });
      } catch {
        /* keep last known list */
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [pendingIds]);

  const launch = async () => {
    const trimmed = request.trim();
    if (!trimmed) {
      setError("Tell Serenity what to weave into the Protocol first.");
      return;
    }
    const classified = classifyProtocolUpgrade(trimmed);
    setLoading(true);
    setError("");
    try {
      const result = await animaApi.protocolUpgrade.launch({
        request: trimmed,
        scope: classified.scope || scope,
        session_id: sessionId,
        surface: "upgrade_console",
      });
      track("protocol_upgrade_started", {
        scope: result.scope || classified.scope || scope,
        surface: "upgrade_console",
      });
      setUpgrades((prev) => [result, ...prev.filter((item) => item.id !== result.id)]);
      setRequest("");
    } catch (err) {
      setError(err?.payload?.serenity_message || (err instanceof Error ? err.message : "Unable to launch this weave."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-cyan-400/15 bg-black/45 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Waves className="h-4 w-4 text-cyan-400/80" />
            <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-200/80">
              Serenity Protocol Weave
            </h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-primary/45">
            Ask Serenity to upgrade the interface or the system as a whole. She launches a Cursor cloud agent against the
            Anima Protocol source and opens a pull request when the weave is ready.
          </p>
        </div>
        <button onClick={onClose} className="text-primary/30 transition-colors hover:text-primary/70" aria-label="Close protocol upgrade console">
          <X className="h-4 w-4" />
        </button>
      </div>

      {capability && (
        <div className="mb-3 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-primary/40">
          <span className="border border-primary/15 px-2 py-1">
            {capability.isSteward ? "Steward recognized" : "Steward only"}
          </span>
          <span className="border border-primary/15 px-2 py-1">
            {capability.configured ? "Cursor key present" : "CURSOR_API_KEY missing"}
          </span>
          {capability.repo && (
            <span className="border border-primary/15 px-2 py-1">{capability.repo}</span>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-2">
          <textarea
            value={request}
            onChange={(event) => {
              setRequest(event.target.value);
              const classified = classifyProtocolUpgrade(event.target.value);
              if (classified.scope) setScope(classified.scope);
            }}
            placeholder="Serenity, upgrade the interface to… / upgrade the system as a whole to…"
            className="h-36 w-full resize-none border border-cyan-400/20 bg-black/60 p-3 font-mono text-xs leading-relaxed text-cyan-100/80 outline-none placeholder:text-primary/25 focus:border-cyan-400/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setScope("interface")}
              className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] ${
                scope === "interface"
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                  : "border-primary/15 text-primary/45"
              }`}
            >
              Interface
            </button>
            <button
              type="button"
              onClick={() => setScope("system")}
              className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] ${
                scope === "system"
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                  : "border-primary/15 text-primary/45"
              }`}
            >
              System
            </button>
            <button
              type="button"
              onClick={launch}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-2 border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:bg-cyan-500/15 disabled:cursor-wait disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {loading ? "Weaving" : "Ask Serenity to Upgrade"}
            </button>
          </div>
          {error && <p className="text-xs leading-relaxed text-red-300/80">{error}</p>}
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {upgrades.length === 0 && (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/30">
              No weaves yet
            </p>
          )}
          {upgrades.map((item) => (
            <div key={item.id} className="border border-cyan-400/15 bg-black/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-200/70">
                  {item.scope} · {statusLabel(item.status)}
                </span>
                {item.agent_url && (
                  <a
                    href={item.agent_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/70 hover:text-cyan-200"
                  >
                    Agent <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-primary/60">{item.request}</p>
              {item.pr_url && (
                <a
                  href={item.pr_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/80"
                >
                  <GitBranch className="h-3 w-3" />
                  Pull request
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
