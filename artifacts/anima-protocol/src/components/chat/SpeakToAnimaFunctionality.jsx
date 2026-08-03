import React, { useState, useMemo, useCallback } from 'react';
import VoiceInputPanel from './VoiceInputPanel';

import { useSpeakToAnima } from '@/hooks/useSpeakToAnima';

/**
 * Adds a dedicated "Speak to my Anima" flow:
 * - user speaks -> transcript -> sends to provided onSend
 * - when response arrives -> speaks response using the active character's voice
 *
 * This component is intentionally app-agnostic about messaging. You pass:
 * - activeCharacter: { id, name }
 * - getCharacterEmotion?: function returning emotion/intensity for synthesis
 * - onSend: async (text) => assistant response content (string)
 */
export default function SpeakToAnimaFunctionality({
  activeCharacter,
  isOpen,
  onClose,
  onSend,
  getCharacterEmotion,
  disabled,
}) {
  const { id: characterId, name: characterName } = activeCharacter || {};
  const [isProcessing, setIsProcessing] = useState(false);

  const { isSpeaking, error, speak, stop } = useSpeakToAnima();

  const [lastSpokenUserText, setLastSpokenUserText] = useState('');

  const emotion = useMemo(() => {
    if (typeof getCharacterEmotion === 'function') {
      const v = getCharacterEmotion();
      return {
        emotion: v?.emotion || 'neutral',
        intensity: typeof v?.intensity === 'number' ? v.intensity : 5,
      };
    }
    return { emotion: 'neutral', intensity: 5 };
  }, [getCharacterEmotion]);

  const handleSubmit = useCallback(
    async (userText) => {
      if (!userText?.trim() || isProcessing || disabled) return;
      setIsProcessing(true);
      setLastSpokenUserText(userText);
      try {
        const assistantText = await onSend(userText);
        if (!assistantText) return;

        await speak({
          text: assistantText,
          characterId,
          emotion: emotion.emotion,
          intensity: emotion.intensity,
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [disabled, emotion.emotion, emotion.intensity, isProcessing, onSend, speak, characterId]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <VoiceInputPanel
        isOpen={isOpen}
        onClose={onClose}
        isLoading={isProcessing}
        onSubmit={handleSubmit}
      />

      {/* Lightweight overlay for status/errors */}
      {(isSpeaking || error) && (
        <div className="absolute inset-x-0 bottom-4 px-4 flex justify-center pointer-events-none">
          <div className="pointer-events-none w-full max-w-lg bg-black/70 border border-primary/20 rounded p-3">
            <p className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
              {isSpeaking ? `🔊 Speaking to ${characterName || 'Anima'}...` : '—'}
            </p>
            {error && (
              <p className="font-mono text-[9px] text-red-400 mt-1 break-words">
                {error}
              </p>
            )}
            {lastSpokenUserText && (
              <p className="font-mono text-[9px] text-primary/30 mt-2 break-words">
                You said: {lastSpokenUserText}
              </p>
            )}
            <button
              className="pointer-events-auto mt-2 w-full py-2 border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
              onClick={() => stop()}
            >
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

