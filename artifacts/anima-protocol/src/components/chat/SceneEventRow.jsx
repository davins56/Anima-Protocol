// @ts-check
import { memo } from "react";
import { ScrollText } from "lucide-react";
import { sceneEventMeta, PRESENCE_META } from "@/lib/situationalScene";
import { useSituationalSceneView } from "./SituationalSceneContext";

/**
 * A `role: 'event'` row (#763 B3/B4): a scene line, not a bubble. No
 * avatar, no reply actions, no rating, no "remember", no TTS.
 *
 * With the scene narrator on, narration and enter/exit rows use the
 * Narrator style; otherwise they are compact centred lines.
 *
 * @param {{ message: any }} props
 */
function SceneEventRow({ message }) {
  const { narrator } = useSituationalSceneView();
  const meta = sceneEventMeta(message);
  const text = String(message?.content || "").trim();
  if (!text) return null;
  const narratorStyle = meta.kind === "narration" || (narrator && (meta.kind === "enter" || meta.kind === "exit"));
  const glyph = meta.presence ? PRESENCE_META[meta.presence]?.glyph : meta.kind === "exit" ? "↗" : meta.kind === "enter" ? "●" : "";

  if (narratorStyle) {
    return (
      <div
        role="note"
        aria-label="Scene narration"
        data-testid="scene-event"
        data-scene-kind={meta.kind}
        className="w-full my-3 px-2 sm:px-6"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <span className="h-px flex-1 bg-amber-200/15" />
          <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.3em] uppercase text-amber-200/60">
            <ScrollText className="w-3 h-3" aria-hidden="true" />
            Scene
          </span>
          <span className="h-px flex-1 bg-amber-200/15" />
        </div>
        <p className="mx-auto max-w-2xl text-center italic text-[14px] leading-relaxed text-amber-50/80 break-words">{text}</p>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Scene change"
      data-testid="scene-event"
      data-scene-kind={meta.kind}
      className="flex justify-center my-1.5 px-4"
    >
      <p className="max-w-[85%] text-center italic text-[12px] text-primary/55 break-words">
        {glyph ? <span aria-hidden="true" className="mr-1 not-italic">{glyph}</span> : null}
        {text}
      </p>
    </div>
  );
}

export default memo(SceneEventRow);
