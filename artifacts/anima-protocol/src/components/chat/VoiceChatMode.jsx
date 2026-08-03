import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Volume2, X, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function VoiceChatMode({
  isOpen,
  onClose,
  character,
  onUserMessage,
  isLoading,
  onCharacterRespond,
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef(null);
  const [speechSupported, setSpeechSupported] = useState(false);

  useEffect(() => {
    // Check for speech recognition support
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);

      recognitionRef.current.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptSegment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            setTranscript((prev) => prev + transcriptSegment + " ");
          } else {
            interim += transcriptSegment;
          }
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
      };
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current || !speechSupported) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleSendTranscript = async () => {
    if (transcript.trim()) {
      const userText = transcript.trim();
      setTranscript("");
      setIsSpeaking(true);
      try {
        await onUserMessage(userText, onCharacterRespond);
      } finally {
        setIsSpeaking(false);
      }
    }
  };

  const handleClearTranscript = () => {
    setTranscript("");
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          className="w-full max-w-2xl bg-background border border-primary/30 rounded-lg shadow-2xl overflow-hidden"
          layout
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60">
            <div className="flex items-center gap-3">
              <Mic className="w-5 h-5 text-primary" />
              <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                Voice Mode
              </h2>
              {character && (
                <span className="text-[9px] font-mono text-primary/50 tracking-widest">
                  • {character.name}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-primary/30 hover:text-primary transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {!speechSupported ? (
              <div className="text-center py-8">
                <p className="font-mono text-[9px] text-red-400 tracking-widest uppercase mb-2">
                  Speech Recognition Not Supported
                </p>
                <p className="text-[10px] text-primary/50">
                  Your browser doesn't support voice input. Try Chrome, Edge, or Safari.
                </p>
              </div>
            ) : (
              <>
                {/* Microphone Input */}
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-4">
                    {/* Listening Indicator */}
                    <motion.div
                      animate={isListening ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                      transition={{ duration: 1, repeat: isListening ? Infinity : 0 }}
                      className="flex items-center justify-center w-20 h-20 rounded-full border-2 border-primary/40"
                    >
                      {isListening ? (
                        <Mic className="w-8 h-8 text-primary animate-pulse" />
                      ) : (
                        <MicOff className="w-8 h-8 text-primary/40" />
                      )}
                    </motion.div>

                    <p className="font-mono text-[9px] text-primary/50 tracking-widest uppercase">
                      {isListening ? "🎤 Listening..." : "Click to start speaking"}
                    </p>
                  </div>

                  {/* Toggle Button */}
                  <button
                    onClick={toggleListening}
                    disabled={isLoading}
                    className={`w-full py-3 border-2 font-mono text-sm tracking-widest uppercase transition-all ${
                      isListening
                        ? "border-red-400/60 bg-red-400/10 text-red-400 hover:bg-red-400/20"
                        : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                    } disabled:opacity-50`}
                  >
                    {isListening ? "Stop Recording" : "Start Recording"}
                  </button>
                </div>

                {/* Transcript Display */}
                <div className="space-y-2">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                    Transcript
                  </p>
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="Your speech will appear here..."
                    className="w-full h-24 bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm p-3 focus:outline-none focus:border-primary/50 rounded"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={handleClearTranscript}
                    className="flex-1 px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-xs tracking-widest uppercase transition-all"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleSendTranscript}
                    disabled={!transcript.trim() || isLoading || isSpeaking}
                    className="flex-1 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                  >
                    {isLoading || isSpeaking ? (
                      <>
                        <Loader className="w-3 h-3 animate-spin" />
                        {isSpeaking ? "Playing" : "Processing"}
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3 h-3" />
                        Send & Speak Response
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}