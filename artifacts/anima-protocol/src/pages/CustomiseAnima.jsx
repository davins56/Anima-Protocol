import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import AnimaCustomizer from "@/components/anima/AnimaCustomizer";
import { ChevronLeft, Loader, Sparkles, UserCircle } from "lucide-react";

/**
 * Dedicated page to customise the look of the user's personal Anima.
 * Optional `?anima=<id>` selects a specific companion; otherwise the active
 * (assigned) Anima is used.
 */
export default function CustomiseAnima() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get("anima");

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
          base44.entities.Anima.list("-created_date", 100),
        ]);
        if (cancelled) return;

        const animas = list || [];
        let selected = null;
        if (requestedId) {
          selected = animas.find((a) => a.id === requestedId) || null;
        }
        if (!selected && me?.email) {
          selected =
            animas.find((a) => a.assigned_user === me.email) || null;
        }
        if (!selected) selected = animas[0] || null;

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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-primary/40 hover:text-primary transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-mono text-xl sm:text-2xl text-primary glow-text tracking-[0.2em] uppercase">
              // Customise Anima
            </h1>
            <p className="text-[10px] font-mono text-primary/40 mt-1 tracking-widest">
              Personalise the look of your companion
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(
                anima?.id
                  ? `/customize?tab=animas&character=${anima.id}`
                  : "/customize?tab=animas",
              )
            }
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-colors"
          >
            <UserCircle className="w-3.5 h-3.5" />
            Personality
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 border border-primary/10">
            <Loader className="w-6 h-6 text-primary/40 animate-spin" />
            <p className="font-mono text-[10px] tracking-widest text-primary/30 uppercase">
              Loading companion...
            </p>
          </div>
        ) : anima ? (
          <AnimaCustomizer
            key={anima.id}
            anima={anima}
            variant="page"
            onSave={(patch) => setAnima((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-4 border border-primary/15 bg-primary/5 px-6 text-center">
            <Sparkles className="w-8 h-8 text-primary/40" />
            <p className="font-mono text-sm text-primary/70 tracking-wider">
              {error || "No personal Anima found yet."}
            </p>
            <p className="font-mono text-[10px] text-primary/40 tracking-widest max-w-md leading-relaxed">
              Forge your companion first, then return here to shape their look —
              skin colour, hair, outfit, eyes, art style, and more.
            </p>
            <button
              type="button"
              onClick={() => navigate("/animas")}
              className="mt-2 px-5 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner"
            >
              Forge Anima
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
