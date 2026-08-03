import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Small status indicator to confirm the active custom Anima has an ElevenLabs voice assigned.
 */
export default function CustomAnimaVoiceStatus({ characterId, className = '' }) {
  const [hasVoice, setHasVoice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!characterId) {
      setHasVoice(null);
      return;
    }

    base44.entities.Character
      .list()
      .then((chars) => {
        if (cancelled) return;
        const c = chars.find((x) => x.id === characterId);
        setHasVoice(!!c?.elevenlabs_voice_id);
      })
      .catch(() => {
        if (cancelled) return;
        setHasVoice(false);
      });

    return () => {
      cancelled = true;
    };
  }, [characterId]);

  if (hasVoice === null) return null;

  return (
    <div
      className={`font-mono text-[9px] tracking-widest uppercase px-2 py-1 rounded border ${
        hasVoice
          ? 'border-green-400/40 bg-green-400/10 text-green-400'
          : 'border-primary/20 bg-black/40 text-primary/40'
      } ${className}`}
      title={hasVoice ? 'ElevenLabs voice assigned' : 'No ElevenLabs voice assigned (TTS may use system voice)'}
    >
      {hasVoice ? '✓ Anima voice ready' : 'No Anima voice assigned'}
    </div>
  );
}

