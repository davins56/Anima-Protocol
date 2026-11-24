import { useEffect, useState } from "react";
import { formatDreamDate } from "@/lib/dreamJournal";
import { ASPECTS } from "./aspects";
import { REFLECTION_MAX, addReflectionDraft, loadReflectionDrafts, removeReflectionDraft, type ReflectionDraft } from "./calibration";
import { Heading, Panel, PendingNote } from "./ui";

export default function ReflectionsScreen({ characterId, companionName }: { characterId: string; companionName: string }) {
  const [list, setList] = useState<ReflectionDraft[]>(() => loadReflectionDrafts(characterId));
  const [text, setText] = useState("");
  const [aspect, setAspect] = useState<string>("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setList(loadReflectionDrafts(characterId));
    setText("");
  }, [characterId]);

  const submit = () => {
    const next = addReflectionDraft(characterId, text, aspect || null);
    setFailed(!next);
    if (next) {
      setList(next);
      setText("");
    }
  };

  return (
    <div className="space-y-4">
      <Heading eyebrow="Reflections" title={`Pour into ${companionName || "her"}`} sub="Thoughts, moments, things you want her to carry." />
      <Panel className="space-y-3">
        <textarea
          aria-label="Reflection"
          value={text}
          maxLength={REFLECTION_MAX}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Write a reflection…"
          className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Aspect" value={aspect} onChange={(e) => setAspect(e.target.value)} className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
            <option value="">No aspect</option>
            {ASPECTS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={!text.trim()} onClick={submit} className="rounded-full bg-blue-600 disabled:opacity-40 hover:bg-blue-500 text-white text-sm px-4 py-1.5">
            Keep reflection
          </button>
          {failed ? <span role="alert" className="text-xs text-rose-300">Couldn't save here (storage blocked).</span> : null}
        </div>
        <PendingNote testId="essence-reflections-local">
          Kept on this device only. She can't read these yet: they go into her memory once the reflections route ships.
        </PendingNote>
      </Panel>
      {list.length === 0 ? (
        <p className="text-center text-slate-500 py-6" data-testid="essence-reflections-empty">
          Pour in your first reflection.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id}>
              <Panel className="space-y-1">
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{r.text}</p>
                <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.2em] uppercase text-slate-500">
                  <span>
                    {formatDreamDate(r.created_at)}
                    {r.aspect ? ` · ${r.aspect}` : ""} · not shared yet
                  </span>
                  <button type="button" onClick={() => setList(removeReflectionDraft(characterId, r.id))} className="hover:text-rose-300">
                    Remove
                  </button>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
