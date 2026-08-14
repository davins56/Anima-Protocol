import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import ChoiceGenerator from "./ChoiceGenerator";
import LocationDialogueHints from "./LocationDialogueHints";
import InventoryStatDisplay from "@/components/inventory/InventoryStatDisplay";
import InventoryNarrativePanel from "@/components/inventory/InventoryNarrativePanel";
import InventoryTradePanel from "@/components/inventory/InventoryTradePanel";
import SessionRelationshipGraph from "@/components/network/SessionRelationshipGraph";
import RelationshipEvolutionMap from "@/components/network/RelationshipEvolutionMap";
import NarrativeArcPanel from "@/components/narrative/NarrativeArcPanel";
import WorldStateMonitor from "@/components/world/WorldStateMonitor";
import NarrativeSuggestions from "./NarrativeSuggestions";
import CharacterEvolutionPanel from "./CharacterEvolutionPanel";
import AIInsightsPanel from "@/components/insights/AIInsightsPanel";
import GroupDynamicsPanel from "@/components/group/GroupDynamicsPanel";
import WorldEvolutionStatus from "@/components/world/WorldEvolutionStatus";
import SideQuestSuggestions from "@/components/quests/SideQuestSuggestions";
import CalendarDisplay from "./CalendarDisplay";
import EmotionIndicator from "./EmotionIndicator";
import WorldPulseFeed from "@/components/world/WorldPulseFeed";
import AtmosphericDescription from "@/components/world/AtmosphericDescription";
import SystemAlert from "./SystemAlert";
import NarrativeImpactDashboard from "@/components/dashboard/NarrativeImpactDashboard";
import { base44 } from "@/api/base44Client";
import { appendAmbientMessage } from "@/lib/appendAmbientMessage";

