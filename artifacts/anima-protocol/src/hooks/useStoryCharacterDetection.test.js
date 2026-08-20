import { describe, expect, it } from 'vitest';
import { detectMentionedStoryCharacters } from './useStoryCharacterDetection';

describe('detectMentionedStoryCharacters', () => {
  it('returns null if prerequisites are not met', () => {
    expect(detectMentionedStoryCharacters([], [], { mode: 'solo' })).toBeNull();
    expect(detectMentionedStoryCharacters([{ role: 'assistant', content: 'hello' }], [], { mode: 'solo' })).toBeNull();
    expect(detectMentionedStoryCharacters([{ role: 'assistant', content: 'hello' }], [{ id: 'c1', name: 'Astra' }], null)).toBeNull();
    expect(detectMentionedStoryCharacters([{ role: 'assistant', content: 'hello' }], [{ id: 'c1', name: 'Astra' }], { mode: 'group' })).toBeNull();
  });

  it('detects mentioned story character when not already in conversation and not main character', () => {
    const characters = [
      { id: 'c1', name: 'MainHero' },
      { id: 'c2', name: 'Astra' },
      { id: 'c3', name: 'Zephyr' }
    ];
    const activeSession = { mode: 'solo', character_id: 'c1' };
    const finalMessages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Suddenly Astra appears in the shadows.', character_name: 'MainHero' }
    ];

    const result = detectMentionedStoryCharacters(finalMessages, characters, activeSession);
    expect(result).toEqual({
      role: 'assistant',
      character_name: 'Astra',
      content: '[Astra appears]',
      timestamp: expect.any(String),
      type: 'event'
    });
  });

  it('ignores main character or character already present in conversation', () => {
    const characters = [
      { id: 'c1', name: 'MainHero' },
      { id: 'c2', name: 'Astra' }
    ];
    const activeSession = { mode: 'solo', character_id: 'c1' };

    const messages1 = [
      { role: 'assistant', content: 'I am MainHero!', character_name: 'MainHero' }
    ];
    expect(detectMentionedStoryCharacters(messages1, characters, activeSession)).toBeNull();

    const messages2 = [
      { role: 'assistant', content: 'Hello', character_name: 'Astra' },
      { role: 'assistant', content: 'Look Astra is here', character_name: 'MainHero' }
    ];
    expect(detectMentionedStoryCharacters(messages2, characters, activeSession)).toBeNull();
  });

  it('handles large conversations without changing detection behavior', () => {
    const characters = Array.from({ length: 1000 }, (_, i) => ({
      id: `char_${i}`,
      name: `Character_${i}`
    }));
    const activeSession = { mode: 'solo', character_id: 'char_0' };
    const finalMessages = Array.from({ length: 2000 }, (_, i) => ({
      role: 'assistant',
      character_name: `Character_${i % 500}`,
      content: `Message ${i} talking about something irrelevant.`
    }));

    finalMessages.push({
      role: 'assistant',
      character_name: 'Character_0',
      content: 'Here comes Character_999 into the scene!'
    });

    const result = detectMentionedStoryCharacters(finalMessages, characters, activeSession);
    expect(result?.character_name).toBe('Character_999');
  });
});
