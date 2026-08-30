import { useMemo, useState } from "react";
import { Compass, FlaskConical, Trees } from "lucide-react";
import { track } from "@/lib/analytics";
import {
  ECHO_KEY_BY_ID,
  ECHO_EVOLUTIONS,
  FUSION_RECIPES,
  RESONANCE_SITES,
  biomeFromCoords,
  discoverAtSite,
  enrichEchoKey,
  siteCooldownRemaining,
  siteIdFromBiome,
  synthesiseEchoKeys,
} from "@/lib/echoKeys";
import EchoKeyCard from "./EchoKeyCard";

function trackDiscovery(result) {
  if (!result?.ok || !result.key) return;
  track("echo_key_discovered", {
    source: result.source || (result.recipe ? "synthesis" : "virtual"),
    site: result.site?.id || "none",
    tier: result.key.tier || "shard",
    is_outdoor: result.source === "field" || result.site?.outdoor === true,
  });
}

export default function EchoStoryMode({ account, ownedKeys, onAccount }) {
  const [selectedSite, setSelectedSite] = useState(RESONANCE_SITES[0].id);
  const [picked, setPicked] = useState([]);
  const [status, setStatus] = useState("");
  const [found, setFound] = useState(null);
  const [fieldBusy, setFieldBusy] = useState(false);

  const site = RESONANCE_SITES.find((s) => s.id === selectedSite) || RESONANCE_SITES[0];
  const virtualLeft = siteCooldownRemaining(account, site.id, { field: false });
  const fieldLeft = siteCooldownRemaining(account, site.id, { field: true });

  const emberProgress = account.evolutions?.["last-ember"] || 0;
  const emberNeed = ECHO_EVOLUTIONS["last-ember"].battlesBelowCritical;
  const holdsEmber = account.owned.includes("last-ember");
  const holdsRefused = account.owned.includes("ember-that-refused");

  const fuseHint = useMemo(() => {
    const have = new Set(account.owned);
    return FUSION_RECIPES.map((recipe) => ({
      ...recipe,
      ready: recipe.ids.every((id) => have.has(id)),
      done: have.has(recipe.result),
      names: recipe.ids.map((id) => ECHO_KEY_BY_ID[id]?.name || id),
    }));
  }, [account.owned]);

  const applyResult = (result) => {
    if (!result.ok) {
      setStatus(result.error || "The Lattice did not answer.");
      setFound(null);
      return;
    }
    setFound(result.key);
    setStatus(
      result.recipe
        ? `Sequence complete: ${result.recipe}.`
        : `Attuned at ${result.site?.name || "an unmarked place"}.`,
    );
    trackDiscovery(result);
    onAccount(result.account);
  };

  const attuneVirtual = () => {
    applyResult(discoverAtSite(account, selectedSite, { field: false }));
  };

  const attuneField = () => {
    if (!navigator.geolocation) {
      applyResult(discoverAtSite(account, selectedSite, { field: true }));
      return;
    }
    setFieldBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const biome = biomeFromCoords(pos.coords.latitude, pos.coords.longitude);
        const siteId = siteIdFromBiome(biome);
        applyResult(discoverAtSite(account, siteId, { field: true }));
        setSelectedSite(siteId);
        setFieldBusy(false);
      },
      () => {
        applyResult(discoverAtSite(account, selectedSite, { field: true }));
        setFieldBusy(false);
      },
      { enableHighAccuracy: false, maximumAge: 120000, timeout: 8000 },
    );
  };

  const togglePick = (id) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 3) return cur;
      return [...cur, id];
    });
  };

  const fuse = () => {
    applyResult(synthesiseEchoKeys(account, picked));
  };

  return (
    <div className="space-y-8">
      <section className="border border-primary/20 bg-black/40 p-4 space-y-2">
        <p className="font-mono text-[9px] tracking-[0.28em] uppercase text-primary/45">
          Story mode · Vault → Loadout → Resonance Draw → Invocation → Fusion
        </p>
        <p className="text-[13px] text-primary/70 leading-relaxed max-w-3xl">
          Echo Keys emerge wherever experience becomes sufficiently resonant that the Lattice
          remembers it. Nature is prime territory. So is a battlefield. Attune on site — virtually
          from here, or in the field. Coordinates are never stored; only a biome class.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-primary/70">
          <Trees className="w-4 h-4" />
          <h2 className="font-mono text-[10px] tracking-[0.24em] uppercase">Resonance sites</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {RESONANCE_SITES.map((row) => {
            const active = row.id === selectedSite;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedSite(row.id)}
                className="text-left border p-3 space-y-1"
                style={{
                  borderColor: active ? "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.08)",
                  background: active ? "rgba(34,211,238,0.08)" : "rgba(0,0,0,0.35)",
                }}
              >
                <p className="font-mono text-[11px] text-primary">
                  {row.emoji} {row.name}
                </p>
                <p className="font-mono text-[9px] text-primary/45 leading-relaxed">{row.hint}</p>
                <p className="font-mono text-[8px] tracking-widest uppercase text-primary/30">
                  {row.coherence} · {row.outdoor ? "outdoors" : "place"}
                </p>
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-primary/60 leading-relaxed max-w-3xl">{site.blurb}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={attuneVirtual}
            disabled={virtualLeft > 0}
            className="inline-flex items-center gap-2 px-3 py-2 border border-primary/35 text-primary/85 font-mono text-[9px] tracking-[0.2em] uppercase disabled:opacity-40"
          >
            <Compass className="w-3.5 h-3.5" />
            {virtualLeft > 0
              ? `Virtual settling (${Math.ceil(virtualLeft / 60000)}m)`
              : "Virtual attune"}
          </button>
          <button
            type="button"
            onClick={attuneField}
            disabled={fieldBusy || fieldLeft > 0}
            className="inline-flex items-center gap-2 px-3 py-2 border border-emerald-400/35 text-emerald-200/85 font-mono text-[9px] tracking-[0.2em] uppercase disabled:opacity-40"
          >
            <Trees className="w-3.5 h-3.5" />
            {fieldBusy
              ? "Reading the field…"
              : fieldLeft > 0
                ? `Field settling (${Math.ceil(fieldLeft / 60000)}m)`
                : "I am in the field"}
          </button>
        </div>
        <p className="font-mono text-[8px] text-primary/35 tracking-widest uppercase">
          Field attune asks for location once, maps it to a biome, and discards the coordinates.
          Sovereign Keys only answer in the field. Prime Keys stay with the novels.
        </p>
      </section>

      {found && (
        <section className="border border-cyan-400/30 bg-cyan-400/5 p-4 space-y-2">
          <p className="font-mono text-[9px] tracking-[0.24em] uppercase text-cyan-200/80">
            Synchronized · {found.tier}
          </p>
          <EchoKeyCard echoKey={found} />
          <p className="font-mono text-[11px] text-primary/65 leading-relaxed">{found.memoryText}</p>
        </section>
      )}

      {status && <p className="font-mono text-[10px] text-primary/55">{status}</p>}

      <section className="border border-primary/15 bg-black/30 p-4 space-y-2">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-primary/60">
          Evolution · Last Ember
        </p>
        {!holdsEmber && !holdsRefused && (
          <p className="text-[12px] text-primary/55">
            Discover Last Ember at a ruin or old battlefield. Survive three fights below 30%
            integrity while it is in your Array — its remembered event will change interpretation.
          </p>
        )}
        {holdsEmber && !holdsRefused && (
          <p className="text-[12px] text-primary/70">
            Last Ember is listening. Critical survivals: {emberProgress}/{emberNeed}.
          </p>
        )}
        {holdsRefused && (
          <p className="text-[12px] text-amber-200/80">
            Ember That Refused is in the Vault. The flame developed a new interpretation.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-primary/70">
          <FlaskConical className="w-4 h-4" />
          <h2 className="font-mono text-[10px] tracking-[0.24em] uppercase">Echo Sequences</h2>
        </div>
        <ul className="space-y-1 font-mono text-[11px] text-primary/55">
          {fuseHint.map((recipe) => (
            <li key={recipe.result}>
              {recipe.names.join(" + ")} = {recipe.name}
              {recipe.done ? " · already crystallised" : recipe.ready ? " · ready" : " · missing ingredients"}
            </li>
          ))}
        </ul>
        <p className="font-mono text-[9px] text-primary/40">
          Select two or three owned Keys, then braid. Compatible frequencies can also improvise.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
          {ownedKeys.map((key) => (
            <EchoKeyCard
              key={key.id}
              echoKey={enrichEchoKey(key)}
              selected={picked.includes(key.id)}
              compact
              onClick={() => togglePick(key.id)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={fuse}
          disabled={picked.length < 2}
          className="px-3 py-2 border border-primary/35 text-primary/85 font-mono text-[9px] tracking-[0.2em] uppercase disabled:opacity-40"
        >
          Braid sequence ({picked.length})
        </button>
      </section>
    </div>
  );
}
