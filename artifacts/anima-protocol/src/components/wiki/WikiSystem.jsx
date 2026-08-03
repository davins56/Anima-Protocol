import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Zap, Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import WikiBrowser from './WikiBrowser';
import WikiEnrichmentPanel from './WikiEnrichmentPanel';
import AutoDetectedEntities from './AutoDetectedEntities';
import CrossSessionLorePanel from './CrossSessionLorePanel';
import { useAutoWikiTagging } from '@/hooks/useAutoWikiTagging';

export default function WikiSystem({
  sessionId,
  characterId,
  recentMessages = [],
}) {
  const [editingEntry, setEditingEntry] = useState(null);
  const [showEnrichmentPanel, setShowEnrichmentPanel] = useState(false);
  const [showCrossSession, setShowCrossSession] = useState(true);

  // Use auto-tagging hook for real-time entity detection
  const { autoDetectedEntities, isExtracting, triggerAutoTagging } = useAutoWikiTagging(
    sessionId,
    recentMessages,
    true
  );

  const handleSaveEntry = async (entryData) => {
    try {
      if (editingEntry?.id) {
        // Update existing
        await base44.entities.WikiCodex.update(editingEntry.id, entryData);
      } else {
        // Create new
        await base44.entities.WikiCodex.create({
          ...entryData,
          session_ids: [sessionId],
        });
      }
      setEditingEntry(null);
      setShowEnrichmentPanel(false);
    } catch (err) {
      console.error('Error saving entry:', err);
    }
  };

  return (
    <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            Wiki System
          </h3>
          {isExtracting && (
            <Zap className="w-3 h-3 text-yellow-400 animate-pulse" />
          )}
        </div>
        <button
          onClick={() => {
            setEditingEntry(null);
            setShowEnrichmentPanel(true);
          }}
          className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 border border-primary/30 text-primary/70 hover:text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
        >
          <Plus className="w-3 h-3" />
          New Entry
        </button>
      </div>

      {/* Auto-Detected Entities */}
      <AutoDetectedEntities
        entities={autoDetectedEntities}
        isExtracting={isExtracting}
        onAddToWiki={(entity) => {
          setEditingEntry({
            name: entity.name,
            entry_type: entity.entry_type,
            summary: entity.summary,
            tags: entity.tags || [],
            lore_facts: [entity.summary].filter(Boolean),
            importance: entity.importance || 'notable',
          });
          setShowEnrichmentPanel(true);
        }}
      />

      {/* Cross-Session Lore */}
      <CrossSessionLorePanel
        sessionId={sessionId}
        characterId={characterId}
        visible={showCrossSession}
      />

      {/* Wiki Browser */}
      <WikiBrowser
        sessionId={sessionId}
        onEditEntry={(entry) => {
          setEditingEntry(entry);
          setShowEnrichmentPanel(true);
        }}
      />

      {/* Enrichment Panel Modal */}
      <AnimatePresence>
        {showEnrichmentPanel && (
          <WikiEnrichmentPanel
            entry={editingEntry}
            onSave={handleSaveEntry}
            onClose={() => {
              setShowEnrichmentPanel(false);
              setEditingEntry(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}