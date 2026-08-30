import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import AnimaCustomizer from "@/components/anima/AnimaCustomizer";
import AnimaPersonalityPanel from "@/components/anima/AnimaPersonalityPanel";
import AnimaSoulprintPanel from "@/components/anima/AnimaSoulprintPanel";
import AnimaVoicePanel from "@/components/anima/AnimaVoicePanel";
import AnimaExpressionPanel from "@/components/anima/AnimaExpressionPanel";
import DeviceScanPanel from "@/components/anima/DeviceScanPanel";
import {
  ChevronLeft,
  Fingerprint,
  Loader,
  Mic,
  Palette,
  ScanSearch,
  Sparkles,
  Swords,
  UserCircle,
} from "lucide-react";
import { normalizeCustomiseAnimaTab } from "@/lib/customiseAnimaTabs";
import { listPersonalAnimas } from "@/lib/listPersonalAnimas";

const TABS = [
  { id: "look", label: "Look", icon: Palette, blurb: "Portrait, theme & appearance" },
  { id: "personality", label: "Personality", icon: UserCircle, blurb: "Name, traits & voice of mind" },
  { id: "soulprint", label: "Soulprint", icon: Fingerprint, blurb: "Born identity & bond" },
  { id: "expression", label: "Expression", icon: Swords, blurb: "Angelic to Demonic spectrum" },
  { id: "voice", label: "Voice", icon: Mic, blurb: "Spoken presence" },
  { id: "permissions", label: "Permissions", icon: ScanSearch, blurb: "Device scan & data access" },
];

/**
 * Complete Customise Anima hub: Look · Personality · Soulprint · Voice.
 * Deep links: `?anima=<id>&tab=look|personality|soulprint|expression|voice|permissions`
 */
export default function CustomiseAnima() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get("anima");
  const activeTab = normalizeCustomiseAnimaTab(searchParams.get("tab"));

  const [animas, setAnimas] = useState([]);
  const [anima, setAnima] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        await whenBootstrapReady();
        const [me, list] = await Promise.all([
          base44.auth.me().catch(() => null),
          listPersonalAnimas(100),
        ]);
        if (cancelled) return;

        const rows = list || [];
        setAnimas(rows);

        let selected = null;
        if (requestedId) {
          selected = rows.find((a) => a.id === requestedId) || null;
        }
        if (!selected && me?.email) {
          selected = rows.find((a) => a.assigned_user === me.email) || null;
        }
        if (!selected) selected = rows[0] || null;

        setAnima(selected);
        if (!selected) {
          setError("No personal Anima found yet. Forge one first.");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Failed to load your Anima.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [requestedId]);

  const setTab = (tabId) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tabId);
    if (anima?.id) next.set("anima", anima.id);
    setSearchParams(next, { replace: true });
  };

  const selectAnima = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("anima", id);
    next.set("tab", activeTab);
    setSearchParams(next, { replace: true });
  };

  const mergeAnima = (patch) => {
    setAnima((prev) => (prev ? { ...prev, ...patch } : prev));
    setAnimas((prev) =>
      prev.map((row) => (row.id === anima?.id ? { ...row, ...patch } : row)),
    );
  };

  const activeMeta = useMemo(
    () => TABS.find((t) => t.id === activeTab) || TABS[0],
    [activeTab],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 pb-[calc(var(--tab-bar-height,64px)+1.5rem)]">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-primary/40 hover:text-primary transition-colors mt-1"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 space-y-1">
            <h1 className="font-mono text-xl sm:text-2xl text-primary glow-text tracking-[0.2em] uppercase">
              // Customise Anima
            </h1>
            <p className="text-[10px] font-mono text-primary/40 tracking-widest">
              Look · personality · soulprint · expression · voice · permissions — one place to shape your companion
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 border border-primary/10">
            <Loader className="w-6 h-6 text-primary/40 animate-spin" />
            <p className="font-mono text-[10px] tracking-widest text-primary/30 uppercase">
              Loading companion...
            </p>
          </div>
        ) : anima ? (
          <>
            {animas.length > 1 && (
              <div className="border border-primary/15 bg-black/40 p-3 sm:p-4">
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Companion
                </label>
                <div className="flex flex-wrap gap-2">
                  {animas.map((row) => {
                    const selected = row.id === anima.id;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => selectAnima(row.id)}
                        className={`flex items-center gap-2 px-3 py-2 border font-mono text-[10px] tracking-wider transition-all ${
                          selected
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-primary/15 text-primary/45 hover:text-primary/75 hover:border-primary/35"
                        }`}
                      >
                        <span className="w-6 h-6 border border-primary/25 overflow-hidden flex-shrink-0 bg-primary/5">
                          {row.avatar_url ? (
                            <img
                              src={row.avatar_url}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="w-full h-full flex items-center justify-center text-[10px]">
                              {(row.name || "?")[0]}
                            </span>
                          )}
                        </span>
                        <span className="truncate max-w-[9rem]">{row.name || "Anima"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              className="flex overflow-x-auto border border-primary/20 bg-black/50"
              role="tablist"
              aria-label="Customise Anima sections"
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const selected = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(tab.id)}
                    className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase border-b-2 transition-all ${
                      selected
                        ? "text-primary border-primary bg-primary/5"
                        : "text-primary/35 border-transparent hover:text-primary/65"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <p className="font-mono text-[10px] text-primary/35 tracking-widest">
              {anima.name} · {activeMeta.blurb}
            </p>

            {activeTab === "look" && (
              <AnimaCustomizer
                key={`${anima.id}-look`}
                anima={anima}
                variant="page"
                showHeader={false}
                onSave={mergeAnima}
              />
            )}
            {activeTab === "personality" && (
              <AnimaPersonalityPanel
                key={`${anima.id}-personality`}
                anima={anima}
                onSave={mergeAnima}
              />
            )}
            {activeTab === "soulprint" && (
              <AnimaSoulprintPanel key={`${anima.id}-soulprint`} anima={anima} />
            )}
            {activeTab === "expression" && (
              <AnimaExpressionPanel
                key={`${anima.id}-expression`}
                anima={anima}
                onSave={mergeAnima}
              />
            )}
            {activeTab === "voice" && (
              <AnimaVoicePanel
                key={`${anima.id}-voice`}
                anima={anima}
                onSave={mergeAnima}
              />
            )}
            {activeTab === "permissions" && (
              <DeviceScanPanel
                key={`${anima.id}-permissions`}
                anima={anima}
                onPermissionChange={(granted) =>
                  mergeAnima({
                    device_scan_granted: granted,
                    device_scan_granted_at: granted ? new Date().toISOString() : null,
                  })
                }
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-4 border border-primary/15 bg-primary/5 px-6 text-center">
            <Sparkles className="w-8 h-8 text-primary/40" />
            <p className="font-mono text-sm text-primary/70 tracking-wider">
              {error || "No personal Anima found yet."}
            </p>
            <p className="font-mono text-[10px] text-primary/40 tracking-widest max-w-md leading-relaxed">
              {/misconfigured|environment variables|not signed in|session/i.test(
                error,
              )
                ? "The companion store could not load. Sign in again if your session expired, then retry. If this persists, the API still cannot reach Clerk or the database."
                : "Forge your companion first, then return here to shape their look (skin, hair, outfit, eyes), personality, soulprint, expression, voice, and permissions."}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              {error && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-5 py-3 bg-transparent border border-primary/25 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate("/onboarding")}
                className="px-5 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner"
              >
                Forge Anima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
