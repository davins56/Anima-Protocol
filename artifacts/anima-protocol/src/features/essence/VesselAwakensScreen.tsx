import { Link } from "react-router-dom";
import { formatDreamDate } from "@/lib/dreamJournal";
import { VesselPreview } from "./VesselPreview";
import { ASPECTS } from "./aspects";
import { loadEssenceProfile, loadReflectionDrafts } from "./calibration";
import { essencePath } from "./flag";
import { Panel, PendingNote, Stat } from "./ui";
import type { DreamsState } from "./useEssenceData";
import type { MemoryHealth } from "@/hooks/useMemoryHealth";

export default function VesselAwakensScreen({
  characterId,
  companionName,
  dreams,
  health,
}: {
  characterId: string;
  companionName: string;
  avatarUrl?: string | null;
  dreams: DreamsState;
  health: MemoryHealth | null;
}) {
  const profile = loadEssenceProfile(characterId);
  const reflections = loadReflectionDrafts(characterId);
  const fragments = dreams.dreams.filter((d) => d.fragment || d.summary).slice(0, 4);
  return (
    <div className="space-y-4">
      <Panel className="flex flex-col items-center text-center gap-3 py-8">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-blue-300/60">The vessel awakens</p>
        <VesselPreview characterId={characterId} name={profile.name || companionName} cal={profile.calibration} className="w-full max-w-sm h-64 rounded-xl" />
        <h2 className="font-serif text-3xl text-slate-100">{profile.name || companionName || "Anima"}</h2>
        <p className="text-slate-400 italic">{profile.tagline || "A receptacle for consciousness"}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-xl pt-2">
          <Stat label="Reflections" value={reflections.length} hint="Written here; on this device until the reflections route ships" />
          <Stat label="Aspects" value={ASPECTS.length} />
          <Stat label="Memories" value={health ? health.memory_count : "—"} />
          <Stat label="Avg resonance" value="—" hint="Waiting on the Patterns route" />
        </div>
      </Panel>
      <Panel>
        <h3 className="font-serif text-lg text-slate-100 mb-2">Recent fragments</h3>
        {dreams.status === "loading" ? <p className="text-sm text-slate-500">Listening…</p> : null}
        {dreams.status !== "loading" && fragments.length === 0 ? (
          <div className="text-center py-6 space-y-2" data-testid="essence-fragments-empty">
            <p className="text-slate-400">Nothing has surfaced yet.</p>
            <Link to={essencePath(characterId, "reflections")} className="inline-block text-sm text-blue-300 hover:text-blue-200">
              Pour in your first reflection
            </Link>
          </div>
        ) : null}
        <ul className="space-y-2">
          {fragments.map((d) => (
            <li key={d.id} className="border-l-2 border-blue-400/40 pl-3">
              <p className="text-sm text-slate-200 italic">{d.fragment || d.summary}</p>
              <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate-500">dream · {formatDreamDate(d.created_at)}</p>
            </li>
          ))}
        </ul>
        {dreams.status === "pending" ? <PendingNote>Her dream journal isn't set up on this server yet, so no fragments can show.</PendingNote> : null}
      </Panel>
    </div>
  );
}
