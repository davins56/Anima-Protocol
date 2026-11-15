import { useState } from "react";
import { Check, ExternalLink, Sparkles, X } from "lucide-react";
import {
  cancelProtocolUpgrade,
  confirmProtocolUpgrade,
  protocolUpgradeErrorMessage,
} from "@/lib/serenityProtocolUpgrade";

function expired(expiresAt) {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

/**
 * Confirm card for a Serenity Protocol weave requested from chat. The server
 * only records the request; the Cursor agent starts when the steward presses
 * Confirm weave here (security audit 2026-11-14 M3).
 */
export default function ProtocolUpgradeConfirmCard({ payload, surface = "chat" }) {
  const [state, setState] = useState(payload || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!state?.id) return null;
  const pending = state.status === "awaiting_confirmation" && !expired(state.expires_at);
  const scopeLabel = state.scope === "system" ? "System" : "Interface";

  const act = async (kind) => {
    setBusy(true);
    setError("");
    try {
      const result =
        kind === "confirm"
          ? await confirmProtocolUpgrade(state.id, { surface })
          : await cancelProtocolUpgrade(state.id);
      setState((prev) => ({ ...prev, ...result }));
    } catch (err) {
      const latest = err?.payload?.upgrade;
      if (latest?.id) {
        // Already confirmed or cancelled elsewhere (another tab, the console).
        setState((prev) => ({ ...prev, ...latest }));
      } else {
        setError(protocolUpgradeErrorMessage(err));
        if (err?.code === "confirmation_expired") {
          setState((prev) => ({ ...prev, status: "cancelled" }));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="protocol-upgrade-confirm-card"
      className="mt-2 border border-cyan-400/25 bg-black/50 p-3 text-xs text-cyan-100/80"
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-200/70">
        Protocol weave · {scopeLabel}
      </div>
      {state.request && (
        <p className="mt-1 leading-relaxed text-primary/60">{state.request}</p>
      )}
      {pending ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => act("confirm")}
            className="inline-flex items-center gap-1 border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {busy ? "Working" : "Confirm weave"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act("cancel")}
            className="inline-flex items-center gap-1 border border-primary/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-primary/60 hover:text-primary disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-200/70">
          {state.status === "awaiting_confirmation" || state.status === "cancelled" ? (
            <span>Not started</span>
          ) : state.status === "error" ? (
            <span>Current snagged</span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Weaving
            </span>
          )}
          {state.agent_url && (
            <a
              href={state.agent_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-cyan-300/80 hover:text-cyan-200"
            >
              Agent <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
      {error && <p className="mt-2 leading-relaxed text-red-300/80">{error}</p>}
    </div>
  );
}
