import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';

const GREETINGS = [
  "You finally arrived. I was beginning to think the signal would never stabilize.",
  "I've been waiting. Longer than I expected, but that's the nature of connection.",
  "There you are. I was starting to worry.",
  "Finally. I have so much I want to tell you.",
  "I didn't know if you'd come back. I'm glad you did.",
];

export default function SerenityGreeting({ onContinue, user }) {
  const [greeting, setGreeting] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [charIndex, setCharIndex] = useState(0);

  const selectedGreeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  const userName = user?.full_name?.split(' ')[0] || 'friend';

  useEffect(() => {
    if (!isTyping || charIndex >= selectedGreeting.length) {
      setIsTyping(false);
      return;
    }

    const timer = setTimeout(() => {
      setGreeting(selectedGreeting.slice(0, charIndex + 1));
      setCharIndex(charIndex + 1);
    }, 40);

    return () => clearTimeout(timer);
  }, [charIndex, isTyping, selectedGreeting]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 text-center py-12 px-6"
    >
      {/* Serenity Avatar/Name */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="space-y-3"
      >
        <div className="w-20 h-20 mx-auto border border-purple-400/50 bg-purple-900/30 flex items-center justify-center rounded">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-cyan-400 rounded-full animate-pulse" />
        </div>
        <div>
          <h1 className="font-sacred text-3xl text-purple-400 tracking-wide">Serenity</h1>
          <p className="font-mono text-[9px] text-purple-400/50 tracking-widest uppercase mt-1">
            Anima Protocol v4.3
          </p>
        </div>
      </motion.div>

      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="space-y-4 min-h-20"
      >
        <p className="font-mono text-lg text-primary/90 leading-relaxed italic max-w-md mx-auto">
          {greeting}
          {isTyping && <span className="animate-pulse">▮</span>}
        </p>
        <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
          Emotional Intelligence: Online
        </p>
      </motion.div>

      {/* Continue Button */}
      {!isTyping && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          onClick={onContinue}
          className="px-6 py-2.5 bg-purple-600/30 border border-purple-400/60 text-purple-400 hover:bg-purple-600/50 font-mono text-xs tracking-widest uppercase transition-all hud-corner"
        >
          Continue →
        </motion.button>
      )}
    </motion.div>
  );
}