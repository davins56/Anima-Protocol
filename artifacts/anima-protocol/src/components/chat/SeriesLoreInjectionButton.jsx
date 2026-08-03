// @ts-check
import { useState } from "react";
import { BookOpen } from "lucide-react";
import StoryIngestModal from "@/components/stories/StoryIngestModal";

/**
 * @param {{ sessionId?: string, characterId?: string }} props
 */
export default function SeriesLoreInjectionButton({ sessionId, characterId }) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        title="Inject series/movie lore into session"
        className="px-2.5 py-1.5 border border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] tracking-widest uppercase transition-all"
      >
        <BookOpen className="w-3.5 h-3.5" />
      </button>

      <StoryIngestModal
        isOpen={showModal}
        sessionId={sessionId}
        characterId={characterId}
        onClose={() => setShowModal(false)}
        onIngestComplete={() => {
          // Optional: reload lore or trigger UI update
        }}
      />
    </>
  );
}