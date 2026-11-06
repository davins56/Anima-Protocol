import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/react";
import { GitBranch, Loader, Plus, Search, AlertTriangle } from "lucide-react";
import { animaClient } from "@/api/animaClient";
import ScenarioCard from "@/components/scenarios/ScenarioCard";
import ScenarioRemixModal from "@/components/scenarios/ScenarioRemixModal";

/**
 * Scenario Hub — every what-if scenario in one place.
 *
 * Scenarios are `SharedScenario` rows, written by /create-scenario. Before this
 * page the only way to reach them was the creator form itself, and a save
 * redirected to /scenario-hub, which had no route and fell through to the 404.
 *
 * `loadScenarios` is injectable so the page can be rendered without the API.
 */
const FILTERS = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "mine", label: "Mine" },
];

function matchesQuery(scenario, needle) {
  if (!needle) return true;
  const tags = Array.isArray(scenario.tags) ? scenario.tags : [];
  return [scenario.title, scenario.description, scenario.prompt, ...tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export default function ScenarioHub({ loadScenarios }) {
  const navigate = useNavigate();
  const { user } = useUser();
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [remixTarget, setRemixTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await (loadScenarios
        ? loadScenarios()
        : animaClient.entities.SharedScenario.list("-created_date", 200));
      setScenarios(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err?.message || "Could not load scenarios.");
      setScenarios([]);
    } finally {
      setLoading(false);
    }
  }, [loadScenarios]);

  useEffect(() => {
    void load();
  }, [load]);

  // created_by is stored as an email in older rows and an id in newer ones.
  const identity = useMemo(
    () => [user?.id, user?.primaryEmailAddress?.emailAddress].filter(Boolean),
    [user?.id, user?.primaryEmailAddress?.emailAddress],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scenarios.filter((scenario) => {
      if (filter === "published" && scenario.is_published !== true) return false;
      if (filter === "mine" && !identity.includes(scenario.created_by)) return false;
      return matchesQuery(scenario, needle);
    });
  }, [scenarios, query, filter, identity]);

  const openScenario = async (scenario) => {
    try {
      const session = await animaClient.entities.ChatSession.create({
        title: scenario.title,
        mode: "solo",
        character_id: scenario.character_bases?.[0]?.id,
        opening_scene: scenario.prompt,
        world_settings: scenario.world_settings || {},
        scenario_source_id: scenario.id,
        messages: [
          {
            role: "system",
            character_name: "Narrator",
            content: scenario.prompt,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      navigate(`/chat/${session.id}`);
    } catch (err) {
      setError(err?.message || "Could not start that scenario.");
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-sacred text-2xl sm:text-3xl text-primary tracking-wider flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Scenario Hub
          </h1>
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mt-1">
            Every what-if timeline in one place
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/create-scenario")}
          className="inline-flex items-center gap-1.5 min-h-11 px-4 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New scenario
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, premises and tags"
            aria-label="Search scenarios"
            className="w-full min-h-11 pl-9 pr-3 bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/25 font-mono text-xs focus:outline-none focus:border-primary/50 transition-colors"
          />
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Filter scenarios">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={`min-h-11 px-3 border font-mono text-[9px] tracking-widest uppercase transition-all ${
                filter === option.id
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-primary/20 text-primary/50 hover:border-primary/40 hover:text-primary/80"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-red-400/30 bg-red-900/20 p-3">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p role="alert" className="font-mono text-[9px] text-red-400 tracking-widest">
            {error}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-primary/40">
          <Loader className="w-4 h-4 animate-spin" />
          <span className="font-mono text-[9px] tracking-widest uppercase">Loading scenarios</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <GitBranch className="w-9 h-9 text-primary/20" />
          <p className="font-mono text-xs text-primary/40 tracking-widest uppercase">
            {scenarios.length === 0 ? "No what-if scenarios yet" : "Nothing matches that"}
          </p>
          <p className="font-mono text-[9px] text-primary/25 max-w-sm">
            {scenarios.length === 0
              ? "Describe a premise, and the Anima plays out that timeline with you."
              : "Try a different search, or clear the filter."}
          </p>
          {scenarios.length === 0 && (
            <button
              type="button"
              onClick={() => navigate("/create-scenario")}
              className="mt-1 inline-flex items-center gap-1.5 min-h-11 px-4 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Create the first scenario
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">
            {visible.length} scenario{visible.length === 1 ? "" : "s"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                onRemix={setRemixTarget}
                onPlay={openScenario}
              />
            ))}
          </div>
        </>
      )}

      {remixTarget && (
        <ScenarioRemixModal
          scenario={remixTarget}
          onClose={() => setRemixTarget(null)}
          onRemixComplete={(session) => {
            setRemixTarget(null);
            if (session?.id) navigate(`/chat/${session.id}`);
          }}
        />
      )}
    </div>
  );
}
