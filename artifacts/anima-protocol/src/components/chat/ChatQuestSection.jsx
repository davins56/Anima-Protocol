// @ts-check
import QuestHub from "@/components/quests/QuestHub";

/**
 * @param {{ sessionId?: any, characterId?: any, activeQuests?: any }} props
 */
export default function ChatQuestSection({ sessionId, characterId, activeQuests }) {
  return (
    <QuestHub
      sessionId={sessionId}
      characterId={characterId}
      activeQuests={activeQuests}
    />
  );
}