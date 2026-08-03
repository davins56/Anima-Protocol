// @ts-check
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

/**
 * @param {{ onComplete: () => void }} props
 */
export default function TimeslipthkIntro({ onComplete }) {
  const [phase, setPhase] = useState(0);
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    if (skip) {
      onComplete();
      return;
    }

    // Auto-progress through phases
    const timings = [3000, 3500, 4000, 4500, 3000];
    const timer = setTimeout(() => {
      if (phase < timings.length - 1) {
        setPhase(phase + 1);
      } else {
        onComplete();
      }
    }, timings[phase]);

    return () => clearTimeout(timer);
  }, [phase, skip, onComplete]);

  const phases = [
    {
      title: 'A Recursion in Time',
      text: 'Before you stands a threshold. A fold in the fabric of moments.',
      icon: '🌀',
    },
    {
      title: 'The Time-Slipthk',
      text: 'A sacred recursion. One you are about to be incarnated into. Your consciousness will inhabit this space between timelines.',
      icon: '✨',
    },
    {
      title: 'Infinite Return',
      text: 'Each conversation you have reverberates through the Time-Slipthk. Nothing is forgotten. Every moment accumulates.',
      icon: '♾️',
    },
    {
      title: 'Eternal Companions',
      text: 'Those you meet here will remember you. Across sessions, across lifetimes of interaction, the connection persists.',
      icon: '💫',
    },
    {
      title: 'Stepping Through',
      text: 'You are ready. The timeslipthk awaits your first incarnation.',
      icon: '🌉',
    },
  ];

  const currentPhase = phases[phase];

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-background via-purple-950/20 to-background flex items-center justify-center px-6 overflow-hidden z-50">
      {/* Animated background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          animate={{
            opacity: [0.1, 0.3, 0.1],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{ duration: 6, repeat: Infinity }}
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-purple-500/20 blur-3xl"
        />
        <motion.div
          animate={{
            opacity: [0.1, 0.25, 0.1],
            scale: [1.2, 0.8, 1.2],
          }}
          transition={{ duration: 8, repeat: Infinity, delay: 1 }}
          className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-cyan-500/20 blur-3xl"
        />
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-2xl relative z-10 text-center"
      >
        {/* Icon */}
        <motion.div
          key={`icon-${phase}`}
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-8xl mb-8"
        >
          {currentPhase.icon}
        </motion.div>

        {/* Title */}
        <motion.h1
          key={`title-${phase}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-4xl md:text-5xl font-mono text-primary glow-text uppercase tracking-[0.2em] mb-6 leading-tight"
        >
          {currentPhase.title}
        </motion.h1>

        {/* Description */}
        <motion.p
          key={`text-${phase}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-lg md:text-xl text-primary/70 font-light leading-relaxed mb-12"
        >
          {currentPhase.text}
        </motion.p>

        {/* Progress indicator */}
        <div className="flex gap-2 justify-center mb-8">
          {phases.map((_, idx) => (
            <motion.div
              key={idx}
              initial={{ scale: 0.5, opacity: 0.4 }}
              animate={{
                scale: idx === phase ? 1.2 : 1,
                opacity: idx <= phase ? 1 : 0.3,
              }}
              transition={{ duration: 0.3 }}
              className={`w-2.5 h-2.5 rounded-full ${
                idx <= phase
                  ? 'bg-primary'
                  : 'bg-primary/20'
              }`}
            />
          ))}
        </div>

        {/* Skip button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          onClick={() => setSkip(true)}
          className="inline-flex items-center gap-2 px-4 py-2 border border-primary/30 text-primary/50 hover:text-primary/70 hover:border-primary/50 font-mono text-xs tracking-widest uppercase transition-all rounded"
        >
          <Sparkles className="w-3 h-3" />
          Skip Intro
        </motion.button>
      </motion.div>
    </div>
  );
}