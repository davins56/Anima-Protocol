import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, TrendingUp, TrendingDown, Wind, Heart } from 'lucide-react';

export default function WorldPulseNotification({ sessionId, isVisible = true }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId || !isVisible) return;

    // Fetch latest pulse for this session
    const fetchLatestPulse = async () => {
      try {
        const pulses = await base44.entities.WorldPulse.filter(
          { session_id: sessionId },
          '-pulse_date',
          1
        );
        if (pulses?.length > 0) {
          setPulse(pulses[0]);
        }
      } catch (err) {
        console.error('Error fetching world pulse:', err);
      }
    };

    fetchLatestPulse();

    // Subscribe to new pulses
    const unsubscribe = base44.entities.WorldPulse.subscribe((event) => {
      if (event.type === 'create' && event.data?.session_id === sessionId) {
        setPulse(event.data);
      }
    });

    return unsubscribe;
  }, [sessionId, isVisible]);

  if (!pulse || !isVisible) return null;

  const trendIcon = {
    ascending_growth: <TrendingUp className="w-5 h-5 text-green-400" />,
    introspective_descent: <TrendingDown className="w-5 h-5 text-blue-400" />,
    emotional_turbulence: <Zap className="w-5 h-5 text-yellow-400" />,
    grounded_stability: <Wind className="w-5 h-5 text-cyan-400" />,
  };

  const trendColor = {
    ascending_growth: 'border-green-400/30 bg-green-900/10',
    introspective_descent: 'border-blue-400/30 bg-blue-900/10',
    emotional_turbulence: 'border-yellow-400/30 bg-yellow-900/10',
    grounded_stability: 'border-cyan-400/30 bg-cyan-900/10',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`p-4 border rounded-lg space-y-3 ${trendColor[pulse.emotional_trend] || 'border-primary/20 bg-black/40'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {trendIcon[pulse.emotional_trend] || <Heart className="w-5 h-5 text-primary" />}
            <h3 className="font-mono text-xs tracking-widest uppercase text-primary/80">
              ✦ World Pulse Detected
            </h3>
          </div>
          <span className="font-mono text-[8px] text-primary/40 uppercase tracking-wider">
            {pulse.emotional_trend.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Trend Intensity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] text-primary/50 uppercase tracking-wider">
              Intensity
            </span>
            <div className="flex-1 h-1.5 bg-black/40 border border-primary/15 rounded-full overflow-hidden max-w-[100px]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(pulse.trend_intensity / 10) * 100}%` }}
                className="h-full bg-gradient-to-r from-primary via-cyan-400 to-primary"
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <span className="font-mono text-[9px] text-primary">{pulse.trend_intensity.toFixed(1)}/10</span>
          </div>
        </div>

        {/* Narrative Summary */}
        <p className="font-mono text-[9px] leading-relaxed text-primary/70">
          {pulse.narrative_summary}
        </p>

        {/* World Changes */}
        {pulse.world_changes?.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-primary/10">
            <p className="font-mono text-[8px] text-primary/40 uppercase tracking-wider">
              World Shifts
            </p>
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
              {pulse.world_changes.map((change, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="p-2 bg-black/30 border border-primary/10 rounded text-[8px] space-y-0.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-primary/60" />
                    <span className="text-primary/60 uppercase tracking-wider font-mono">
                      {change.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-primary/50 ml-3 leading-snug">{change.narrative_hook}</p>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Check-in Period */}
        {pulse.check_in_period && (
          <div className="text-[8px] text-primary/30 font-mono border-t border-primary/10 pt-2">
            <span>
              Analysis period: {pulse.check_in_period.check_in_count} check-ins from {pulse.check_in_period.start_date} to {pulse.check_in_period.end_date}
            </span>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}