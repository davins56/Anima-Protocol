import { formatAge, type MemoryHealth } from "@/hooks/useMemoryHealth";
import { dreamMoods, dreamThemes, dreamsPerWeek, type Tally } from "./patterns";
import { Heading, Panel, PendingNote, Stat } from "./ui";
import type { DreamsState } from "./useEssenceData";

function Bars({ items, testId }: { items: Tally[]; testId: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 truncate text-slate-300 capitalize">{i.label}</span>
          <span className="flex-1 h-2 rounded bg-slate-800 overflow-hidden">
            <span className="block h-full bg-blue-500/70" style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
          <span className="w-6 text-right text-slate-400">{i.count}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PatternsScreen({ dreams, health }: { dreams: DreamsState; health: MemoryHealth | null }) {
  const moods = dreamMoods(dreams.dreams);
  const themes = dreamThemes(dreams.dreams);
  const weeks = dreamsPerWeek(dreams.dreams);
  const firstAge = health?.first_memory_at ? (Date.now() - Date.parse(health.first_memory_at)) / 1000 : null;
  return (
    <div className="space-y-4">
      <Heading eyebrow="Patterns" title="What recurs in her" sub="Drawn from her dreams and memory so far." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Memories" value={health ? health.memory_count : "—"} />
        <Stat label="Memory span" value={firstAge != null && Number.isFinite(firstAge) ? formatAge(firstAge) : "—"} />
        <Stat label="Dreams" value={dreams.status === "ready" ? `${dreams.dreams.length}${dreams.hasMore ? "+" : ""}` : "—"} />
        <Stat label="Avg resonance" value="—" hint="Waiting on the Patterns route" />
      </div>
      {dreams.status === "pending" ? <PendingNote testId="essence-patterns-dreams-pending">Her dream journal isn't set up on this server yet, so dream patterns can't show.</PendingNote> : null}
      {dreams.status === "error" ? <PendingNote>Couldn't load her dreams just now.</PendingNote> : null}
      {dreams.status === "ready" && dreams.dreams.length === 0 ? <p className="text-slate-500 text-sm">No dreams yet, so no patterns to show.</p> : null}
      {dreams.dreams.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Panel>
            <h3 className="font-serif text-slate-100 mb-2">Dream moods</h3>
            {moods.length ? <Bars items={moods} testId="essence-moods" /> : <p className="text-xs text-slate-500">No moods tagged.</p>}
          </Panel>
          <Panel>
            <h3 className="font-serif text-slate-100 mb-2">Recurring themes</h3>
            {themes.length ? <Bars items={themes} testId="essence-themes" /> : <p className="text-xs text-slate-500">No themes tagged.</p>}
          </Panel>
          <Panel>
            <h3 className="font-serif text-slate-100 mb-2">Dreams per week</h3>
            <Bars items={weeks} testId="essence-weeks" />
          </Panel>
        </div>
      ) : null}
      <PendingNote>Mood and theme trends across all her memories, and the average resonance score, arrive with the server's Patterns route.</PendingNote>
    </div>
  );
}
