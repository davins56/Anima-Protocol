// @ts-check
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * @param {{ sessionId?: string, onMilestoneDetected: (milestone: any) => void }} props
 */
export default function MilestoneDetector({ sessionId, onMilestoneDetected }) {
  const [lastMessageCount, setLastMessageCount] = useState(0);

  useEffect(() => {
    if (!sessionId) return;

    const checkForMilestones = async () => {
      try {
        const session = await base44.entities.ChatSession.list().then(s =>
          s.find(x => x.id === sessionId)
        );

        if (!session || !session.messages) return;

        const currentMessageCount = session.messages.length;

        // Check if new messages arrived
        if (currentMessageCount > lastMessageCount) {
          const newMessages = session.messages.slice(lastMessageCount);
          
          // Detect narrative milestones
          const milestone = await base44.functions.invoke('detectAndCreateQuests', {
            session_id: sessionId,
            recent_messages: newMessages.slice(-5),
            message_count: currentMessageCount,
          });

          if (milestone?.data?.milestones?.length > 0) {
            milestone.data.milestones.forEach((/** @type {any} */ m) => {
              onMilestoneDetected({
                id: `milestone-${Date.now()}-${Math.random()}`,
                title: m.title,
                description: m.description,
                type: 'milestone',
              });
            });
          }

          setLastMessageCount(currentMessageCount);
        }
      } catch (err) {
        console.error('Error checking milestones:', err);
      }
    };

    const interval = setInterval(checkForMilestones, 5000);
    return () => clearInterval(interval);
  }, [sessionId, lastMessageCount, onMilestoneDetected]);

  return null; // Non-visual component
}