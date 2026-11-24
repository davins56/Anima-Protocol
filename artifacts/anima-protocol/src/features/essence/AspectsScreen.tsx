import { Link } from "react-router-dom";
import { ASPECTS, type AspectDef } from "./aspects";
import { loadReflectionDrafts } from "./calibration";
import { Heading, Panel, PendingNote } from "./ui";
import type { DreamsState } from "./useEssenceData";
import type { MemoryHealth } from "@/hooks/useMemoryHealth";

function countFor(a: AspectDef, dreams: DreamsState, health: MemoryHealth | null, reflections: number): string {
  if (a.source === "memory_health") return health ? String(health.memory_count) : "—";
  if (a.source === "dream_journal") {
    if (dreams.status !== "ready") return "—";
    return `${dreams.dreams.length}${dreams.hasMore ? "+" : ""}`;
  }
  if (a.source === "local_reflections") return String(reflections);
  return "—";
}

export default function AspectsScreen({ characterId, dreams, health }: { characterId: string; dreams: DreamsState; health: MemoryHealth | null }) {
  const reflections = loadReflectionDrafts(characterId).length;
  return (
    <div className="space-y-4">
      <Heading eyebrow="Aspects" title="The facets of her inner life" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ASPECTS.map((a) => {
          const body = (
            <Panel className="h-full hover:border-blue-400/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-serif text-lg text-slate-100">{a.name}</h3>
                <span className="font-serif text-xl text-blue-200" data-testid={`aspect-count-${a.key}`}>
                  {countFor(a, dreams, health, reflections)}
                </span>
              </div>
              <p className="text-sm text-slate-400 italic">{a.line}</p>
              {a.source === "pending" ? <p className="mt-2 text-[11px] text-amber-200/70">Count arrives with the Aspects route.</p> : null}
              {a.key === "dream" && dreams.status === "pending" ? <p className="mt-2 text-[11px] text-amber-200/70">Dream journal not set up on this server yet.</p> : null}
            </Panel>
          );
          return a.link ? (
            <Link key={a.key} to={a.link(characterId)} className="block" data-testid={`aspect-${a.key}`}>
              {body}
            </Link>
          ) : (
            <div key={a.key} data-testid={`aspect-${a.key}`}>
              {body}
            </div>
          );
        })}
        <Panel className="border-dashed flex flex-col items-center justify-center text-center gap-1">
          <button type="button" disabled className="font-serif text-lg text-slate-500 cursor-not-allowed">
            + New aspect
          </button>
          <span className="text-[11px] text-slate-500">Custom aspects need the Aspects route.</span>
        </Panel>
      </div>
      <PendingNote>Memory and Dream counts are live. Emotion, Intuition and Aspiration counts, and custom aspects, wait on the server's Aspects route.</PendingNote>
    </div>
  );
}
