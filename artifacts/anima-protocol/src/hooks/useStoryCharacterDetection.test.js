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

    // Case 1: Mentioned main character
    const messages1 = [
      { role: 'assistant', content: 'I am MainHero!', character_name: 'MainHero' }
    ];
    expect(detectMentionedStoryCharacters(messages1, characters, activeSession)).toBeNull();

    // Case 2: Character already in conversation as assistant
    const messages2 = [
      { role: 'assistant', content: 'Hello', character_name: 'Astra' },
      { role: 'assistant', content: 'Look Astra is here', character_name: 'MainHero' }
    ];
    expect(detectMentionedStoryCharacters(messages2, characters, activeSession)).toBeNull();
  });

  it('skips typing placeholders and event messages when finding the latest assistant turn', () => {
    const characters = [
      { id: 'c1', name: 'MainHero' },
      { id: 'c2', name: 'Astra' },
      { id: 'c3', name: 'Zephyr' },
    ];
    const activeSession = { mode: 'solo', character_id: 'c1' };
    const finalMessages = [
      { role: 'assistant', content: 'Suddenly Astra appears.', character_name: 'MainHero' },
      { role: 'assistant', content: '', character_name: '__typing__' },
      { role: 'assistant', content: '[Zephyr appears]', character_name: 'Zephyr', type: 'event' },
    ];

    expect(detectMentionedStoryCharacters(finalMessages, characters, activeSession)).toEqual({
      role: 'assistant',
      character_name: 'Astra',
      content: '[Astra appears]',
      timestamp: expect.any(String),
      type: 'event',
    });
  });

  it('benchmark performance on large datasets', () => {
    const numMessages = 2000;
    const numCharacters = 1000;

    const characters = Array.from({ length: numCharacters }, (_, i) => ({
      id: `char_${i}`,
      name: `Character_${i}`
    }));

    const activeSession = { mode: 'solo', character_id: 'char_0' };

    const finalMessages = Array.from({ length: numMessages }, (_, i) => ({
      role: 'assistant',
      character_name: `Character_${i % 500}`,
      content: `Message ${i} talking about something irrelevant.`
    }));

    // Add latest message mentioning Character_999 (last character)
    finalMessages.push({
      role: 'assistant',
      character_name: 'Character_0',
      content: 'Here comes Character_999 into the scene!'
    });

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      detectMentionedStoryCharacters(finalMessages, characters, activeSession);
    }
    const end = performance.now();
    const duration = end - start;

    console.log(`[BENCHMARK] ${iterations} iterations took ${duration.toFixed(2)}ms (avg: ${(duration / iterations).toFixed(4)}ms/op)`);

    const result = detectMentionedStoryCharacters(finalMessages, characters, activeSession);
    expect(result?.character_name).toBe('Character_999');
  });
});
