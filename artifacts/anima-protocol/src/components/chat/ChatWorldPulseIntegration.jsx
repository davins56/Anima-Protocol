import WorldPulseHeadlines from '@/components/world/WorldPulseHeadlines';

export default function ChatWorldPulseIntegration({
  activeSession,
  characterEmotions,
  relationships,
  loreEntries,
}) {
  if (!activeSession || (activeSession.messages?.length || 0) < 5) {
    return null;
  }

  return (
    <WorldPulseHeadlines
      sessionId={activeSession.id}
      recentMessages={activeSession.messages || []}
      characterEmotions={characterEmotions}
      relationships={relationships}
      loreEntries={loreEntries}
      isVisible={true}
    />
  );
}