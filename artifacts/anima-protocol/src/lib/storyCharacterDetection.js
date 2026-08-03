import { base44 } from '@/api/base44Client';

export async function autoIntroduceStoryCharacters(
  finalMessages,
  characters,
  activeSession,
  messageContent
) {
  if (!activeSession || activeSession.mode !== 'solo' || !characters.length) {
    return finalMessages;
  }

  const messageText = (messageContent || '').toLowerCase();
  
  // Find any story character mentioned in the message that hasn't already appeared
  const mentionedChar = characters.find(c => {
    const isMainChar = c.id === activeSession.character_id;
    const alreadyInConvo = finalMessages.some(m => m.character_name === c.name && m.role === 'assistant');
    const isMentioned = messageText.includes(c.name.toLowerCase());
    
    return isMentioned && !isMainChar && !alreadyInConvo;
  });

  if (mentionedChar) {
    const introMsg = {
      role: 'assistant',
      character_name: mentionedChar.name,
      content: `[${mentionedChar.name} appears]`,
      timestamp: new Date().toISOString(),
      type: 'event'
    };
    
    const messagesWithIntro = [...finalMessages, introMsg];
    
    // Save to session (non-blocking)
    setTimeout(() => {
      base44.entities.ChatSession.update(activeSession.id, {
        messages: messagesWithIntro
      }).catch(() => {});
    }, 100);
    
    return messagesWithIntro;
  }

  return finalMessages;
}