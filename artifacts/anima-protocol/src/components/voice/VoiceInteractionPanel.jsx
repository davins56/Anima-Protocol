// @ts-check
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import VoiceStateIndicator from './VoiceStateIndicator';

/**
 * @param {{ characterName?: string, characterEmotion?: string, isEnabled?: boolean, onToggle?: () => void, messageContent?: string, isMessagePlaying?: boolean }} props
 */
export default function VoiceInteractionPanel({
  characterName,
  characterEmotion = 'neutral',
  isEnabled = true,
  onToggle,
  messageContent,
  isMessagePlaying = false,
}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [emotionIntensity, setEmotionIntensity] = useState(5);

  // Simulate emotion intensity based on message length/content
  useEffect(() => {
    if (!messageContent) return;
    
    const exclamationCount = (messageContent.match(/!/g) || []).length;
    const questionCount = (messageContent.match(/\?/g) || []).length;
    const ellipsisCount = (messageContent.match(/\.\.\./g) || []).length;
    
    let intensity = 5;
    intensity += exclamationCount * 1.5;
    intensity += questionCount * 0.5;
    intensity += ellipsisCount * 0.3;
    
    setEmotionIntensity(Math.min(intensity, 10));
  }, [messageContent]);

  return (
    <div className="space-y-2">
      {/* Voice Control Button */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg font-mono text-[9px] tracking-widest uppercase transition-all ${
          isEnabled
            ? 'bg-primary/10 border-primary/50 text-primary hover:bg-primary/20'
            : 'bg-black/40 border-primary/20 text-primary/40 hover:text-primary/60'
        }`}
      >
        {isEnabled ? (
          <>
            <Mic className="w-4 h-4" />
            Voice Enabled
          </>
        ) : (
          <>
            <MicOff className="w-4 h-4" />
            Voice Disabled
          </>
        )}
      </button>

      {/* Voice State Indicator */}
      <AnimatePresence>
        {isEnabled && isSpeaking && (
          <VoiceStateIndicator
            isPlaying={isSpeaking}
            isPaused={isPaused}
            emotion={characterEmotion}
            intensity={emotionIntensity}
            characterName={characterName}
            onPause={() => setIsPaused(true)}
            onResume={() => setIsPaused(false)}
            onStop={() => setIsSpeaking(false)}
          />
        )}
      </AnimatePresence>

      {/* Status Text */}
      {isEnabled && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-[8px] font-mono text-primary/40 text-center tracking-widest"
        >
          {isSpeaking ? isPaused ? '⏸ Paused' : '🔊 Speaking' : '💬 Ready'}
        </motion.p>
      )}
    </div>
  );
}