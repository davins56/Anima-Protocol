/** HUD pieces for the exploration loop: region chip, location explainer, action bar, inspect card, log, speech bubble. */
import { useState } from "react";
import { ACTIONS, type ActionId, actionAvailability } from "./actions";
import { BIOMES } from "./biomes";
import { LOOT, LOOT_BY_ID, RARITY } from "./loot";
import type { Progress } from "./progress";
import type { RegionContext } from "./region";
import type { RegionStatus } from "./useRegionContext";

const TOD_GLYPH = { dawn: "◒", day: "☀", dusk: "◓", night: "☾" } as const;
const WEATHER_LABEL = { clear: "Clear", cloudy: "Cloudy", fog: "Fog", rain: "Rain", snow: "Snow", storm: "Storm", unknown: "" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function RegionChip({ region, status, onClick, className = "" }: { region: RegionContext; status: RegionStatus; onClick: () => void; className?: string }) {
  const b = BIOMES[region.biome];
  const bits = [cap(region.timeOfDay), WEATHER_LABEL[region.weather], cap(region.season)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pointer-events-auto border bg-black/70 px-2 py-1 text-left font-mono text-[10px] uppercase tracking-widest backdrop-blur-sm ${className}`}
      style={{ borderColor: `${b.accent}88`, color: b.accent }}
      aria-label="Region and location settings"
    >
      <span className="block">
        {b.glyph} {b.label} {TOD_GLYPH[region.timeOfDay]}
      </span>
      <span className="block text-[9px] text-muted-foreground normal-case tracking-normal">
        {bits} · {status === "geo" ? "approx. location" : status === "locating" ? "locating…" : status === "denied" ? "location off · timezone" : `timezone (${region.label})`}
      </span>
    </button>
  );
}

export function LocationExplainer({ open, status, onGeo, onTimezone, onClose }: { open: boolean; status: RegionStatus; onGeo: () => void; onTimezone: () => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Use your real-world area?">
      <div className="w-full max-w-sm space-y-3 border border-cyan-300/50 bg-black/90 p-4 font-mono text-cyan-100 shadow-[0_0_24px_#00eaff33]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-300">Real-world sync</p>
        <p className="text-sm">Let where you are shape what you find in the Cyberworld.</p>
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
          <li>We ask your browser for an <b className="text-cyan-100">approximate</b> location and snap it to a ~50 km area right away.</li>
          <li>Only a region type (e.g. “Coastal”) and an anonymous area id are saved on this device — never your coordinates.</li>
          <li>Weather comes from Open-Meteo using that rounded area. Nothing else leaves your device.</li>
          <li>Prefer not to? Your timezone and local time still shape the world.</li>
        </ul>
        {status === "denied" && <p className="text-[11px] text-amber-300">Location is blocked in your browser — using your timezone instead.</p>}
        {status === "unsupported" && <p className="text-[11px] text-amber-300">This browser can’t share location — using your timezone instead.</p>}
        <div className="grid gap-2">
          <button type="button" onClick={onGeo} className="min-h-[44px] border border-cyan-300 text-[11px] uppercase tracking-widest text-cyan-200">
            Use approximate location
          </button>
          <button type="button" onClick={onTimezone} className="min-h-[44px] border border-border text-[11px] uppercase tracking-widest">
            Timezone only
          </button>
          <button type="button" onClick={onClose} className="min-h-[36px] text-[10px] uppercase tracking-widest text-muted-foreground">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActionBar({
  availability,
  onAction,
  accompanying,
  className = "",
}: {
  availability: ReturnType<typeof actionAvailability>;
  onAction: (id: ActionId) => void;
  accompanying: boolean;
  className?: string;
}) {
  return (
    <div className={`pointer-events-auto grid grid-cols-3 gap-1 sm:flex sm:gap-1.5 ${className}`} role="toolbar" aria-label="Explore actions">
      {ACTIONS.map((a) => {
        const av = availability[a.id];
        const active = a.id === "accompany" && accompanying;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onAction(a.id)}
            disabled={!av.enabled}
            title={`${a.label} (${a.key}) — ${av.enabled ? a.hint : av.reason}`}
            aria-keyshortcuts={a.key}
            className={`relative flex h-11 w-11 flex-col items-center justify-center border bg-black/70 font-mono backdrop-blur-sm transition-colors disabled:opacity-35 sm:h-12 sm:w-[4.25rem] ${
              active ? "border-pink-300 text-pink-200" : "border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/10"
            }`}
          >
            <span className="text-base leading-none">{a.glyph}</span>
            <span className="mt-0.5 text-[8px] uppercase tracking-wider sm:text-[9px]">{a.id === "accompany" && accompanying ? "Dismiss" : a.label}</span>
            <span className="absolute right-0.5 top-0.5 hidden text-[8px] text-muted-foreground sm:block">{a.key}</span>
          </button>
        );
      })}
    </div>
  );
}

export function InspectCard({ lootId, progress, onClose, className = "" }: { lootId: string | null; progress: Progress; onClose: () => void; className?: string }) {
  const def = lootId ? LOOT_BY_ID[lootId] : null;
  if (!def) return null;
  const r = RARITY[def.rarity];
  const conds = [def.time?.join("/"), def.weather?.join("/"), def.season?.join("/")].filter(Boolean).join(" · ");
  return (
    <div className={`pointer-events-auto border bg-black/85 p-3 font-mono backdrop-blur-sm ${className}`} style={{ borderColor: r.color }} role="dialog" aria-label={`Inspect ${def.name}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] uppercase tracking-[0.3em]" style={{ color: r.color }}>
            {r.label} {def.kind}
          </p>
          <p className="text-sm tracking-wide text-cyan-50">{def.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-muted-foreground">
          ✕
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{def.lore}</p>
      <p className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
        {def.biomes === "any" ? "Found anywhere" : def.biomes.map((b) => BIOMES[b].label).join(", ")}
        {conds ? ` · only ${conds}` : ""} · owned {progress.inventory[def.id] ?? 0}
      </p>
    </div>
  );
}

export function LogPanel({ open, progress, region, onClose, onInspect }: { open: boolean; progress: Progress; region: RegionContext; onClose: () => void; onInspect: (id: string) => void }) {
  const [tab, setTab] = useState<"inventory" | "codex" | "regions">("inventory");
  if (!open) return null;
  const owned = LOOT.filter((d) => (progress.inventory[d.id] ?? 0) > 0);
  const found = Object.keys(progress.codexItems).length;
  const regions = Object.values(progress.regions).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Explorer log">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col border border-cyan-300/50 bg-black/90 font-mono text-cyan-100">
        <div className="flex items-center gap-1 border-b border-cyan-300/30 p-2 text-[10px] uppercase tracking-widest">
          {(["inventory", "codex", "regions"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-2 py-1 ${tab === t ? "bg-cyan-400/15 text-cyan-200" : "text-muted-foreground"}`}>
              {t}
            </button>
          ))}
          <button type="button" onClick={onClose} className="ml-auto px-2 py-1 text-muted-foreground" aria-label="Close log">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-2 text-[11px]">
          {tab === "inventory" &&
            (owned.length ? (
              <ul className="grid grid-cols-2 gap-1.5">
                {owned.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => onInspect(d.id)} className="w-full border p-1.5 text-left" style={{ borderColor: `${RARITY[d.rarity].color}88` }}>
                      <span style={{ color: RARITY[d.rarity].color }}>{d.name}</span>
                      <span className="float-right text-muted-foreground">×{progress.inventory[d.id]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-2 text-muted-foreground">Nothing yet. Press Scan (Q) to reveal nodes, walk onto one and Hack it (E).</p>
            ))}
          {tab === "codex" && (
            <>
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                {found} / {LOOT.length} discovered
              </p>
              <ul className="space-y-1">
                {LOOT.map((d) => {
                  const known = !!progress.codexItems[d.id];
                  return (
                    <li key={d.id} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0" style={{ background: known ? RARITY[d.rarity].color : "#334155" }} />
                      {known ? (
                        <button type="button" onClick={() => onInspect(d.id)} className="truncate text-left">
                          {d.name}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">??? · {d.biomes === "any" ? "anywhere" : d.biomes.map((b) => BIOMES[b].label).join(", ")}</span>
                      )}
                      <span className="ml-auto text-[9px] uppercase text-muted-foreground">{RARITY[d.rarity].label}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {tab === "regions" && (
            <ul className="space-y-1.5">
              {regions.map((r) => (
                <li key={r.key} className="border border-cyan-300/20 p-1.5">
                  <span style={{ color: BIOMES[r.biome]?.accent }}>
                    {BIOMES[r.biome]?.glyph} {BIOMES[r.biome]?.label ?? r.biome}
                  </span>
                  <span className="float-right text-muted-foreground">{r.key === region.key ? "here now" : `${r.days} day${r.days === 1 ? "" : "s"}`}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {r.label} · first {r.firstSeen}
                  </span>
                </li>
              ))}
              {!regions.length && <p className="p-2 text-muted-foreground">No regions logged yet.</p>}
              <p className="pt-1 text-[10px] text-muted-foreground">{BIOMES[region.biome].blurb}</p>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function SpeechBubble({ text, speaker, color, className = "" }: { text: string | null; speaker?: string; color: string; className?: string }) {
  if (!text) return null;
  return (
    <div className={`pointer-events-none border bg-black/80 px-3 py-1.5 font-mono text-[11px] text-cyan-50 backdrop-blur-sm ${className}`} style={{ borderColor: `${color}aa` }} aria-live="polite">
      {speaker && (
        <span className="mr-1.5 uppercase tracking-widest" style={{ color }}>
          {speaker}:
        </span>
      )}
      {text}
    </div>
  );
}
