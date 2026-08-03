import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import LoreBrowserPanel from '@/components/lore/LoreBrowserPanel';

export default function ChatLoreBrowserIntegration({ sessionId }) {
  const [showLorePanel, setShowLorePanel] = useState(false);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setShowLorePanel(!showLorePanel)}
        title="Open lore database"
        className={`px-2.5 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all ${
          showLorePanel
            ? 'bg-primary/10 border-primary/60 text-primary'
            : 'border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40'
        }`}
      >
        <BookOpen className="w-3.5 h-3.5" />
      </button>

      {/* Lore Panel */}
      <LoreBrowserPanel
        sessionId={sessionId}
        isOpen={showLorePanel}
        onClose={() => setShowLorePanel(false)}
      />
    </>
  );
}