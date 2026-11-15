/**
 * Fighting style panel for one anima (#768 §4, PR 4). Shows her primary and
 * secondary style, her explanation, her top five fits, and lets the user
 * re-roll, choose for her, or let her choose again. Every write goes through
 * the server (`expected_rev` optimistic concurrency); the client never writes
 * `martial_arts` itself. Renders nothing when the feature is off (404).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { getStyle, pickLabel, SEED_LIBRARY, type MartialStyle, type StylePick } from "@workspace/martial-core";
import { martialArtsApi } from "./api";
import type { CharacterStyleView, PickBody } from "./types";

const lib = SEED_LIBRARY;
const KIND_LABEL: Record<string, string> = { striking: "Striking", grappling: "Grappling", hybrid: "Hybrid", weapon: "Weapon arts" };
const SOURCE_LABEL: Record<string, string> = { auto: "She chose this", reroll: "She chose again", override: "You chose this" };

function label(pick: StylePick | null | undefined): string {
  if (!pick) return "";
  return pickLabel(lib, pick) || pick.style_id;
}

const GROUPED: Array<[string, MartialStyle[]]> = (() => {
  const groups = new Map<string, MartialStyle[]>();
  for (const s of lib.styles) groups.set(s.kind, [...(groups.get(s.kind) ?? []), s]);
  return [...groups.entries()].map(([k, list]) => [k, [...list].sort((a, b) => a.name.localeCompare(b.name))]);
})();

function errorText(status: number, code?: string): string {
  if (status === 409) return "Her style changed somewhere else. Showing the latest.";
  if (status === 422) return code === "same_style" ? "Pick two different styles." : "That style isn't in the library.";
  if (status === 429) return "Too many changes in a row. Try again in a minute.";
  if (status === 403) return "This companion isn't available here.";
  return "Couldn't save that. Try again.";
}

export default function StylePanel({ characterId, name = "She" }: { characterId: string; name?: string }) {
  const [view, setView] = useState<CharacterStyleView | null>(null);
  const [state, setState] = useState<"loading" | "off" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [primaryId, setPrimaryId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");

  const load = useCallback(async () => {
    const r = await martialArtsApi.character(characterId);
    if (r.ok && r.data) {
      setView(r.data);
      setState("ready");
    } else setState(r.status === 404 ? "off" : "error");
  }, [characterId]);

  useEffect(() => {
    setState("loading");
    setView(null);
    setMessage(null);
    setChoosing(false);
    void load();
  }, [load]);

  const profile = view?.profile ?? null;
  const rev = profile?.rev ?? 0;

  const submit = useCallback(
    async (body: Omit<PickBody, "expected_rev">) => {
      setBusy(true);
      setMessage(null);
      const r = await martialArtsApi.pick(characterId, { ...body, expected_rev: rev });
      if (r.ok && r.data?.profile) {
        setChoosing(false);
        await load();
      } else {
        setMessage(errorText(r.status, r.code));
        if (r.status === 409) await load();
        if (r.status === 404) setState("off");
      }
      setBusy(false);
    },
    [characterId, rev, load],
  );

  const selectedStyle = useMemo(() => getStyle(lib, primaryId), [primaryId]);

  if (state === "off") return null;
  if (state === "loading") return <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">Loading fighting style…</p>;
  if (state === "error" || !view)
    return (
      <div role="alert" className="border border-primary/15 p-4 font-mono text-xs text-primary/60 space-y-2">
        <p>Couldn't load her fighting style.</p>
        <button type="button" className="min-h-[44px] border border-primary/30 px-3" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );

  const shown = profile ?? view.suggestion;
  const primaryStyle = getStyle(lib, shown?.primary?.style_id);

  return (
    <section className="border border-primary/15 bg-black/40 p-4 space-y-4 font-mono text-xs" aria-label="Fighting style" data-testid="martial-style-panel">
      <div className="space-y-1">
        <p className="text-[9px] tracking-[0.25em] uppercase text-primary/40">
          {profile ? SOURCE_LABEL[profile.source] ?? "Her style" : "Not chosen yet"}
        </p>
        <h2 className="text-sm text-primary tracking-wider" data-testid="martial-primary">
          {label(shown?.primary) || "No style yet"}
        </h2>
        {shown?.secondary && <p className="text-primary/60">Secondary: {label(shown.secondary)}</p>}
        {primaryStyle && <p className="text-primary/45">{primaryStyle.summary}</p>}
      </div>

      {shown?.explanation && (
        <blockquote className="border-l-2 border-primary/30 pl-3 text-primary/80" data-testid="martial-explanation">
          “{shown.explanation}”
        </blockquote>
      )}

      {!profile && <p className="text-primary/45">{name} will choose for herself at her first battle. This is what she'd pick now.</p>}
      {profile && view.stale && (
        <p className="border border-amber-300/30 p-2 text-amber-200/80" data-testid="martial-stale">
          Her personality has changed since she chose. Ask her again?
        </p>
      )}

      {message && (
        <p role="status" className="text-amber-200/80">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="min-h-[44px] border border-primary/30 px-3 disabled:opacity-40" onClick={() => void submit({ action: profile ? "reroll" : "auto" })}>
          {profile ? "Ask her again" : "Let her choose now"}
        </button>
        {profile?.source === "override" && (
          <button type="button" disabled={busy} className="min-h-[44px] border border-primary/30 px-3 disabled:opacity-40" onClick={() => void submit({ action: "auto" })}>
            Let her choose
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          aria-expanded={choosing}
          className="min-h-[44px] border border-primary/30 px-3 disabled:opacity-40"
          onClick={() => {
            setChoosing((v) => !v);
            setPrimaryId(profile?.primary.style_id ?? "");
            setVariantId(profile?.primary.variant_id ?? "");
            setSecondaryId(profile?.secondary?.style_id ?? "");
          }}
        >
          Choose for her
        </button>
      </div>

      {choosing && (
        <form
          className="space-y-2 border border-primary/15 p-3"
          aria-label="Choose a style"
          onSubmit={(e) => {
            e.preventDefault();
            if (!primaryId) return;
            void submit({
              action: "override",
              primary: { style_id: primaryId, variant_id: variantId || null },
              secondary: secondaryId ? { style_id: secondaryId, variant_id: null } : null,
            });
          }}
        >
          <label className="block space-y-1">
            <span className="text-primary/50">Style</span>
            <select className="w-full min-h-[44px] border border-primary/25 bg-background px-2" value={primaryId} onChange={(e) => (setPrimaryId(e.target.value), setVariantId(""))}>
              <option value="">Pick a style…</option>
              {GROUPED.map(([kind, list]) => (
                <optgroup key={kind} label={KIND_LABEL[kind] ?? kind}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {selectedStyle && selectedStyle.variants.length > 0 && (
            <label className="block space-y-1">
              <span className="text-primary/50">Variant</span>
              <select className="w-full min-h-[44px] border border-primary/25 bg-background px-2" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                <option value="">Any</option>
                {selectedStyle.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-primary/50">Secondary (optional)</span>
            <select className="w-full min-h-[44px] border border-primary/25 bg-background px-2" value={secondaryId} onChange={(e) => setSecondaryId(e.target.value)}>
              <option value="">None</option>
              {GROUPED.map(([kind, list]) => (
                <optgroup key={kind} label={KIND_LABEL[kind] ?? kind}>
                  {list
                    .filter((s) => s.id !== primaryId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !primaryId} className="min-h-[44px] border border-primary/40 px-3 disabled:opacity-40">
            Save her style
          </button>
        </form>
      )}

      {view.ranking.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] tracking-[0.25em] uppercase text-primary/40">Her best fits</p>
          <ol className="space-y-1 list-decimal list-inside text-primary/70" data-testid="martial-ranking">
            {view.ranking.slice(0, 5).map((r) => (
              <li key={r.style_id}>{label(r)}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
