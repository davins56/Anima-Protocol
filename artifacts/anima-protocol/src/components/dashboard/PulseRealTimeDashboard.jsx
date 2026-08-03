import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Zap, AlertCircle, Activity } from 'lucide-react';

export default function PulseRealTimeDashboard({ sessionId, isVisible = true }) {
  const [currentTension, setCurrentTension] = useState(0);
  const [headlines, setHeadlines] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [emotionalStats, setEmotionalStats] = useState({});

  useEffect(() => {
    if (!sessionId) return;
    loadPulseData();
    const interval = setInterval(loadPulseData, 8000); // Refresh every 8s for real-time feel
    return () => clearInterval(interval);
  }, [sessionId]);

  // Ticker animation
  useEffect(() => {
    if (headlines.length === 0) return;
    const tickerInterval = setInterval(() => {
      setTickerIndex(prev => (prev + 1) % headlines.length);
    }, 4000);
    return () => clearInterval(tickerInterval);
  }, [headlines.length]);

  const loadPulseData = async () => {
    try {
      const [worldEvents, emotions, arcs] = await Promise.all([
        base44.entities.WorldState.filter(
          { session_id: sessionId, category: 'event' },
          '-created_date',
          100
        ),
        base44.entities.CharacterEmotionalState.filter(
          { session_id: sessionId, is_current: true },
          '-created_date',
          50
        ),
        base44.entities.NarrativeArc.filter(
          { session_id: sessionId },
          '-created_date',
          20
        ),
      ]);

      // Process headlines from recent events
      const recentHeadlines = (worldEvents || [])
        .slice(0, 10)
        .map(event => ({
          id: event.id,
          title: event.subject,
          description: event.fact || event.description,
          timestamp: event.created_date,
          importance: event.importance || 'normal',
          type: event.category,
        }));
      setHeadlines(recentHeadlines);

      // Calculate current tension from emotional states
      const avgIntensity = emotions && emotions.length > 0
        ? emotions.reduce((sum, e) => sum + (e.intensity || 0), 0) / emotions.length
        : 0;

      const arcActivity = (arcs || []).filter(a => a.status === 'active').length;
      const tension = Math.min(100, avgIntensity * 10 + arcActivity * 5);
      setCurrentTension(tension);

      // Build trend data from emotion history
      const trend = (emotions || [])
        .slice(0, 20)
        .reverse()
        .map((e, idx) => ({
          time: `T-${20 - idx}`,
          tension: e.intensity * 10,
          volatility: Math.random() * 30 + (e.intensity * 5),
        }));
      setTrendData(trend);

      // Calculate emotional stats
      if (emotions && emotions.length > 0) {
        const emotionTypes = {};
        emotions.forEach(e => {
          emotionTypes[e.primary_emotion] = (emotionTypes[e.primary_emotion] || 0) + 1;
        });
        setEmotionalStats(emotionTypes);
      }

      setLoading(false);
    } catch (err) {
      console.error('Pulse data error:', err);
    }
  };

  if (!isVisible) return null;

  const getTensionColor = (value) => {
    if (value >= 80) return 'text-red-500';
    if (value >= 60) return 'text-orange-400';
    if (value >= 40) return 'text-yellow-400';
    return 'text-cyan-400';
  };

  const getTensionBgColor = (value) => {
    if (value >= 80) return 'bg-red-500/10 border-red-500/30';
    if (value >= 60) return 'bg-orange-500/10 border-orange-500/30';
    if (value >= 40) return 'bg-yellow-500/10 border-yellow-500/30';
    return 'bg-cyan-500/10 border-cyan-500/30';
  };

  const activeHeadline = headlines[tickerIndex];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* Main Tension Display */}
      <div className={`border-2 rounded p-6 transition-all ${getTensionBgColor(currentTension)}`}>
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
              📊 Global Story Tension
            </p>
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="flex items-baseline gap-2"
            >
              <span className={`font-mono text-5xl font-bold ${getTensionColor(currentTension)}`}>
                {Math.round(currentTension)}
              </span>
              <span className="font-mono text-[10px] text-primary/50 mb-2">/ 100</span>
            </motion.div>
          </div>
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          >
            <Activity className={`w-8 h-8 ${getTensionColor(currentTension)}`} />
          </motion.div>
        </div>

        {/* Tension Bar */}
        <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-primary/20">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${currentTension}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className={`h-full ${
              currentTension >= 80
                ? 'bg-gradient-to-r from-red-500 to-red-400'
                : currentTension >= 60
                ? 'bg-gradient-to-r from-orange-500 to-orange-400'
                : currentTension >= 40
                ? 'bg-gradient-to-r from-yellow-500 to-yellow-400'
                : 'bg-gradient-to-r from-cyan-500 to-cyan-400'
            }`}
          />
        </div>
      </div>

      {/* Live Ticker */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
        <div className="bg-primary/10 border-b border-primary/10 px-4 py-2 flex items-center gap-2">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Zap className="w-4 h-4 text-primary" />
          </motion.div>
          <span className="font-mono text-[9px] text-primary tracking-widest uppercase">
            Live Narrative Shifts
          </span>
        </div>

        {loading ? (
          <div className="p-4 text-center">
            <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">Loading pulse...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeHeadline && (
              <motion.div
                key={activeHeadline.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 pt-0.5">
                    {activeHeadline.type === 'conflict' && (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    {activeHeadline.type === 'event' && (
                      <Zap className="w-4 h-4 text-yellow-400" />
                    )}
                    {!['conflict', 'event'].includes(activeHeadline.type) && (
                      <TrendingUp className="w-4 h-4 text-primary/60" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-mono text-xs text-primary tracking-wider uppercase">
                      {activeHeadline.title}
                    </h3>
                    <p className="text-[9px] font-mono text-primary/70 mt-1 leading-relaxed">
                      {activeHeadline.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-primary/10">
                  <span className="text-[7px] font-mono text-primary/40">
                    {new Date(activeHeadline.timestamp).toLocaleTimeString()}
                  </span>
                  <div className="flex gap-1">
                    {headlines.map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-1 rounded-full transition-all ${
                          idx === tickerIndex
                            ? 'w-4 bg-primary'
                            : 'w-1.5 bg-primary/20'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Trend Graph */}
      <div className="border border-primary/20 bg-black/40 rounded p-4">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-4">
          📈 Emotional Volatility Trend
        </p>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(96, 165, 250, 0.1)" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#60a5fa', fontSize: 10 }}
                stroke="rgba(96, 165, 250, 0.2)"
              />
              <YAxis
                tick={{ fill: '#60a5fa', fontSize: 10 }}
                stroke="rgba(96, 165, 250, 0.2)"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(26, 26, 46, 0.95)',
                  border: '1px solid rgba(96, 165, 250, 0.3)',
                  borderRadius: '4px',
                }}
                labelStyle={{ color: '#60a5fa' }}
                formatter={(value) => Math.round(value)}
              />
              <Line
                type="monotone"
                dataKey="volatility"
                stroke="#f97316"
                strokeWidth={2}
                isAnimationActive={true}
                dot={false}
                name="Volatility"
              />
              <Line
                type="monotone"
                dataKey="tension"
                stroke="#06b6d4"
                strokeWidth={2}
                isAnimationActive={true}
                dot={false}
                name="Tension"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-32 flex items-center justify-center text-primary/30">
            <p className="font-mono text-[9px]">No trend data yet</p>
          </div>
        )}
      </div>

      {/* Live Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 border border-primary/15 bg-black/30 rounded text-center">
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">
            Recent Events
          </p>
          <p className="font-mono text-2xl text-primary">
            {headlines.length}
          </p>
        </div>
        <div className="p-3 border border-primary/15 bg-black/30 rounded text-center">
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">
            Status
          </p>
          <motion.p
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="font-mono text-sm text-cyan-400"
          >
            LIVE
          </motion.p>
        </div>
        <div className="p-3 border border-primary/15 bg-black/30 rounded text-center">
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">
            Emotions
          </p>
          <p className="font-mono text-sm text-primary">
            {Object.keys(emotionalStats).length}
          </p>
        </div>
      </div>

      {/* Emotion Breakdown */}
      {Object.keys(emotionalStats).length > 0 && (
        <div className="p-3 border border-primary/15 bg-black/30 rounded">
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-3">
            Emotional Breakdown
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(emotionalStats)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([emotion, count]) => (
                <div key={emotion} className="flex items-center justify-between px-2 py-1 bg-primary/5 border border-primary/10 rounded">
                  <span className="text-[8px] font-mono text-primary/70 capitalize">
                    {emotion}
                  </span>
                  <span className="text-[9px] font-mono text-primary font-bold">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}