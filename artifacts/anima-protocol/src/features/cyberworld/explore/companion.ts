/** Your accompanying Anima's reactions to finds — template lines, picked deterministically. */
import { BIOMES } from "./biomes";
import type { ExploreEvent } from "./actions";
import type { RegionContext } from "./region";
import { seededRng } from "./rng";

const pick = (lines: string[], seed: string) => lines[Math.floor(seededRng(seed)() * lines.length)];

export function companionLine(name: string, ev: ExploreEvent | null, region: Pick<RegionContext, "biome" | "timeOfDay" | "weather">): string | null {
  if (!ev) return null;
  const seed = `${name}|${ev.type}|${ev.at}`;
  const place = BIOMES[region.biome].label;
  switch (ev.type) {
    case "scan":
      if (ev.found === 0) return pick([`Nothing pinging here. Let's try further along the ${place}.`, "Quiet sector. Keep moving?"], seed);
      if (ev.best === "legendary" || ev.best === "epic") return pick(["Wait — that signal is huge. Over there!", "I've never felt a read like that. Go, go!"], seed);
      return pick([`${ev.found} signal${ev.found === 1 ? "" : "s"}. The ${place} is generous today.`, "Got something! It's faint but it's there.", "Nodes lit up. Want me to point?"], seed);
    case "collect":
      if (ev.firstTime) return pick([`A ${ev.loot.name}! That's new — I'm writing it in the codex.`, `First ${ev.loot.name} we've found. Keep it safe.`], seed);
      return pick([`Another ${ev.loot.name}. You're getting good at this.`, "Clean hack. Nice."], seed);
    case "inspect":
      return region.timeOfDay === "night" ? `It feels different at night… ${ev.loot.name}.` : `Hm. ${ev.loot.name}. I wonder who left it.`;
    case "scan-cooldown":
      return "Scanner's still cooling. Give it a breath.";
    default:
      return null;
  }
}

/** Neutral HUD feedback when no Anima is accompanying. */
export function systemLine(ev: ExploreEvent | null): string | null {
  if (!ev) return null;
  switch (ev.type) {
    case "scan":
      return ev.found ? `Scan: ${ev.found} signal${ev.found === 1 ? "" : "s"} in range` : "Scan: no signals in range";
    case "scan-cooldown":
      return `Scanner recharging (${Math.ceil(ev.remainingMs / 1000)}s)`;
    case "collect":
      return `${ev.firstTime ? "New! " : ""}Collected ${ev.loot.name}`;
    case "nothing":
      return ev.action === "collect" ? "Nothing to hack here — scan, then stand on a node" : "Nothing to inspect nearby";
    default:
      return null;
  }
}
