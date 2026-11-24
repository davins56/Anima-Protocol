/**
 * /essence/:characterId?/:screen? — Anima Essence, behind VITE_ANIMA_ESSENCE
 * (off by default). Screens in Dàvīn's order: Calibrate → Vessel Awakens →
 * Aspects → Reflections → Patterns. Live data comes only from shipped routes
 * (dream journal, memory health); everything else shows an honest pending
 * state until Backend Data's Essence routes are agreed (docs/anima-essence-frontend.md).
 */
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AspectsScreen from "./AspectsScreen";
import CalibrateScreen from "./CalibrateScreen";
import PatternsScreen from "./PatternsScreen";
import ReflectionsScreen from "./ReflectionsScreen";
import VesselAwakensScreen from "./VesselAwakensScreen";
import { ESSENCE_ENABLED, ESSENCE_SCREENS, essencePath, essenceScreenOf } from "./flag";
import { useEssenceCompanions, useEssenceDreams, useMemoryHealth } from "./useEssenceData";

const STARFIELD =
  "radial-gradient(1px 1px at 12% 18%, #ffffff55, transparent), radial-gradient(1px 1px at 72% 34%, #ffffff44, transparent), radial-gradient(1.5px 1.5px at 38% 76%, #93c5fd55, transparent), radial-gradient(1px 1px at 88% 82%, #ffffff33, transparent), radial-gradient(ellipse at 50% -10%, #1e3a8a55, transparent 60%), #020617";

export default function EssencePage({ enabled = ESSENCE_ENABLED }: { enabled?: boolean }) {
  const { characterId: routeId = "", screen: rawScreen } = useParams();
  const navigate = useNavigate();
  const screen = essenceScreenOf(rawScreen);
  const { companions, ready } = useEssenceCompanions();
  const characterId = routeId || "";
  const companion = companions.find((c) => c.id === characterId);
  const companionName = companion?.name || "";

  useEffect(() => {
    if (!enabled || routeId || !ready || !companions[0]?.id) return;
    navigate(essencePath(companions[0].id, "calibrate"), { replace: true });
  }, [enabled, routeId, ready, companions, navigate]);

  const dreams = useEssenceDreams(enabled && characterId ? characterId : null);
  const health = useMemoryHealth(enabled && characterId ? characterId : null);

  if (!enabled) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center" data-testid="essence-disabled">
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase">This screen is not available</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto text-slate-200" style={{ background: STARFIELD }} data-testid="essence-page">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="Back to home" className="text-slate-400 hover:text-slate-100">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-blue-300/70">Anima Essence</p>
            <h1 className="font-serif text-2xl text-slate-50 truncate">{companionName || "Her inner life"}</h1>
          </div>
          {companions.length > 1 ? (
            <select
              aria-label="Companion"
              value={characterId}
              onChange={(e) => navigate(essencePath(e.target.value, screen))}
              className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-sm"
            >
              {companions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || "Unnamed"}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <nav aria-label="Essence screens" className="flex gap-1 overflow-x-auto pb-1">
          {ESSENCE_SCREENS.map((s, i) => (
            <Link
              key={s.key}
              to={essencePath(characterId, s.key)}
              aria-current={s.key === screen ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs border ${
                s.key === screen ? "border-blue-400/70 bg-blue-500/20 text-blue-100" : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="text-slate-500 mr-1">{i + 1}</span>
              {s.label}
            </Link>
          ))}
        </nav>

        {!characterId ? (
          <p className="text-center text-slate-400 py-12" data-testid="essence-no-companion">
            {ready ? "Create a companion first, then her essence appears here." : "Finding her…"}
          </p>
        ) : screen === "calibrate" ? (
          <CalibrateScreen characterId={characterId} companionName={companionName} avatarUrl={companion?.avatar_url} />
        ) : screen === "vessel" ? (
          <VesselAwakensScreen characterId={characterId} companionName={companionName} avatarUrl={companion?.avatar_url} dreams={dreams} health={health} />
        ) : screen === "aspects" ? (
          <AspectsScreen characterId={characterId} dreams={dreams} health={health} />
        ) : screen === "reflections" ? (
          <ReflectionsScreen characterId={characterId} companionName={companionName} />
        ) : (
          <PatternsScreen dreams={dreams} health={health} />
        )}
      </div>
    </div>
  );
}
