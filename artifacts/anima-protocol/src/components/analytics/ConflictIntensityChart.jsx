import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts';
import { motion } from 'framer-motion';
import { Zap, TrendingUp, AlertCircle } from 'lucide-react';

export default function ConflictIntensityChart({ data, hotspots, loading }) {
  if (!data || data.length === 0) {
    return (
      <div className="p-6 border border-primary/15 bg-black/40 rounded text-center">
        <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
          No data available
        </p>
      </div>
    );
  }

  const getHotspotColor = (intensity) => {
    if (intensity >= 80) return '#ff4444';
    if (intensity >= 70) return '#ff8833';
    if (intensity >= 60) return '#ffaa00';
    return '#ffdd00';
  };

  return (
    <div className="space-y-4">
      {/* Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 border border-primary/20 bg-black/40 rounded"
      >
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(185, 100%, 50%, 0.1)" />
            <XAxis
              dataKey="message_index"
              stroke="rgba(185, 100%, 50%, 0.3)"
              tick={{ fill: 'rgba(185, 100%, 50%, 0.4)', fontSize: 12 }}
              interval={Math.max(0, Math.floor(data.length / 10))}
            />
            <YAxis
              stroke="rgba(185, 100%, 50%, 0.3)"
              tick={{ fill: 'rgba(185, 100%, 50%, 0.4)', fontSize: 12 }}
              domain={[0, 100]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                border: '1px solid rgba(185, 100%, 50%, 0.3)',
                borderRadius: '4px',
              }}
              labelStyle={{ color: 'rgba(185, 100%, 50%, 0.8)' }}
              formatter={(value) => [`Intensity: ${value}`, 'Conflict']}
              labelFormatter={(idx) => `Message #${idx}`}
            />
            <Legend
              wrapperStyle={{ color: 'rgba(185, 100%, 50%, 0.6)', fontSize: '12px' }}
              formatter={() => 'Conflict Intensity'}
            />
            <Line
              type="monotone"
              dataKey="intensity"
              stroke="rgba(185, 100%, 50%, 0.7)"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />

            {/* Hotspot markers */}
            {hotspots.map((spot) => (
              <ReferenceDot
                key={`hotspot-${spot.message_index}`}
                x={spot.message_index}
                y={spot.intensity}
                r={6}
                fill={getHotspotColor(spot.intensity)}
                stroke={getHotspotColor(spot.intensity)}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-3 border border-cyan-400/20 bg-cyan-400/5 rounded"
        >
          <p className="text-[9px] font-mono text-cyan-400/50 tracking-widest uppercase mb-1">
            Peak Intensity
          </p>
          <p className="text-xl font-mono font-semibold text-cyan-400">{data[data.length - 1]?.intensity || 0}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-3 border border-yellow-400/20 bg-yellow-400/5 rounded"
        >
          <p className="text-[9px] font-mono text-yellow-400/50 tracking-widest uppercase mb-1">
            Avg Intensity
          </p>
          <p className="text-xl font-mono font-semibold text-yellow-400">
            {Math.round(data.reduce((sum, d) => sum + d.intensity, 0) / data.length)}
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-3 border border-red-400/20 bg-red-400/5 rounded"
        >
          <p className="text-[9px] font-mono text-red-400/50 tracking-widest uppercase mb-1">
            Hot Spots
          </p>
          <p className="text-xl font-mono font-semibold text-red-400">{hotspots.length}</p>
        </motion.div>
      </div>
    </div>
  );
}