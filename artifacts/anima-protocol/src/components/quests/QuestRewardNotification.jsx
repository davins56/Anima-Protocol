import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Sparkles, Award, TrendingUp } from 'lucide-react';

export default function QuestRewardNotification({ reward, isVisible = true, onDismiss }) {
  if (!isVisible || !reward) return null;

  const { xp, items, relationships, profile } = reward;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4"
      >
        <div className="border border-gold-400/60 bg-gradient-to-r from-yellow-950/80 to-orange-950/80 rounded-lg shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gold-400/20 flex items-center gap-2 bg-gold-400/10">
            <Award className="w-5 h-5 text-gold-400 animate-bounce" />
            <h3 className="font-mono text-sm text-gold-400 tracking-widest uppercase">Quest Complete!</h3>
          </div>

          {/* Rewards Body */}
          <div className="px-4 py-4 space-y-3">
            {/* XP Reward */}
            {xp > 0 && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="font-mono text-xs text-gold-300">Resonance XP</span>
                </div>
                <span className="font-mono text-sm font-bold text-yellow-300">+{xp}</span>
              </motion.div>
            )}

            {/* Items Reward */}
            {items && items.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-1.5"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span className="font-mono text-xs text-cyan-300">Items Acquired</span>
                </div>
                <div className="pl-6 space-y-1">
                  {items.map((item, idx) => (
                    <motion.div
                      key={item.id || idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + idx * 0.1 }}
                      className="text-[9px] font-mono text-cyan-200"
                    >
                      ✦ {item.name} {item.quantity > 1 ? `×${item.quantity}` : ''}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Profile Update */}
            {profile && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="flex items-center justify-between pt-2 border-t border-gold-400/10"
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  <span className="font-mono text-xs text-purple-300">Resonance Rank</span>
                </div>
                <span className="font-mono text-sm font-bold text-purple-300">{profile.rank}</span>
              </motion.div>
            )}

            {/* Relationship Bonuses */}
            {relationships && relationships.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
                className="pt-2 border-t border-gold-400/10"
              >
                <span className="font-mono text-[9px] text-pink-400/70 tracking-widest uppercase mb-2 block">
                  Relationship Gains
                </span>
                <div className="space-y-0.5">
                  {relationships.map((rel, idx) => (
                    <div key={idx} className="text-[8px] font-mono text-pink-300">
                      +{rel.bonus} affinity ({rel.newScore}/100)
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 bg-gold-400/5 border-t border-gold-400/10">
            <button
              onClick={onDismiss}
              className="w-full text-center font-mono text-[8px] text-gold-400/60 hover:text-gold-400 transition-colors tracking-widest uppercase"
            >
              Dismiss
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}