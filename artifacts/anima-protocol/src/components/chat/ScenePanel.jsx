// @ts-check
import { memo, useState } from "react";
import {
  PRESENCE_META,
  REACH_META,
  LOCATION_MAX,
  castPatch,
  sceneSummaryLine,
} from "@/lib/situationalScene";

/** Chip menu actions (B1). Each sends exactly one PATCH. */
const PRESENCE_ACTIONS = /** @type {const} */ ([
  { presence: "here", label: "Bring in" },
  { presence: "away", label: "Send away" },
  { presence: "asleep", label: "Asleep" },
  { presence: "busy", label: "Busy" },
  { presence: "jacked_in", label: "Jacked in" },
  { presence: "injured", label: "Injured" },
]);
const REACH_ACTIONS = /** @type {const} */ (["none", "text", "phone"]);

/**
 * Scene header and presence list for the Talk screen (#763 B1–B3).
 * Renders only from the server scene it is given; every change goes out
 * through `onPatch` (one PATCH per action). `adult_gated` is shown as the
 * server sent it and never derived from the cast.
 *
 * @param {{
 *   scene: import("@/lib/situationalScene").Scene,
 *   rows: { id: string, name: string, presence: import("@/lib/situationalScene").Presence, reach: import("@/lib/situationalScene").Reach, note: string | null }[],
 *   onPatch: (partial: Record<string, unknown>) => void,
 *   disabled?: boolean,
 * }} props
 */
function ScenePanel({ scene, rows, onPatch, disabled = false }) {
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [menuFor, setMenuFor] = useState(/** @type {string | null} */ (null));
  const [noteDraft, setNoteDraft] = useState("");

  const commitLocation = () => {
    const next = locationDraft.trim().slice(0, LOCATION_MAX);
    setEditingLocation(false);
    if ((next || null) !== (scene.location || null)) onPatch({ location: next || null });
  };

  const openMenu = (id) => {
    setNoteDraft("");
    setMenuFor((cur) => (cur === id ? null : id));
  };

  return (
    <section
      aria-label="Scene"
      data-testid="scene-panel"
      className="px-3 py-2 border-b border-primary/10 bg-black/40 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 flex-wrap">
        {editingLocation ? (
          <input
            autoFocus
            aria-label="Scene location"
            value={locationDraft}
            maxLength={LOCATION_MAX}
            onChange={(e) => setLocationDraft(e.target.value)}
            onBlur={commitLocation}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLocation();
              if (e.key === "Escape") setEditingLocation(false);
            }}
            className="font-mono text-[11px] bg-black/50 border border-primary/30 rounded px-2 py-0.5 text-primary"
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setLocationDraft(scene.location || "");
              setEditingLocation(true);
            }}
            data-testid="scene-location"
            className="font-mono text-[11px] text-primary/80 hover:text-primary"
            title="Edit location"
          >
            {scene.location ? `📍 ${scene.location}` : "📍 Set location"}
          </button>
        )}
        <span data-testid="scene-summary" className="font-mono text-[9px] text-primary/40 tracking-wider">
          {sceneSummaryLine(scene, rows)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div role="radiogroup" aria-label="Who answers" className="flex rounded-full border border-primary/25 overflow-hidden">
            {[
              { mode: "natural", label: "Natural" },
              { mode: "everyone", label: "Everyone answers" },
            ].map((opt) => (
              <button
                key={opt.mode}
                type="button"
                role="radio"
                aria-checked={scene.mode === opt.mode}
                disabled={disabled}
                onClick={() => scene.mode !== opt.mode && onPatch({ mode: opt.mode })}
                className={`font-mono text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 ${scene.mode === opt.mode ? "bg-primary/20 text-primary" : "text-primary/50"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-primary/60">
            <input
              type="checkbox"
              aria-label="Narrator"
              checked={scene.narrator}
              disabled={disabled}
              onChange={(e) => onPatch({ narrator: e.target.checked })}
            />
            Narrator
          </label>
        </div>
      </div>

      <ul aria-label="Who's here" className="mt-2 flex flex-wrap gap-1.5">
        {rows.map((row) => {
          const meta = PRESENCE_META[row.presence];
          const reach = row.reach !== "none" ? REACH_META[row.reach] : null;
          return (
            <li key={row.id} className="relative">
              <button
                type="button"
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={menuFor === row.id}
                data-testid={`scene-chip-${row.id}`}
                data-presence={row.presence}
                onClick={() => openMenu(row.id)}
                title={row.note || meta.label}
                className={`font-mono text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${row.presence === "here" ? "border-primary/50 text-primary" : "border-primary/20 text-primary/50"}`}
              >
                <span aria-hidden="true">{meta.glyph}</span>
                <span>{row.name}</span>
                <span className="sr-only">, {meta.label}</span>
                {reach ? (
                  <span aria-label={reach.label} className="text-[9px]">
                    {reach.glyph}
                  </span>
                ) : null}
                {row.note ? <span className="text-primary/40 truncate max-w-[8rem]">· {row.note}</span> : null}
              </button>
              {menuFor === row.id && (
                <div
                  role="menu"
                  aria-label={`${row.name} presence`}
                  className="absolute z-20 mt-1 left-0 min-w-[10rem] rounded-md border border-primary/30 bg-black/90 p-1 shadow-lg"
                >
                  {PRESENCE_ACTIONS.map((action) => (
                    <button
                      key={action.presence}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        const change =
                          action.presence === "away" && noteDraft.trim()
                            ? { presence: action.presence, note: noteDraft.trim() }
                            : { presence: action.presence };
                        onPatch(castPatch(row.id, change));
                      }}
                      className="w-full text-left font-mono text-[10px] px-2 py-1 text-primary/80 hover:bg-primary/10 flex items-center gap-1.5"
                    >
                      <span aria-hidden="true">{PRESENCE_META[action.presence].glyph}</span>
                      {action.label}
                    </button>
                  ))}
                  <input
                    aria-label="Note (optional, for Send away)"
                    placeholder="Note for Send away…"
                    value={noteDraft}
                    maxLength={120}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    className="mt-1 w-full font-mono text-[10px] bg-black/60 border border-primary/20 rounded px-2 py-0.5 text-primary"
                  />
                  <div className="mt-1 flex gap-1 px-1" role="group" aria-label="Reach">
                    {REACH_ACTIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="menuitemradio"
                        aria-checked={row.reach === r}
                        onClick={() => {
                          setMenuFor(null);
                          onPatch(castPatch(row.id, { reach: r }));
                        }}
                        className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${row.reach === r ? "border-primary/60 text-primary" : "border-primary/20 text-primary/50"}`}
                      >
                        Reach: {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {scene.adult_gated === true && (
        <p data-testid="scene-adult-gated" className="mt-1.5 font-mono text-[9px] text-primary/35">
          Adult content is off in this scene.
        </p>
      )}
    </section>
  );
}

export default memo(ScenePanel);
