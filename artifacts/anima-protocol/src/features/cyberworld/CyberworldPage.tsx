/**
 * /cyberworld — explorable Battle Network-style cyberspace made of areas of
 * the net: the hub plaza (one "homepage" per Anima, linked by glowing data
 * paths) plus portal-linked areas such as the placeholder Landing Page.
 * Areas are data (./layout, ./areas), collision/routing is pure
 * (./collision), residents come from the companion store with a demo fallback.
 * HUD: minimap (./Minimap) and procedural ambience with a persisted mute.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { animaClient } from "@/api/animaClient";
import { companionLookHref, updateCompanionRecord } from "@/lib/listPersonalAnimas";
import { hasWebGL } from "@/lib/webglSupport";
import WebGLFallback from "@/components/battle/WebGLFallback";
import { areaById, buildWorld, travel } from "./areas";
import { homeZoneId, type Portal, type Vec2, type WorldAnima } from "./layout";
import Minimap from "./Minimap";
import { useCyberworldAnimas } from "./useCyberworldAnimas";
import { useCyberworldAudio } from "./useCyberworldAudio";
import type { MoveInput, PlayerTelemetry, SceneCommands } from "./CyberworldScene";
import { ACTIONS, type ActionId } from "./explore/actions";
import { biomeTint, BIOMES } from "./explore/biomes";
import { companionLine, systemLine } from "./explore/companion";
import { ActionBar, InspectCard, LocationExplainer, LogPanel, RegionChip, SpeechBubble } from "./explore/ExploreHud";
import { useJourneys } from "./journey/useJourneys";
import { useExploration } from "./explore/useExploration";
import { cosmeticsOf, give, giftName, SHOP_BY_ID } from "./market/economy";
import { MarketPanel } from "./market/MarketPanel";
import type { Progress } from "./explore/progress";
import { useRegionContext } from "./explore/useRegionContext";

const CyberworldScene = lazy(() => import("./CyberworldScene"));

const DPAD: ReadonlyArray<readonly [string, string, MoveInput]> = [
  ["▲", "col-start-2", { x: 0, z: 1 }],
  ["◀", "col-start-1 row-start-2", { x: -1, z: 0 }],
  ["▶", "col-start-3 row-start-2", { x: 1, z: 0 }],
  ["▼", "col-start-2 row-start-3", { x: 0, z: -1 }],
];

function NoWebGL() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-cyan-300/70">
      This device can’t open a WebGL context, so the cyberworld can’t render here.
    </div>
  );
}

export default function CyberworldPage() {
  const navigate = useNavigate();
  const { animas, source } = useCyberworldAnimas();
  const world = useMemo(() => buildWorld(animas), [animas]);
  // Current area + where we arrived (null = that area's own spawn).
  const [visit, setVisit] = useState<{ areaId: string; spawn: Vec2 | null }>({ areaId: world.start, spawn: null });
  const area = areaById(world, visit.areaId) ?? world.areas[0];
  const spawn = visit.spawn ?? area.spawn;
  const [nearId, setNearId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const touchMove = useRef<MoveInput>({ x: 0, z: 0 });
  const telemetry = useRef<PlayerTelemetry>({ x: spawn[0], z: spawn[1], heading: Math.PI, moving: false });
  const commands = useRef<SceneCommands>({ walkTo: null });
  const webgl = useMemo(() => hasWebGL(), []);
  const { muted, toggleMuted, sfx } = useCyberworldAudio();

  // ── Exploration: real-world region → daily data nodes, actions, progress.
  const { region, status: regionStatus, choice, enableLocation, chooseTimezone } = useRegionContext();
  const [companionId, setCompanionId] = useState<string | null>(null);
  const companion = useMemo(() => animas.find((a) => a.id === companionId) ?? null, [animas, companionId]);
  const explore = useExploration({ area, region, telemetry, commands, hasCompanion: animas.length > 0 });
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [bubble, setBubble] = useState<{ text: string; speaker?: string; color: string } | null>(null);
  const pendingScan = useRef(false);
  const tint = useMemo(() => biomeTint(region.biome, region.timeOfDay), [region.biome, region.timeOfDay]);
  const { state: exploreState, scan, collect, inspect, closeInspect, jack } = explore;

  // ── Journeys: residents travel on purpose (motives → destination → activity), on- and off-screen.
  const { travellers, views: journeyViews, gift: giveToTraveller } = useJourneys({ world, animas, areaId: area.id, dayKey: region.dayKey, telemetry, companionId });
  const areaLabels = useMemo(() => Object.fromEntries(world.areas.map((a) => [a.id, a.label])), [world]);
  const thoughts = useMemo(() => Object.fromEntries(journeyViews.map((v) => [v.id, v.thought])), [journeyViews]);

  const near: WorldAnima | null = useMemo(() => animas.find((a) => a.id === nearId) ?? null, [animas, nearId]);
  // Home zone lives in the hub even when the companion is met elsewhere on a journey.
  const nearZone = near ? world.areas.flatMap((a) => a.zones).find((z) => z.id === homeZoneId(near.id)) : null;
  const nearStatus = near ? journeyViews.find((v) => v.id === near.id)?.status : null;

  // ── Data Bazaar: cosmetics on the player navi; gifts go to the companion you're with (or the one beside you).
  const cosmetics = cosmeticsOf(exploreState.progress);
  const playerStyle = useMemo(
    () => ({ visor: SHOP_BY_ID[cosmetics.equipped.visor ?? ""]?.color, trail: SHOP_BY_ID[cosmetics.equipped.trail ?? ""]?.color }),
    [cosmetics.equipped.visor, cosmetics.equipped.trail],
  );
  const giftTarget = companion ?? near;
  const { setProgress } = explore;
  const onGift = useCallback(
    (itemId: string) => {
      if (!giftTarget) return;
      const r = give(exploreState.progress, itemId);
      if (!r.ok) return;
      setProgress(r.progress);
      const itemName = giftName(itemId);
      giveToTraveller(giftTarget.id, { itemId, itemName, areaId: area.id, strength: r.strength });
      sfx.collect(1);
      setBubble({ text: `For me? ${itemName}… thank you. ♡`, speaker: giftTarget.name, color: giftTarget.color || "#F472B6" });
    },
    [giftTarget, exploreState.progress, setProgress, giveToTraveller, area.id, sfx],
  );
  const onMarketChange = useCallback(
    (progress: Progress, message: string) => {
      setProgress(progress);
      sfx.blip();
      setToast(message);
    },
    [setProgress, sfx],
  );

  useEffect(() => {
    if (nearId) sfx.near();
  }, [nearId, sfx]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const onPortal = useCallback(
    (portal: Portal) => {
      const hop = travel(world, portal);
      if (!hop) return;
      sfx.portal();
      setNearId(null);
      setVisit({ areaId: hop.area.id, spawn: hop.spawn });
      setToast(`Jacked into ${hop.area.label}`);
    },
    [world, sfx],
  );

  const onPick = useCallback(
    (point: Vec2) => {
      sfx.blip();
      commands.current.walkTo = point;
    },
    [sfx],
  );
  const onStep = useCallback(() => sfx.step(), [sfx]);

  // Same flow as Animas → Talk: make this companion the active one, then open chat.
  const talk = useCallback(
    async (anima: WorldAnima) => {
      if (anima.mock || !anima.record || busy) return;
      setBusy(true);
      try {
        const me = await animaClient.auth.me().catch(() => null);
        if (me?.email && anima.record.assigned_user !== me.email) {
          await updateCompanionRecord(anima.record, { assigned_user: me.email });
        }
      } finally {
        setBusy(false);
      }
      navigate("/chat");
    },
    [busy, navigate],
  );

  // Feedback for each explore event: sound + companion (or system) line.
  useEffect(() => {
    const ev = exploreState.last;
    if (!ev) return;
    if (ev.type === "scan") sfx.scan();
    else if (ev.type === "collect") sfx.collect(explore.rarityTier[ev.loot.rarity]);
    else sfx.blip();
    const said = companion ? companionLine(companion.name, ev, region) : null;
    const text = said ?? systemLine(ev);
    if (text) setBubble({ text, speaker: said && companion ? companion.name : undefined, color: said ? companion?.color || "#F472B6" : BIOMES[region.biome].accent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreState.last]);

  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 3800);
    return () => clearTimeout(t);
  }, [bubble]);

  const finishExplainer = useCallback(
    (pick: "geo" | "timezone" | null) => {
      if (pick === "geo") enableLocation();
      else if (pick === "timezone") chooseTimezone();
      setExplainerOpen(false);
      if (pendingScan.current) {
        pendingScan.current = false;
        scan();
      }
    },
    [enableLocation, chooseTimezone, scan],
  );

  const runAction = useCallback(
    (id: ActionId) => {
      const av = explore.availability[id];
      if (!av.enabled) return;
      switch (id) {
        case "scan":
          if (choice === null && !pendingScan.current && regionStatus === "timezone") {
            // First scan: explain real-world sync before anything asks for location.
            pendingScan.current = true;
            setExplainerOpen(true);
            return;
          }
          scan();
          break;
        case "collect":
          collect();
          break;
        case "inspect":
          // At the Bazaar vendor terminal, Inspect opens the market instead.
          if (explore.nearVendor) {
            sfx.blip();
            setMarketOpen(true);
          } else inspect();
          break;
        case "jack":
          sfx.blip();
          jack();
          break;
        case "accompany": {
          sfx.blip();
          if (companionId) {
            setBubble({ text: `${companion?.name ?? "Your Anima"} heads home.`, color: "#F472B6" });
            setCompanionId(null);
          } else {
            const pick = near ?? animas[0];
            if (!pick) return;
            setCompanionId(pick.id);
            setBubble({ text: `I'm with you. Let's see what the ${BIOMES[region.biome].label} hides.`, speaker: pick.name, color: pick.color || "#F472B6" });
          }
          break;
        }
        case "log":
          sfx.blip();
          setLogOpen((o) => !o);
          break;
      }
    },
    [explore.availability, explore.nearVendor, choice, regionStatus, scan, collect, inspect, jack, sfx, companionId, companion, near, animas, region.biome],
  );

  // Keyboard shortcuts for the action bar (WASD stays movement).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) return;
      if (e.code === "Escape") {
        setLogOpen(false);
        setMarketOpen(false);
        closeInspect();
        if (explainerOpen) finishExplainer(null);
        return;
      }
      if (explainerOpen || marketOpen) return;
      const a = ACTIONS.find((x) => x.code === e.code);
      if (!a || (logOpen && a.id !== "log")) return;
      e.preventDefault();
      runAction(a.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runAction, logOpen, marketOpen, explainerOpen, finishExplainer, closeInspect]);

  const press = (v: MoveInput) => () => {
    touchMove.current = v;
  };
  const release = () => {
    touchMove.current = { x: 0, z: 0 };
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-black text-foreground">
      <div className="relative flex-1 min-h-[60vh]">
        {webgl ? (
          <WebGLFallback fallback={<NoWebGL />}>
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-mono text-xs text-cyan-300/60">Jacking in…</div>}>
              <CyberworldScene
                area={area}
                spawn={spawn}
                animas={animas}
                touchMove={touchMove}
                telemetry={telemetry}
                commands={commands}
                onPortal={onPortal}
                onStep={onStep}
                nearAnimaId={nearId}
                onNearChange={setNearId}
                tint={tint}
                nodes={explore.sceneNodes}
                scanPulseAt={exploreState.last?.type === "scan" ? exploreState.last.at : 0}
                companion={companion}
                travellers={travellers}
                thoughts={thoughts}
                playerStyle={playerStyle}
              />
            </Suspense>
          </WebGLFallback>
        ) : (
          <NoWebGL />
        )}

        <div className="pointer-events-none absolute top-2 left-2 right-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <button type="button" onClick={() => navigate(-1)} className="pointer-events-auto border border-cyan-300/40 bg-black/60 px-2 py-1.5 text-cyan-200">
            ✕ Jack out
          </button>
          <span className="truncate" style={{ color: area.theme.accent }}>
            Cyberworld · {area.label}
          </span>
          <span className="ml-auto hidden text-muted-foreground sm:inline">
            {source === "store" ? `${animas.length} resident${animas.length === 1 ? "" : "s"}` : source === "loading" ? "syncing residents…" : "demo residents"}
          </span>
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute ambience" : "Mute ambience"}
            className="pointer-events-auto ml-auto border border-cyan-300/40 bg-black/60 px-2 py-1.5 text-cyan-200 sm:ml-0"
          >
            {muted ? "♪ off" : "♪ on"}
          </button>
        </div>

        {/* Minimap: top-right under the bar, clear of the bottom-right d-pad. */}
        <Minimap
          area={area}
          animas={animas}
          travellers={journeyViews}
          areaLabels={areaLabels}
          telemetry={telemetry}
          nearAnimaId={nearId}
          nodes={explore.sceneNodes}
          onPick={onPick}
          className="absolute right-2 top-11 w-[112px] sm:w-[176px]"
        />

        {toast && (
          <p className="pointer-events-none absolute left-1/2 top-11 -translate-x-1/2 border border-cyan-300/40 bg-black/70 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-200">
            {toast}
          </p>
        )}

        <div className="pointer-events-none absolute left-2 top-11 flex max-w-[calc(100%-136px)] flex-col items-start gap-1 sm:max-w-xs">
          <RegionChip region={region} status={regionStatus} onClick={() => setExplainerOpen(true)} />
          <p className="hidden font-mono text-[9px] uppercase tracking-widest text-cyan-300/50 sm:block">
            WASD move · click floor/map to walk · drag orbit · gates travel
          </p>
        </div>

        <SpeechBubble
          text={bubble?.text ?? null}
          speaker={bubble?.speaker}
          color={bubble?.color ?? "#00EAFF"}
          className="absolute left-2 right-[124px] top-[5.5rem] sm:bottom-[4.75rem] sm:left-1/2 sm:right-auto sm:top-auto sm:max-w-md sm:-translate-x-1/2"
        />

        <InspectCard
          lootId={exploreState.inspecting}
          progress={exploreState.progress}
          onClose={closeInspect}
          className="absolute bottom-[108px] left-3 right-[172px] z-10 sm:bottom-auto sm:left-2 sm:right-auto sm:top-28 sm:w-72"
        />

        <ActionBar
          availability={explore.availability}
          onAction={runAction}
          accompanying={!!companionId}
          className="absolute bottom-3 left-3 sm:left-1/2 sm:-translate-x-1/2"
        />

        {explore.nearVendor && !marketOpen && (
          <button
            type="button"
            onClick={() => setMarketOpen(true)}
            className="absolute bottom-[64px] left-3 z-10 border border-orange-300/60 bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-orange-200 sm:bottom-[4.5rem] sm:left-1/2 sm:-translate-x-1/2"
          >
            ⌂ Vendor · press F to trade
          </button>
        )}
        <MarketPanel
          open={marketOpen}
          progress={exploreState.progress}
          dayKey={region.dayKey}
          giftTarget={giftTarget ? { name: giftTarget.name, color: giftTarget.color } : null}
          onChange={onMarketChange}
          onGift={onGift}
          onClose={() => setMarketOpen(false)}
        />

        <LogPanel
          open={logOpen}
          progress={exploreState.progress}
          region={region}
          onClose={() => setLogOpen(false)}
          onInspect={(id) => {
            setLogOpen(false);
            inspect(id);
          }}
        />
        <LocationExplainer
          open={explainerOpen}
          status={regionStatus}
          onGeo={() => finishExplainer("geo")}
          onTimezone={() => finishExplainer("timezone")}
          onClose={() => finishExplainer(null)}
        />

        {near && nearZone && (
          <div
            role="dialog"
            aria-label={`${near.name} homepage`}
            className="absolute bottom-[108px] left-3 right-[172px] border bg-black/80 p-3 font-mono backdrop-blur-sm sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-12 sm:w-[320px] sm:-translate-x-1/2"
            style={{ borderColor: nearZone.color, boxShadow: `0 0 18px ${nearZone.color}55` }}
          >
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Homepage</p>
            <p className="text-base tracking-widest" style={{ color: nearZone.color }}>
              {nearZone.label}
            </p>
            {nearStatus && <p className="mt-1 text-[11px] text-cyan-100/80">{nearStatus}</p>}
            {near.mock ? (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-muted-foreground">Demo resident. Sign in or wake a companion to move them in here.</p>
                <button type="button" onClick={() => { sfx.blip(); navigate("/animas"); }} className="min-h-[40px] w-full border border-border text-[11px] uppercase tracking-widest">
                  Meet your companions
                </button>
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    sfx.blip();
                    void talk(near);
                  }}
                  className="min-h-[40px] border text-[11px] uppercase tracking-widest disabled:opacity-50"
                  style={{ borderColor: nearZone.color, color: nearZone.color }}
                >
                  {busy ? "Linking…" : "Talk"}
                </button>
                <button type="button" onClick={() => navigate(companionLookHref(near.id))} className="min-h-[40px] border border-border text-[11px] uppercase tracking-widest">
                  Customise
                </button>
              </div>
            )}
          </div>
        )}

        {/* Touch fallback: hold-to-move d-pad (tap-to-walk also works). */}
        <div className="absolute bottom-3 right-3 grid grid-cols-3 grid-rows-3 gap-1 [@media(pointer:fine)]:hidden" aria-label="Move">
          {DPAD.map(([label, cls, v]) => (
            <button
              key={label}
              type="button"
              aria-label={`Move ${label}`}
              className={`${cls} h-12 w-12 border border-cyan-300/50 bg-black/60 font-mono text-cyan-200 active:bg-cyan-400/20`}
              onPointerDown={press(v)}
              onPointerUp={release}
              onPointerLeave={release}
              onPointerCancel={release}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
