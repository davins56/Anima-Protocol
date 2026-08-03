import { useState, useEffect } from 'react';
import { Mic, MicOff, Send, X, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

export default function VoiceInputPanel({ isOpen, onClose, onSubmit, isLoading }) {
  const { isListening, transcript, interimTranscript, isSupported, startListening, stopListening, resetTranscript } = useSpeechRecognition();
  const [canSubmit, setCanSubmit] = useState(false);

  useEffect(() => {
    setCanSubmit((transcript + interimTranscript).trim().length > 0);
  }, [transcript, interimTranscript]);

  const handleSubmit = () => {
    const fullText = (transcript + interimTranscript).trim();
    if (!fullText) return;

    onSubmit(fullText);
    resetTranscript();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed right-4 w-80 bg-background border border-primary/30 rounded shadow-2xl overflow-hidden flex flex-col z-40"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-black/60">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs text-primary tracking-[0.2em] uppercase">Voice Input</span>
          </div>
          <button
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isSupported ? (
          <div className="p-4 text-center">
            <p className="font-mono text-[9px] text-red-400 tracking-widest uppercase">Not Supported</p>
            <p className="text-[10px] font-mono text-primary/50 mt-2">
              Your browser doesn't support speech recognition. Try Chrome, Edge, or Safari.
            </p>
          </div>
        ) : (
          <>
            {/* Visualizer */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 bg-black/40">
              <motion.div
                animate={isListening ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={{ duration: 1, repeat: isListening ? Infinity : 0 }}
                className="flex items-center justify-center w-20 h-20 rounded-full border-2 border-primary/40 mb-4"
              >
                {isListening ? (
                  <Mic className="w-8 h-8 text-primary animate-pulse" />
                ) : (
                  <MicOff className="w-8 h-8 text-primary/40" />
                )}
              </motion.div>

              <p className="font-mono text-[9px] text-primary/50 tracking-widest uppercase mb-4">
                {isListening ? '🎤 Listening...' : 'Ready to listen'}
              </p>

              {/* Transcript Display */}
              <div className="w-full max-h-20 bg-black/60 border border-primary/20 rounded p-2.5 mb-3 overflow-y-auto">
                <p className="font-mono text-[9px] text-primary/80 leading-relaxed">
                  {transcript || <span className="text-primary/30">Say something...</span>}
                  {interimTranscript && (
                    <span className="italic text-primary/40 ml-1">{interimTranscript}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="px-4 py-3 border-t border-primary/20 bg-black/60 space-y-2">
              <button
                onClick={isListening ? stopListening : startListening}
                disabled={isLoading}
                className={`w-full py-2 border font-mono text-[9px] tracking-widest uppercase transition-all ${
                  isListening
                    ? 'border-red-400/60 bg-red-400/10 text-red-400 hover:bg-red-400/20'
                    : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                } disabled:opacity-30`}
              >
                {isListening ? 'Stop' : 'Start'}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={resetTranscript}
                  disabled={!canSubmit || isLoading}
                  className="flex-1 py-1.5 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-30"
                >
                  Clear
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || isLoading}
                  className="flex-1 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-30 flex items-center justify-center gap-1"
                >
                  {isLoading ? (
                    <>
                      <Loader className="w-3 h-3 animate-spin" />
                      Send
                    </>
                  ) : (
                    <>
                      <Send className="w-3 h-3" />
                      Send
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}