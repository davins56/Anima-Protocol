import { useEffect } from 'react';
import DecisionTree from '@/components/branching/DecisionTree';
import { useNarrativeBranching } from '@/hooks/useNarrativeBranching';

export default function ChatDecisionTreeWrapper({
  sessionId,
  messages,
  characterEmotions,
  relationships,
}) {
  const { lastUserChoice, branches, branchLoading, predictBranches } = useNarrativeBranching(sessionId);

  // When user sends a message, predict branches
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    // Only predict on user messages, not system or AI messages
    if (lastMessage.role === 'user' && lastMessage.content && !lastUserChoice) {
      predictBranches(lastMessage.content, messages, characterEmotions, relationships);
    }
  }, [messages?.length]);

  if (!lastUserChoice || branches.length === 0) return null;

  return (
    <DecisionTree
      sessionId={sessionId}
      lastUserChoice={lastUserChoice}
      recentMessages={messages || []}
      characterEmotions={characterEmotions}
      relationships={relationships}
      isVisible={true}
    />
  );
}