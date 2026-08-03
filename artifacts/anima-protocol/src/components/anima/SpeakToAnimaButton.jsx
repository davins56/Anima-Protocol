import { useState, useCallback } from 'react';
import { Mic } from 'lucide-react';
import SpeakToAnimaFunctionality from '@/components/chat/SpeakToAnimaFunctionality';

/**
 * Button + modal wrapper for "Speak to my Anima".
 *
 * Props:
 * - activeCharacter: character object with { id, name }
 * - isOpenButtonText? (optional)
 * - onSend: async (userText) => assistantText (string)
 * - getCharacterEmotion?: () => ({ emotion, intensity })
 */
export default function SpeakToAnimaButton({
  activeCharacter,
  onSend,
  getCharacterEmotion,
  buttonText = '🎤 Speak to Anima',
  disabled,
}) {
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`flex items-center gap-2 px-3 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all rounded ${
          disabled ? 'opacity-30 cursor-not-allowed' : ''
        }`}
        title="Speak to my Anima (voice input + vocal response)"
      >
        <Mic className="w-3 h-3" />
        {buttonText}
      </button>

      <SpeakToAnimaFunctionality
        activeCharacter={activeCharacter}
        isOpen={open}
        onClose={handleClose}
        onSend={onSend}
        getCharacterEmotion={getCharacterEmotion}
        disabled={disabled}
      />
    </>
  );
}

