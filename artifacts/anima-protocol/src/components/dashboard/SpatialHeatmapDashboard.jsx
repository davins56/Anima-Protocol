import { useEffect, useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Flame, Users, Map, Zap } from 'lucide-react';

const INTENSITY_COLORS = {
  low: '#1e3a5f',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#dc2626',
};

const INTENSITY_LABELS = {
  low: '10-30%',
  medium: '30-60%',
  high: '60-85%',
  critical: '85-100%',
};

export default function SpatialHeatmapDashboard({ sessionId, isVisible = true }) {
  const canvasRef = useRef(null);
  const [locations, setLocations] = useState([]);
  const [locationIntensities, setLocationIntensities] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [layer, setLayer] = useState('overall'); // overall, conflict, activity, quests
  const [expandedDetails, setExpandedDetails] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    loadHeatmapData();
  }, [sessionId]);

  const loadHeatmapData = async () => {
    setLoading(true);
    try {
      const [locs, worldState, relationships, quests, emotions] = await Promise.all([
        base44.entities.Location.list('-created_date', 100),
        base44.entities.WorldState.filter({ session_id: sessionId }, '-created_date', 100),
        base44.entities.CharacterRelationship.filter({ session_id: sessionId }, '-created_date', 100),
        base44.entities.Quest.filter({ session_id: sessionId }, '-created_date', 100),
        base44.entities.CharacterEmotionalState.filter({ session_id: sessionId, is_current: true }, '-created_date', 50),
      ]);

      setLocations(locs || []);

      // Calculate intensity scores for each location
      const intensities = {};

      (locs || []).forEach(location => {
        const locName = location.name?.toLowerCase() || '';

        // CONFLICT INTENSITY: based on world events, emotional states, relationship shifts
        const conflictEvents = (worldState || []).filter(w =>
          (w.subject?.toLowerCase().includes(locName) ||
           w.description?.toLowerCase().includes(locName)) &&
          (w.category === 'conflict' || w.category === 'event')
        ).length;

        const highEmotions = (emotions || []).filter(e =>
          e.intensity >= 7 &&
          e.location?.toLowerCase().includes(locName)
        ).length;

        const conflictScore = Math.min(100, (conflictEvents * 15) + (highEmotions * 10));

        // CHARACTER ACTIVITY: based on characters present, interactions, and recent events
        const characterInteractions = (relationships || []).filter(r =>
          r.location?.toLowerCase().includes(locName)
        ).length;

        const recentActivity = (worldState || []).filter(w =>
          w.subject?.toLowerCase().includes(locName)
        ).length;

        const activityScore = Math.min(100, (characterInteractions * 12) + (recentActivity * 8));

        // QUEST POTENTIAL: based on incomplete quests and undiscovered aspects
        const activeQuests = (quests || []).filter(q =>
          q.status === 'available' &&
          q.required_locations?.some(loc => loc?.toLowerCase().includes(locName))
        ).length;

        const unvisited = location.visited ? 0 : 30;
        const questScore = Math.min(100, (activeQuests * 20) + unvisited);

        // OVERALL: weighted combination
        const overallScore = (conflictScore * 0.35) + (activityScore * 0.35) + (questScore * 0.30);

        intensities[location.id] = {
          conflict: conflictScore,
          activity: activityScore,
          quests: questScore,
          overall: overallScore,
          name: location.name,
          x: location.x_coord || Math.random() * 100,
          y: location.y_coord || Math.random() * 100,
          category: location.category,
          visited: location.visited,
        };
      });

      setLocationIntensities(intensities);
    } catch (err) {
      console.error('Error loading heatmap data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Render canvas heatmap
  useEffect(() => {
    renderHeatmap();
  }, [locationIntensities, layer]);

  const renderHeatmap = () => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(locationIntensities).length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Draw gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0a0f1e');
    gradient.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 100; i += 20) {
      const x = (i / 100) * width;
      const y = (i / 100) * height;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw heatmap regions for each location
    const gaussianBlur = (x, y, intensity, radius) => {
      const canvasX = (x / 100) * width;
      const canvasY = (y / 100) * height;

      // Create radial gradient for location
      const radial = ctx.createRadialGradient(canvasX, canvasY, 0, canvasX, canvasY, radius);

      const color = getColorForIntensity(intensity);
      radial.addColorStop(0, color + '40');
      radial.addColorStop(0.5, color + '20');
      radial.addColorStop(1, color + '00');

      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(canvasX, canvasY, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    // Render heatmap layer
    const radius = Math.min(width, height) * 0.08;
    Object.entries(locationIntensities).forEach(([locId, data]) => {
      const intensity = data[layer];
      if (intensity > 0) {
        gaussianBlur(data.x, data.y, intensity, radius);
      }
    });

    // Draw location markers
    Object.entries(locationIntensities).forEach(([locId, data]) => {
      const x = (data.x / 100) * width;
      const y = (data.y / 100) * height;
      const intensity = data[layer];

      // Marker circle
      const color = getColorForIntensity(intensity);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Icon for visited
      if (data.visited) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', x, y);
      }
    });
  };

  const getColorForIntensity = (intensity) => {
    if (intensity >= 85) return INTENSITY_COLORS.critical;
    if (intensity >= 60) return INTENSITY_COLORS.high;
    if (intensity >= 30) return INTENSITY_COLORS.medium;
    return INTENSITY_COLORS.low;
  };

  const getIntensityLabel = (intensity) => {
    if (intensity >= 85) return 'critical';
    if (intensity >= 60) return 'high';
    if (intensity >= 30) return 'medium';
    return 'low';
  };

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;

    // Find clicked location
    let closestLoc = null;
    let closestDist = Infinity;

    Object.entries(locationIntensities).forEach(([locId, data]) => {
      const locX = (data.x / 100) * width;
      const locY = (data.y / 100) * height;
      const distance = Math.sqrt((x - locX) ** 2 + (y - locY) ** 2);

      if (distance < closestDist) {
        closestDist = distance;
        closestLoc = { id: locId, ...data };
      }
    });

    if (closestDist < 30) {
      setSelectedLocation(closestLoc);
    }
  };

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="border border-primary/20 bg-primary/5 rounded p-4">
        <h2 className="font-mono text-lg text-primary tracking-widest uppercase mb-3">
          🗺️ Spatial Heatmap · Narrative Intensity
        </h2>

        {/* Layer Selection */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'overall', label: 'Overall', icon: '📊' },
            { id: 'conflict', label: 'Conflict', icon: '⚔️' },
            { id: 'activity', label: 'Activity', icon: '👥' },
            { id: 'quests', label: 'Quests', icon: '📜' },
          ].map(l => (
            <button
              key={l.id}
              onClick={() => setLayer(l.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded font-mono text-[9px] tracking-widest uppercase transition-all ${
                layer === l.id
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'border-primary/15 text-primary/40 hover:border-primary/30 hover:text-primary/60'
              }`}
            >
              <span>{l.icon}</span>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      {loading ? (
        <div className="flex items-center justify-center py-24 border border-primary/20 bg-black/40 rounded">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Calculating intensities...</p>
          </div>
        </div>
      ) : (
        <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
          <canvas
            ref={canvasRef}
            width={800}
            height={500}
            onClick={handleCanvasClick}
            className="w-full cursor-crosshair bg-black/60"
          />
        </div>
      )}

      {/* Legend */}
      <div className="grid grid-cols-4 gap-2">
        {['low', 'medium', 'high', 'critical'].map(level => (
          <div
            key={level}
            className="p-3 border border-primary/15 bg-black/30 rounded text-center"
          >
            <div
              className="w-full h-8 rounded mb-2 border border-primary/20"
              style={{ backgroundColor: INTENSITY_COLORS[level] }}
            />
            <p className="font-mono text-[8px] text-primary/60 tracking-widest uppercase">
              {level}
            </p>
            <p className="font-mono text-[7px] text-primary/40">
              {INTENSITY_LABELS[level]}
            </p>
          </div>
        ))}
      </div>

      {/* Selected Location Details */}
      <AnimatePresence>
        {selectedLocation && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="border border-primary/20 bg-black/40 rounded overflow-hidden"
          >
            <button
              onClick={() => setExpandedDetails(!expandedDetails)}
              className="w-full flex items-start justify-between p-4 hover:bg-primary/5 transition-colors"
            >
              <div>
                <h3 className="font-mono text-primary tracking-wider uppercase mb-1">
                  📍 {selectedLocation.name}
                </h3>
                <p className="text-[9px] font-mono text-primary/50">
                  Category: {selectedLocation.category}
                </p>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-primary/40 transition-transform ${
                  expandedDetails ? 'rotate-180' : ''
                }`}
              />
            </button>

            <AnimatePresence>
              {expandedDetails && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t border-primary/10 bg-primary/5 p-4 space-y-3"
                >
                  {/* Intensity Grid */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 border border-primary/15 bg-black/30 rounded">
                      <div className="flex items-center gap-2 mb-2">
                        <Flame className="w-3.5 h-3.5 text-red-400" />
                        <span className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                          Conflict
                        </span>
                      </div>
                      <p className="font-mono text-lg text-red-400">
                        {Math.round(selectedLocation.conflict)}%
                      </p>
                      <p className="text-[7px] font-mono text-primary/40 mt-1">
                        {getIntensityLabel(selectedLocation.conflict)}
                      </p>
                    </div>

                    <div className="p-3 border border-primary/15 bg-black/30 rounded">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                          Activity
                        </span>
                      </div>
                      <p className="font-mono text-lg text-cyan-400">
                        {Math.round(selectedLocation.activity)}%
                      </p>
                      <p className="text-[7px] font-mono text-primary/40 mt-1">
                        {getIntensityLabel(selectedLocation.activity)}
                      </p>
                    </div>

                    <div className="p-3 border border-primary/15 bg-black/30 rounded">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-3.5 h-3.5 text-yellow-400" />
                        <span className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
                          Quests
                        </span>
                      </div>
                      <p className="font-mono text-lg text-yellow-400">
                        {Math.round(selectedLocation.quests)}%
                      </p>
                      <p className="text-[7px] font-mono text-primary/40 mt-1">
                        {getIntensityLabel(selectedLocation.quests)}
                      </p>
                    </div>
                  </div>

                  {/* Overall Score */}
                  <div className="p-3 border border-primary/15 bg-black/30 rounded">
                    <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">
                      Overall Narrative Intensity
                    </p>
                    <div className="flex items-end gap-3">
                      <p className="font-mono text-3xl text-primary">
                        {Math.round(selectedLocation.overall)}%
                      </p>
                      <div className="flex-1 h-2 bg-black/60 rounded overflow-hidden border border-primary/20">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-red-500"
                          style={{ width: `${selectedLocation.overall}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  {selectedLocation.visited && (
                    <div className="p-2 bg-green-400/10 border border-green-400/30 rounded">
                      <p className="text-[8px] font-mono text-green-400 tracking-widest uppercase">
                        ✓ Visited
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats Summary */}
      {!loading && Object.keys(locationIntensities).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'High Conflict', count: Object.values(locationIntensities).filter(l => l.conflict >= 60).length },
            { label: 'Active Areas', count: Object.values(locationIntensities).filter(l => l.activity >= 60).length },
            { label: 'Quest Rich', count: Object.values(locationIntensities).filter(l => l.quests >= 60).length },
            { label: 'Visited', count: Object.values(locationIntensities).filter(l => l.visited).length },
          ].map((stat, idx) => (
            <div key={idx} className="p-3 border border-primary/15 bg-black/30 rounded text-center">
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1">
                {stat.label}
              </p>
              <p className="font-mono text-2xl text-primary">
                {stat.count}/{Object.keys(locationIntensities).length}
              </p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}