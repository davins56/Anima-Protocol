import QuestHub from "@/components/quests/QuestHub";

export default function ChatQuestSection({ sessionId, characterId, activeQuests }) {
  return (
    <QuestHub
      sessionId={sessionId}
      characterId={characterId}
      activeQuests={activeQuests}
    />
  );
}