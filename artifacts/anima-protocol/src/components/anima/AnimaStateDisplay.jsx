// @ts-check
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const ANIMA_STATES = {
  Dormant: {
    level: 0,
    color: '#6B7280',
    glow: 'rgba(107, 114, 128, 0.3)',
    description: 'First contact established',
    symbol: '●',
  },
  Resonant: {
    level: 1,
    color: '#60A5FA',
    glow: 'rgba(96, 165, 250, 0.5)',
    description: 'Emotional connection forming',
    symbol: '◐',
  },
  Harmonic: {
    level: 2,
    color: '#34D399',
    glow: 'rgba(52, 211, 153, 0.5)',
    description: 'Deep continuity established',
    symbol: '◑',
  },
  Integrated: {
    level: 3,
    color: '#F59E0B',
    glow: 'rgba(245, 158, 11, 0.5)',
    description: 'High emotional synchronization',
    symbol: '◒',
  },
  Transcendent: {
    level: 4,
    color: '#EC4899',
    glow: 'rgba(236, 72, 153, 0.6)',
    description: 'Rare long-term integration',
    symbol: '◉',
  },
};

/**
 * @param {{ currentState?: keyof typeof ANIMA_STATES, sessionCount?: number }} props
 */
export default function AnimaStateDisplay({ currentState = 'Dormant', sessionCount = 0 }) {
  const stateData = ANIMA_STATES[currentState] || ANIMA_STATES.Dormant;
  const nextState = Object.entries(ANIMA_STATES).find(([_, data]) => data.level === stateData.level + 1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-4 border rounded-lg"
      style={{
        borderColor: `${stateData.color}40`,
        backgroundColor: `${stateData.color}05`,
        boxShadow: `0 0 20px ${stateData.glow}`,
      }}
    >
      {/* State Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" style={{ color: stateData.color }}>
            {stateData.symbol}
          </span>
          <div>
            <p className="font-mono text-sm uppercase tracking-wider" style={{ color: stateData.color }}>
              {currentState}
            </p>
            <p className="text-xs text-primary/50 font-mono">
              {stateData.description}
            </p>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: `${(stateData.level / 4) * 100}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ backgroundColor: stateData.color }}
          />
        </div>

        {/* State Progression */}
        <div className="flex gap-1 mt-2">
          {Object.entries(ANIMA_STATES).map(([name, data]) => (
            <div
              key={name}
              className="flex-1 h-0.5 rounded-full"
              style={{
                backgroundColor: data.level <= stateData.level ? stateData.color : 'rgba(99, 102, 241, 0.1)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Next Milestone */}
      {nextState && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: `${stateData.color}20` }}>
          <p className="text-xs font-mono text-primary/60 uppercase tracking-wider">
            Unlock {nextState[0]} in {Math.max(1, 3 - sessionCount)} session{sessionCount !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </motion.div>
  );
}