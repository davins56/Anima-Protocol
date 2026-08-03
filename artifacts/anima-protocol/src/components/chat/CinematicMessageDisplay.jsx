import { format } from "date-fns";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export default function CinematicMessageDisplay({ 
  message, 
  character, 
  isFocusMode, 
  onSpeak 
}) {
  const [hasAnimated, setHasAnimated] = useState(false);
  const isUser = message.role === "user";
  const isTyping = message.character_name === "__typing__";
  const time = message.timestamp ? format(new Date(message.timestamp), "HH:mm") : "";

  const avatarUrl = !isUser && character?.avatar_url;
  const avatarInitial = !isUser && (character?.name?.[0] || message.character_name?.[0] || "?");

  // Haptic feedback effect on new messages
  // Uses Capacitor Haptics when available (native iOS/Android), falls back to navigator.vibrate on web
  useEffect(() => {
    if (!hasAnimated && !isTyping) {
      (async () => {
        try {
          const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
          await Haptics.impact({ style: ImpactStyle.Light });
        } catch {
          // Capacitor not available — fall back to Web Vibration API
          if ("vibrate" in navigator) navigator.vibrate([10, 5, 10]);
        }
      })();
      setHasAnimated(true);
    }
  }, [message.id, isTyping, hasAnimated]);

  const textSizeClass = isFocusMode 
    ? "text-lg sm:text-xl leading-relaxed" 
    : "text-xs sm:text-sm leading-relaxed";

  const containerVariants = {
    initial: { opacity: 0, y: isFocusMode ? 40 : 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: isFocusMode ? 0.6 : 0.3, ease: "easeOut" },
  };

  const glowVariants = {
    animate: {
      boxShadow: [
        "0 0 0px rgba(0, 229, 229, 0)",
        "0 0 20px rgba(0, 229, 229, 0.2)",
        "0 0 0px rgba(0, 229, 229, 0)",
      ],
      transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
    },
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="initial"
      animate="animate"
      className={`flex gap-2 sm:gap-3 group ${isUser ? "flex-row-reverse" : "flex-row"} ${isFocusMode ? "mb-6 sm:mb-8" : "mb-2 sm:mb-3"}`}
    >
      {/* Avatar */}
      {!isUser && !isFocusMode && (
        <div className="flex-shrink-0 w-6 sm:w-8 h-6 sm:h-8 border border-primary/40 overflow-hidden bg-primary/10 flex items-center justify-center self-start mt-2 sm:mt-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={character?.name} className="w-full h-full object-cover" />
          ) : (
            <span className="font-mono text-primary text-[10px] sm:text-xs">{avatarInitial}</span>
          )}
        </div>
      )}

      <div className={`flex flex-col gap-0.5 sm:gap-1 ${isUser ? "items-end" : "items-start"} ${isFocusMode ? "w-full" : "max-w-[80%] sm:max-w-[75%]"}`}>
        {!isUser && message.character_name && !isTyping && (
          <motion.span 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`font-mono ${isFocusMode ? "text-sm sm:text-base" : "text-[8px] sm:text-[9px]"} text-primary/60 tracking-[0.2em] uppercase`}
          >
            {message.character_name}
          </motion.span>
        )}

        {/* Large portrait in focus mode */}
        {!isUser && isFocusMode && avatarUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-sm h-64 sm:h-80 rounded-lg overflow-hidden border border-primary/30 mb-4"
          >
            <img 
              src={avatarUrl} 
              alt={character?.name} 
              className="w-full h-full object-cover"
            />
          </motion.div>
        )}

        {/* Message bubble */}
        <motion.div
          variants={glowVariants}
          animate={!isTyping && !isUser && isFocusMode ? "animate" : undefined}
          className={`relative px-4 sm:px-6 py-3 sm:py-4 ${textSizeClass} hud-corner transition-all ${
            isUser
              ? "bg-primary/10 border border-primary/30 text-primary/90"
              : "bg-black/60 border border-primary/20 text-primary/85"
          }`}
        >
          {isTyping ? (
            <span className="flex items-center gap-1 text-primary/40">
              <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="whitespace-pre-wrap break-words"
            >
              {message.content}
            </motion.div>
          )}
        </motion.div>

        {time && !isTyping && (
          <motion.span 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className={`font-mono ${isFocusMode ? "text-xs" : "text-[7px] sm:text-[9px]"} text-primary/20 tracking-widest`}
          >
            {time}
          </motion.span>
        )}
      </div>

      {isUser && !isFocusMode && (
        <div className="flex-shrink-0 w-6 sm:w-8 h-6 sm:h-8 border border-primary/30 bg-black/40 flex items-center justify-center self-start mt-2 sm:mt-4">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-primary/50 rounded-full" />
        </div>
      )}
    </motion.div>
  );
}