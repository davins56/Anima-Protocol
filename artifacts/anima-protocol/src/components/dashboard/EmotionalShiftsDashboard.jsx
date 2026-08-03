import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Zap, TrendingUp, Users, AlertCircle } from 'lucide-react';

const EMOTION_COLORS = {
  joyful: '#fbbf24',
  calm: '#34d399',
  sad: '#60a5fa',
  anxious: '#f87171',
  angry: '#fb7185',
  peaceful: '#06b6d4',
  hopeful: '#a78bfa',
  conflicted: '#f472b6',
  neutral: '#9ca3af',
};

const Sparkline = ({ data, emotion }) => {
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <Line
          type="monotone"
          dataKey="intensity"
          stroke={EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral}
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(220 20% 6%)',
            border: `1px solid ${EMOTION_COLORS[emotion]}`,
          }}
          labelFormatter={(label, payload) => {
            if (payload?.[0]?.payload?.emotion) {
              return payload[0].payload.emotion;
            }
            return label;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default function EmotionalShiftsDashboard({ sessionId }) {
  const [data, setData] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [expandedSection, setExpandedSection] = useState('overview');

  useEffect(() => {
    loadDashboardData();
  }, [sessionId]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [shiftData, charData] = await Promise.all([
        base44.functions.invoke('trackEmotionalShifts', { session_id: sessionId }),
        base44.entities.Character.list("-created_date", 100),
      ]);
      
      setData(shiftData?.data);
      setCharacters(charData || []);
    } catch (err) {
      console.error('Error loading emotional shifts:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Analyzing emotional shifts...</p>
        </div>
      </div>
    );
  }

  if (!data || !data.sparklineData) {
    return (
      <div className="flex items-center justify-center h-96 p-4">
        <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase text-center">No emotional data available</p>
      </div>
    );
  }

  const charIds = Object.keys(data.sparklineData);
  const contagionCount = data.contagionEvents?.length || 0;
  const correlationCount = data.correlations?.length || 0;

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-primary/20 bg-black/40 rounded p-3 space-y-1"
        >
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            <span className="font-mono text-[8px] text-yellow-400/60 tracking-widest uppercase">Conflict Intensity</span>
          </div>
          <p className="font-mono text-lg text-yellow-400 tracking-wider">
            {Math.round(data.overallConflictIntensity || 0)}%
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="border border-primary/20 bg-black/40 rounded p-3 space-y-1"
        >
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono text-[8px] text-cyan-400/60 tracking-widest uppercase">Contagion Events</span>
          </div>
          <p className="font-mono text-lg text-cyan-400 tracking-wider">{contagionCount}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="border border-primary/20 bg-black/40 rounded p-3 space-y-1"
        >
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-pink-400" />
            <span className="font-mono text-[8px] text-pink-400/60 tracking-widest uppercase">Correlations</span>
          </div>
          <p className="font-mono text-lg text-pink-400 tracking-wider">{correlationCount}</p>
        </motion.div>
      </div>

      {/* Character Emotional Timelines */}
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
        <button
          onClick={() => setExpandedSection(expandedSection === 'timelines' ? null : 'timelines')}
          className="w-full px-4 py-2 border-b border-primary/10 bg-primary/5 flex items-center justify-between text-left hover:bg-primary/10 transition-colors"
        >
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            📊 Character Emotional Timelines ({charIds.length})
          </span>
          <span className={`text-primary/40 transition-transform ${expandedSection === 'timelines' ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>

        <AnimatePresence>
          {expandedSection === 'timelines' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 space-y-4 max-h-96 overflow-y-auto"
            >
              {charIds.map((charId) => {
                const char = characters.find(c => c.id === charId);
                const timeline = data.sparklineData[charId];
                const lastState = timeline[timeline.length - 1];

                return (
                  <motion.div
                    key={charId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-primary/15 bg-black/60 rounded p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs text-primary tracking-wider uppercase">
                          {char?.name || charId}
                        </p>
                        <p className="text-[8px] text-primary/50 mt-0.5 capitalize">
                          Current: {lastState?.emotion || 'unknown'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div
                          className="w-6 h-6 rounded-full border-2"
                          style={{
                            backgroundColor: EMOTION_COLORS[lastState?.emotion],
                            borderColor: EMOTION_COLORS[lastState?.emotion],
                            opacity: 0.3,
                          }}
                        />
                        <span className="text-[8px] font-mono text-primary/60">
                          {lastState?.intensity || 0}/10
                        </span>
                      </div>
                    </div>

                    {/* Sparkline */}
                    <div className="h-10">
                      <Sparkline data={timeline} emotion={lastState?.emotion} />
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Emotional Contagion Events */}
      {contagionCount > 0 && (
        <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
          <button
            onClick={() => setExpandedSection(expandedSection === 'contagion' ? null : 'contagion')}
            className="w-full px-4 py-2 border-b border-primary/10 bg-primary/5 flex items-center justify-between text-left hover:bg-primary/10 transition-colors"
          >
            <span className="font-mono text-[9px] text-cyan-400/60 tracking-widest uppercase">
              🔗 Emotional Contagion ({contagionCount} events)
            </span>
            <span className={`text-primary/40 transition-transform ${expandedSection === 'contagion' ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>

          <AnimatePresence>
            {expandedSection === 'contagion' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 space-y-2 max-h-60 overflow-y-auto"
              >
                {(data.contagionEvents || []).map((event, idx) => {
                  const sourceChar = characters.find(c => c.id === event.sourceCharacterId);
                  const targetChar = characters.find(c => c.id === event.targetCharacterId);

                  return (
                    <div key={idx} className="text-[8px] font-mono text-primary/70 border border-primary/10 bg-black/30 rounded p-2 space-y-1">
                      <p>
                        <span className="text-cyan-400">{sourceChar?.name}</span>
                        {' → '}
                        <span className="text-cyan-400">{targetChar?.name}</span>
                      </p>
                      <p className="text-primary/50">
                        Emotion: <span style={{ color: EMOTION_COLORS[event.emotion] }} className="capitalize">{event.emotion}</span>
                        {' • '}Intensity: {event.intensity}/10
                      </p>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Conflict-Emotion Correlations */}
      {correlationCount > 0 && (
        <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
          <button
            onClick={() => setExpandedSection(expandedSection === 'correlations' ? null : 'correlations')}
            className="w-full px-4 py-2 border-b border-primary/10 bg-primary/5 flex items-center justify-between text-left hover:bg-primary/10 transition-colors"
          >
            <span className="font-mono text-[9px] text-pink-400/60 tracking-widest uppercase">
              ⚡ Conflict-Emotion Spikes ({correlationCount})
            </span>
            <span className={`text-primary/40 transition-transform ${expandedSection === 'correlations' ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>

          <AnimatePresence>
            {expandedSection === 'correlations' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 space-y-2 max-h-60 overflow-y-auto"
              >
                {(data.correlations || []).map((corr, idx) => {
                  const char = characters.find(c => c.id === corr.characterId);

                  return (
                    <div key={idx} className="text-[8px] font-mono border border-pink-400/20 bg-pink-400/5 rounded p-2 space-y-1">
                      <p className="text-pink-400">
                        {char?.name} • {corr.emotion}
                      </p>
                      <div className="flex items-center justify-between text-primary/60">
                        <span>Emotional: {corr.emotionalIntensity}/10</span>
                        <span>Conflict: {corr.conflictIntensity}%</span>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}