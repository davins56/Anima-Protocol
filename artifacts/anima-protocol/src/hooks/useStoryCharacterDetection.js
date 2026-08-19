// This hook is designed to be called after AI response generation in Chat.jsx
// Add this logic inside handleSendMessage after finalMessages is created, around line 1020

export function detectMentionedStoryCharacters(finalMessages, characters, activeSession) {
  if (!activeSession || activeSession.mode !== 'solo' || !characters.length || !finalMessages.length) {
    return null;
  }

  // Get the latest AI message (the most recent assistant message)
  // Search from end without making a full array copy and reverse
  let latestMsg = null;
  for (let i = finalMessages.length - 1; i >= 0; i--) {
    const m = finalMessages[i];
    if (m.role === 'assistant' && m.character_name !== '__typing__' && m.type !== 'event') {
      latestMsg = m;
      break;
    }
  }
  if (!latestMsg) return null;

  const messageText = latestMsg.content.toLowerCase();

  // Construct a set of assistant character names already in the conversation once O(M)
  const assistantCharactersInConvo = new Set();
  for (let i = 0; i < finalMessages.length; i++) {
    const m = finalMessages[i];
    if (m.role === 'assistant' && m.character_name) {
      assistantCharactersInConvo.add(m.character_name);
    }
  }

  const mainCharId = activeSession.character_id;
  
  // Find any story character mentioned in the message that hasn't already appeared
  const mentionedChar = characters.find(c => {
    const isMainChar = c.id === mainCharId;
    if (isMainChar) return false;

    const alreadyInConvo = assistantCharactersInConvo.has(c.name);
    if (alreadyInConvo) return false;

    return messageText.includes(c.name.toLowerCase());
  });

  if (mentionedChar) {
    return {
      role: 'assistant',
      character_name: mentionedChar.name,
      content: `[${mentionedChar.name} appears]`,
      timestamp: new Date().toISOString(),
      type: 'event'
    };
  }

  return null;
}
