import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Loader, ChevronLeft, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import ConflictIntensityChart from '@/components/analytics/ConflictIntensityChart';
import HotspotPanel from '@/components/analytics/HotspotPanel';

export default function NarrativeConflictDashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get('session');

  const [chartData, setChartData] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedHotspot, setSelectedHotspot] = useState(null);
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (sessionId) {
      loadConflictAnalysis();
    }
  }, [sessionId]);

  const loadConflictAnalysis = async () => {
    setLoading(true);
    try {
      // Load session data
      const sessions = await base44.entities.ChatSession.filter({ id: sessionId }, "-updated_date", 1);
      setSession(sessions?.[0]);

      // Analyze conflict intensity
      const result = await base44.functions.invoke('analyzeConflictIntensity', {
        session_id: sessionId,
      });

      if (result?.data?.intensity_timeline) {
        setChartData(result.data.intensity_timeline);
        setHotspots(result.data.hotspots || []);
        setStats({
          totalMessages: result.data.total_messages,
          averageIntensity: result.data.average_intensity,
          peakIntensity: result.data.peak_intensity,
        });
      }
    } catch (err) {
      console.error('Error loading conflict analysis:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="lg:hidden text-primary/40 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-[0.2em] uppercase flex items-center gap-3">
              <Zap className="w-8 h-8" />
              Narrative Conflict Dashboard
            </h1>
            <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
              {session?.title || 'Session Analysis'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                Analyzing narrative intensity...
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            {stats && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 sm:grid-cols-3 gap-4"
              >
                <div className="p-4 border border-primary/20 bg-primary/5 rounded">
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                    Total Messages
                  </p>
                  <p className="text-3xl font-mono font-bold text-primary">{stats.totalMessages}</p>
                </div>
                <div className="p-4 border border-cyan-400/20 bg-cyan-400/5 rounded">
                  <p className="text-[9px] font-mono text-cyan-400/40 tracking-widest uppercase mb-2">
                    Average Intensity
                  </p>
                  <p className="text-3xl font-mono font-bold text-cyan-400">{stats.averageIntensity}</p>
                </div>
                <div className="p-4 border border-red-400/20 bg-red-400/5 rounded">
                  <p className="text-[9px] font-mono text-red-400/40 tracking-widest uppercase mb-2">
                    Peak Intensity
                  </p>
                  <p className="text-3xl font-mono font-bold text-red-400">{stats.peakIntensity}</p>
                </div>
              </motion.div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Chart */}
              <div className="lg:col-span-2">
                <ConflictIntensityChart
                  data={chartData}
                  hotspots={hotspots}
                  loading={loading}
                />
              </div>

              {/* Hotspots List */}
              <div>
                <HotspotPanel
                  hotspots={hotspots}
                  onSelectHotspot={setSelectedHotspot}
                />
              </div>
            </div>

            {/* Selected Hotspot Detail */}
            {selectedHotspot && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-6 border border-yellow-400/30 bg-yellow-400/5 rounded space-y-3"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="font-mono text-[9px] text-yellow-400 tracking-widest uppercase">
                    Selected Hot Spot Analysis
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                      Full Message
                    </p>
                    <p className="font-mono text-sm text-primary/80 leading-relaxed">
                      {selectedHotspot.preview}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Character
                      </p>
                      <p className="font-mono text-sm text-primary/80">{selectedHotspot.character}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Intensity Spike
                      </p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-black/30 rounded overflow-hidden">
                          <div
                            className="h-full bg-yellow-400 transition-all"
                            style={{ width: `${selectedHotspot.intensity}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm font-bold text-yellow-400">
                          {selectedHotspot.intensity}/100
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                        Delta Change
                      </p>
                      <p className="font-mono text-sm text-green-400">+{selectedHotspot.delta}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Legend */}
            <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-2">
              <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                💡 Understanding Conflict Intensity
              </p>
              <ul className="text-[9px] font-mono text-primary/60 space-y-1.5">
                <li>• <strong>Intensity Line:</strong> Shows cumulative conflict across the narrative (0-100 scale)</li>
                <li>• <strong>Hot Spots (Markers):</strong> Significant conflict peaks detected in the story</li>
                <li>• <strong>Red Dots:</strong> Extreme intensity (80+) — Major conflicts or turning points</li>
                <li>• <strong>Orange/Yellow:</strong> Moderate to high intensity (60-80) — Important events</li>
                <li>• <strong>Delta:</strong> How much intensity spiked at that moment compared to previous</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}