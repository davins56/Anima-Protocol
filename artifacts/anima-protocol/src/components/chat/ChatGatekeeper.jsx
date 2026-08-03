import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';

export default function ChatGatekeeper({ isCheckInRequired, children }) {
  if (!isCheckInRequired) {
    return children;
  }

  return (
    <div className="relative">
      {/* Frozen content behind blur */}
      <div className="blur-sm pointer-events-none">
        {children}
      </div>

      {/* Overlay & message */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-md rounded gap-4"
      >
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Lock className="w-8 h-8 text-cyan-400" />
        </motion.div>
        <div className="text-center space-y-2">
          <p className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">Story Paused</p>
          <p className="font-mono text-[10px] text-primary/60 max-w-xs">
            Complete your daily check-in ritual to unlock the story and let the world respond to your growth.
          </p>
        </div>
      </motion.div>
    </div>
  );
}