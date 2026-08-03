import { useEffect, useState } from 'react';
import { useQuestDetectionEngine } from '@/hooks/useQuestDetectionEngine';
import QuestDetectionNotice from '@/components/quests/QuestDetectionNotice';

/**
 * Wrapper that detects quests from the latest message and displays a notice.
 * Call this after each message is added to the session.
 */
export default function QuestDetectionWrapper({
  sessionId,
  characterName,
  messages,
  onQuestCreated,
}) {
  const [noticeQueue, setNoticeQueue] = useState([]);
  const [displayedQuestIds, setDisplayedQuestIds] = useState(new Set());
  const { detectAndCreateQuests } = useQuestDetectionEngine(sessionId, characterName);

  useEffect(() => {
    if (!messages || messages.length < 2) return;

    // Get the last user message and the response that followed
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const responseAfterUser = messages[messages.indexOf(lastUserMsg) + 1];

    if (!lastUserMsg || !responseAfterUser) return;

    // Trigger quest detection
    detectAndCreateQuests(lastUserMsg.content, responseAfterUser.content)
      .then(result => {
        if (result?.quests && result.quests.length > 0) {
          // Only show quests we haven't already displayed
          const newQuests = result.quests.filter(q => !displayedQuestIds.has(q.id));
          
          if (newQuests.length > 0) {
            // Queue notices for display
            newQuests.forEach(quest => {
              setNoticeQueue(prev => [...prev, quest]);
              setDisplayedQuestIds(prev => new Set([...prev, quest.id]));
            });

            onQuestCreated?.(result.quests);
          }
        }
      })
      .catch(err => console.error('Quest detection failed:', err));
  }, [messages?.length]); // Only re-run when message count changes

  return (
    <div className="space-y-2">
      {noticeQueue.slice(0, 1).map((quest, idx) => (
        <QuestDetectionNotice
          key={quest.id || idx}
          quest={quest}
          onDismiss={() => {
            setNoticeQueue(prev => prev.slice(1));
          }}
        />
      ))}
    </div>
  );
}