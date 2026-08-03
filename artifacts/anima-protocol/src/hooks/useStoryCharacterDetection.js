// This hook is designed to be called after AI response generation in Chat.jsx
// Add this logic inside handleSendMessage after finalMessages is created, around line 1020

export function detectMentionedStoryCharacters(finalMessages, characters, activeSession) {
  if (!activeSession || activeSession.mode !== 'solo' || !characters.length || !finalMessages.length) {
    return null;
  }

  // Get the latest AI message (the most recent assistant message)
  const latestMsg = [...finalMessages].reverse().find(m => m.role === 'assistant' && m.character_name !== '__typing__' && m.type !== 'event');
  if (!latestMsg) return null;

  const messageText = latestMsg.content.toLowerCase();
  
  // Find any story character mentioned in the message that hasn't already appeared
  const mentionedChar = characters.find(c => {
    const isMainChar = c.id === activeSession.character_id;
    const alreadyInConvo = finalMessages.some(m => m.character_name === c.name && m.role === 'assistant');
    const isMentioned = messageText.includes(c.name.toLowerCase());
    
    return isMentioned && !isMainChar && !alreadyInConvo;
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