/**
 * /deepnet: Deepnet (working name) vertical slice (#757). Hidden unless the
 * server says it is enabled for this user (ANIMA_DEEPNET + allowlist). The page
 * renders server data only, as plain text; outcomes come from the server.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { bandAt, bandDistance } from "@workspace/sim-core";
import FrequencyTuner from "@/components/resonance/FrequencyTuner";
import { listPersonalAnimas } from "@/lib/listPersonalAnimas";
import { deepnetApi } from "./api";
import { chooseDialogue, corridorProgress, isTerminal, OUTCOME_TEXT, panelFor, startDialogue, type DialogueCursor } from "./flow";
import NetworkMap2D from "./NetworkMap2D";
import type { DeepnetMap, QuestView } from "./types";

type Companion = { id: string; name: string };

const CORRIDOR_NODE = "grey-corridor";

export default function DeepnetPage() {
  const [access, setAccess] = useState<"loading" | "unavailable" | "ready">("loading");
  const [title, setTitle] = useState("Deepnet (working name)");
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [map, setMap] = useState<DeepnetMap | null>(null);
  const [view, setView] = useState<QuestView | null>(null);
  const [cursor, setCursor] = useState<DialogueCursor | null>(null);
  const [tunedW, setTunedW] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    deepnetApi.status().then((r) => {
      if (!live) return;
      if (!r.ok || !r.data?.enabled || !r.data?.allowed) {
        setAccess("unavailable");
        return;
      }
      setTitle(r.data.display_name || "Deepnet (working name)");
      setAccess("ready");
      listPersonalAnimas()
        .then((rows: unknown) => {
          if (!live || !Array.isArray(rows)) return;
          const list = rows
            .map((row) => row as { id?: unknown; name?: unknown })
            .filter((row) => typeof row.id === "string" && row.id)
            .map((row) => ({ id: String(row.id), name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Companion" }));
          setCompanions(list);
          if (list.length) setCharacterId((cur) => cur ?? list[0].id);
        })
        .catch(() => live && setError("Couldn't load your companions."));
    });
    return () => {
      live = false;
    };
  }, []);

  const loadMap = useCallback(async (id: string) => {
    const r = await deepnetApi.map(id);
    if (r.ok && r.data) setMap(r.data);
    else setError(r.status === 403 ? "That companion isn't available here." : "Couldn't load the map.");
  }, []);

  useEffect(() => {
    if (access !== "ready" || !characterId) return;
    setView(null);
    setCursor(null);
    setError(null);
    void loadMap(characterId);
  }, [access, characterId, loadMap]);

  const openCorridor = useCallback(async () => {
    if (!characterId) return;
    setBusy(true);
    setError(null);
    const entered = await deepnetApi.enter(characterId, CORRIDOR_NODE);
    if (!entered.ok || !entered.data?.quest_id) {
      setError("The corridor didn't open.");
      setBusy(false);
      return;
    }
    const q = await deepnetApi.quest(characterId, entered.data.quest_id);
    if (q.ok && q.data) {
      setView(q.data);
      setCursor(startDialogue(q.data.dialogue));
    } else setError("Couldn't load the corridor.");
    setBusy(false);
  }, [characterId]);

  const send = useCallback(
    async (step: Record<string, unknown>) => {
      if (!characterId || !view) return;
      setBusy(true);
      setError(null);
      const r = await deepnetApi.step(characterId, view.quest_id, view.state.seq, step);
      if (r.ok && r.data) {
        setView(r.data);
        if (r.data.state.step === "resolved") void loadMap(characterId);
      } else if (r.code === "stale_seq") {
        const q = await deepnetApi.quest(characterId, view.quest_id);
        if (q.ok && q.data) setView(q.data);
        setError("Progress changed elsewhere; reloaded.");
      } else setError(`That didn't work (${r.code ?? r.status}).`);
      setBusy(false);
    },
    [characterId, view, loadMap],
  );

  const gateGap = useMemo(() => (view ? bandDistance(bandAt(tunedW).key, view.gate.band) : 4), [view, tunedW]);

  if (access === "loading") return <main className="p-6 font-mono text-sm text-muted-foreground">Connecting…</main>;
  if (access === "unavailable")
    return (
      <main className="p-6 font-mono text-sm text-muted-foreground" data-testid="deepnet-unavailable">
        This area isn't available.
      </main>
    );

  const panel = view ? panelFor(view.state.step) : null;
  const node = view && cursor ? view.dialogue.nodes.find((n) => n.id === cursor.nodeId) : null;
  const lastDecision = view?.state.events.find((e) => e.step === "decision_made");

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 font-mono text-sm" data-testid="deepnet-page">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg tracking-widest uppercase">{title}</h1>
        {companions.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Companion</span>
            <select
              className="min-h-[44px] border border-border bg-background px-2"
              value={characterId ?? ""}
              onChange={(e) => setCharacterId(e.target.value)}
            >
              {companions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && (
        <p role="alert" className="border border-red-500/50 p-2 text-red-300">
          {error}
        </p>
      )}

      {map && <NetworkMap2D map={map} selectedId={view ? CORRIDOR_NODE : null} onSelect={(id) => id === CORRIDOR_NODE && void openCorridor()} />}
      {map && !view && <p className="text-muted-foreground">Select the corridor on the map to enter.</p>}

      {view && (
        <section className="space-y-3 border border-border p-3" aria-label={view.corridor.name}>
          <h2 className="tracking-widest uppercase">{view.corridor.name}</h2>
          <p className="text-muted-foreground">{view.corridor.description}</p>
          <div className="h-1 bg-border" aria-label="Corridor progress">
            <div className="h-full bg-slate-300" style={{ width: `${corridorProgress(view) * 100}%` }} />
          </div>

          {panel === "enter" && (
            <button type="button" disabled={busy} className="min-h-[44px] border border-border px-3" onClick={() => void send({ step: "entered" })}>
              Step inside
            </button>
          )}

          {panel === "encounter" && node && cursor && (
            <div className="space-y-2" data-testid="deepnet-dialogue">
              <p className="text-muted-foreground">{node.speaker}</p>
              <p>{node.line}</p>
              <div className="flex flex-wrap gap-2">
                {isTerminal(view.dialogue, cursor) ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-[44px] border border-border px-3"
                    onClick={() => void send({ step: "encounter_met", dialogue_choices: cursor.choices })}
                  >
                    Move on
                  </button>
                ) : (
                  node.choices.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="min-h-[44px] border border-border px-3"
                      onClick={() => setCursor(chooseDialogue(view.dialogue, cursor, c.id))}
                    >
                      {c.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {panel === "gate" && (
            <div className="space-y-3" data-testid="deepnet-gate">
              <p>{view.gate.prompt}</p>
              <FrequencyTuner
                value={tunedW}
                onChange={setTunedW}
                lockStrength={Math.max(0, 1 - gateGap / 4)}
                lockedLabel={gateGap === 0 ? "gate" : null}
              />
              <div className="flex flex-wrap gap-2">
                {view.gate.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={busy || !o.available}
                    title={o.available ? undefined : "Needs a deeper bond"}
                    className="min-h-[44px] border border-border px-3 disabled:opacity-40"
                    onClick={() => void send({ step: "decision_made", option_id: o.id, tuned_w: tunedW })}
                  >
                    {o.label}
                    {!o.available && " 🔒"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(panel === "resolve" || panel === "done") && (
            <div className="space-y-2" data-testid="deepnet-outcome">
              <p>{OUTCOME_TEXT[view.state.outcome ?? ""] ?? ""}</p>
              {lastDecision && (
                <p className="text-muted-foreground">
                  Tuned {lastDecision.tunedW} · {lastDecision.band} band · gate {view.gate.band}
                </p>
              )}
              {panel === "resolve" ? (
                <button type="button" disabled={busy} className="min-h-[44px] border border-border px-3" onClick={() => void send({ step: "resolved" })}>
                  Pass through
                </button>
              ) : (
                <p className="text-muted-foreground">Corridor complete. A new relay opened on the map.</p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