export default function ChatWidgetsArea({
  activeSession,
  characters,
  narrativeArcs,
  arcsLoading,
  worldStateEvents,
  worldElements,
  eventSuggestions,
  analyzingNarrative,
  characterEvolutions,
  characterEmotions,
  insights,
  insightsLoading,
  relationships,
  currentLocationContext,
  inventoryItems,
  loreEntries,
  calendar,
  pulseHeadlines,
  atmosphericDesc,
  loadingAtmosphere,
  generatedContent,
  worldEvent,
  analyzeNow,
  handleSendMessage,
  handleApplyEvent,
  loadInventory,
  setCharacterEvolutions,
  setActiveSession,
  setPulseHeadlines,
  setGeneratedContent,
  setWorldEvent,
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const characterId = activeSession?.character_id;
  const sessionId = activeSession?.id;
  const mode = activeSession?.mode;
  const groupCharacterIds = activeSession?.group_character_ids;
  const activeChar = characters.find(c => c.id === characterId);

  return (
    <div data-story-feed>
      {/* Collapse toggle — not draggable. Horizontal drag on this header
          stole taps on mobile and made the bar slide/fade instead of opening. */}
      <div className="flex items-center border-b border-primary/10 bg-black/30">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center justify-between px-3 py-1.5 hover:bg-black/50 transition-colors touch-manipulation"
        >
          <span className="font-mono text-[8px] text-primary/20 tracking-widest uppercase">Story Feed</span>
          <span className="flex items-center gap-1 text-primary/30 hover:text-primary/60 font-mono text-[8px] tracking-widest uppercase">
            {collapsed ? (
              <><ChevronDown className="w-3 h-3" /> Show</>
            ) : (
              <><ChevronUp className="w-3 h-3" /> Hide</>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide Story Feed"
          className="px-2 py-1.5 text-primary/25 hover:text-primary/60 transition-colors touch-manipulation"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="story-feed-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-2 sm:space-y-4">
          {/* Narrative Impact Dashboard */}
          <NarrativeImpactDashboard
            sessionId={sessionId}
            characterId={characterId}
            characters={characters}
            messages={activeSession?.messages || []}
          />

          {/* Narrative Paths / Choice Generator */}
          {mode === "solo" && characterId && narrativeArcs.length > 0 && (
            <ChoiceGenerator
              sessionId={sessionId}
              characterId={characterId}
              characterName={activeChar?.name}
              narrativeArcs={narrativeArcs}
              recentMessages={activeSession.messages || []}
              onChoiceSelected={(choice) => handleSendMessage(`*Deciding to ${choice.title.toLowerCase()}*`)}
              isVisible={true}
            />
          )}

          {/* Location Dialogue Hints */}
          {characterId && currentLocationContext && (
            <LocationDialogueHints
              sessionId={sessionId}
              characterId={characterId}
              characterName={activeChar?.name}
              currentLocation={currentLocationContext}
              recentContext={(activeSession.messages || []).slice(-3).map(m => m.content).join(' ')}
              isVisible={true}
            />
          )}

          {/* Inventory System */}
          {mode === "solo" && characterId && (
            <>
              <InventoryStatDisplay characterId={characterId} sessionId={sessionId} />
              <InventoryNarrativePanel characterId={characterId} sessionId={sessionId} recentMessages={activeSession?.messages || []} />
              <InventoryTradePanel
                sessionId={sessionId}
                characterId={characterId}
                characters={characters}
                onTradeComplete={() => loadInventory(characterId)}
              />
            </>
          )}

          {/* Group Relationship Graph */}
          {mode === "group" && (
            <SessionRelationshipGraph
              sessionId={sessionId}
              characters={characters.filter(c => groupCharacterIds?.includes(c.id))}
              characterEmotions={characterEmotions}
              isVisible={true}
            />
          )}

          <RelationshipEvolutionMap relationships={relationships} characters={characters} />
          <NarrativeArcPanel arcs={narrativeArcs} loading={arcsLoading} />
          <WorldStateMonitor worldEvents={worldStateEvents} messageCount={activeSession?.messages?.length} />
          <NarrativeSuggestions
            worldElements={worldElements}
            eventSuggestions={eventSuggestions}
            loading={analyzingNarrative}
            onApplySuggestion={handleApplyEvent}
          />

          {(() => {
            const sessionActiveChar = mode === "solo" && characterId
              ? characters.find(c => c.id === characterId)
              : null;
            return sessionActiveChar && characterEvolutions[sessionActiveChar.id] ? (
              <CharacterEvolutionPanel
                character={sessionActiveChar}
                evolution={characterEvolutions[sessionActiveChar.id]}
                onApplyEvolution={(evolution) => {
                  let newPersonality = evolution.evolved_personality || sessionActiveChar.personality;
                  if (evolution.growth_areas?.length) newPersonality += `\nGrowth: ${evolution.growth_areas.join(', ')}`;
                  if (evolution.updated_motivations?.length) newPersonality += `\nMotivations: ${evolution.updated_motivations.join(', ')}`;
                  if (evolution.new_vulnerabilities?.length) newPersonality += `\nVulnerabilities: ${evolution.new_vulnerabilities.join(', ')}`;
                  
                  const updates = {
                    personality: newPersonality,
                    speaking_style: sessionActiveChar.speaking_style,
                  };
                  base44.entities.Character.update(sessionActiveChar.id, updates);
                  setCharacterEvolutions(prev => {
                    const next = { ...prev };
                    delete next[sessionActiveChar.id];
                    return next;
                  });
                }}
              />
            ) : null;
          })()}

          <AIInsightsPanel insights={insights} loading={insightsLoading} onAnalyzeNow={analyzeNow} />

          {mode === "group" && (
            <GroupDynamicsPanel
              characters={characters.filter(c => groupCharacterIds?.includes(c.id))}
              relationships={relationships}
            />
          )}

          <WorldEvolutionStatus sessionId={sessionId} />

          {/* Side Quest Suggestions */}
          {mode === "solo" && characterId && (
            <SideQuestSuggestions
              sessionId={sessionId}
              characterId={characterId}
              recentMessages={activeSession.messages || []}
              inventoryItems={inventoryItems}
              loreEntries={loreEntries}
              messageCount={activeSession.messages?.length || 0}
              onQuestAccepted={(quest) => {
                const qMsg = {
                  role: "assistant",
                  type: "event",
                  event_type: "quest",
                  character_name: "Quest Log",
                  content: `⚔️ Side Quest Accepted: "${quest.title}"\n${quest.description}`,
                  timestamp: new Date().toISOString(),
                };
                // Append only — replace against a possibly-stale messages
                // snapshot can delete concurrent turns.
                appendAmbientMessage({
                  appendMessage: base44.messages.append,
                  sessionId,
                  message: qMsg,
                  setActiveSession,
                }).catch(() => {});
              }}
            />
          )}

          {calendar && <CalendarDisplay calendar={calendar} />}

          {mode === "solo" && characterId && characterEmotions[characterId] && (
            <EmotionIndicator
              emotion={characterEmotions[characterId].emotion}
              intensity={characterEmotions[characterId].intensity}
              level={characterEmotions[characterId].emotion_level || characterEmotions[characterId].level}
              arousal={characterEmotions[characterId].arousal}
              trigger={characterEmotions[characterId].trigger}
              compact={false}
            />
          )}

          {pulseHeadlines.length > 0 && (
            <WorldPulseFeed
              worldEvents={pulseHeadlines}
              isVisible={true}
              onDismissEvent={(eventId) => setPulseHeadlines(prev => prev.filter(e => e.id !== eventId))}
            />
          )}

          {(atmosphericDesc || loadingAtmosphere) && (
            <AtmosphericDescription
              description={atmosphericDesc?.description}
              location={atmosphericDesc?.location}
              isLoading={loadingAtmosphere}
            />
          )}

          {generatedContent && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="border border-green-400/30 bg-green-400/5 rounded p-3 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] text-green-400 tracking-widest uppercase">
                  ✨ New World Content Generated
                </span>
                <button onClick={() => setGeneratedContent(null)} className="text-green-400/50 hover:text-green-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
              {generatedContent.lore && <p className="text-[9px] font-mono text-green-400/80">📜 Lore: {generatedContent.lore.subject}</p>}
              {generatedContent.faction && <p className="text-[9px] font-mono text-green-400/80">🏛️ Faction: {generatedContent.faction.name}</p>}
              {generatedContent.landmark && <p className="text-[9px] font-mono text-green-400/80">🗺️ Landmark: {generatedContent.landmark.name}</p>}
            </motion.div>
          )}

          {worldEvent && <SystemAlert event={worldEvent} onDismiss={() => setWorldEvent(null)} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}