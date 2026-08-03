import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Legend,
} from "recharts";
import { motion } from "framer-motion";
import { Loader } from "lucide-react";
import { base44 } from "@/api/base44Client";

const toneValues = {
  uplifting: 8,
  serene: 6,
  melancholic: 3,
  tense: 7,
  ominous: 2,
  optimistic: 7,
  turbulent: 4,
  crisis: 1,
  complex: 5,
};

export default function NarrativeToneChart({ sessionId }) {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) {
      generateToneData();
    }
  }, [sessionId]);

  const generateToneData = async () => {
    setLoading(true);
    try {
      // Fetch all snapshots for this session
      const snapshots = await base44.entities.WorldSnapshot.filter(
        { session_id: sessionId },
        "created_date",
        100
      );

      // Fetch narrative arcs
      const arcs = await base44.entities.NarrativeArc.list("-created_date", 100);

      // Build data points for each snapshot/chapter
      const data = (snapshots || []).map((snap, idx) => {
        const arcInvolved = arcs?.find(a =>
          a.related_sessions?.includes(sessionId)
        );

        return {
          name: snap.branch_name.slice(0, 15),
          tone: toneValues[snap.political_outcome?.toLowerCase()] || 5,
          intensity: snap.emotional_weight || 5,
          depth: snap.depth || idx,
          events: snap.key_events?.length || 0,
        };
      });

      if (data.length === 0) {
        // Generate synthetic data if no snapshots
        setChartData([
          { name: "Opening", tone: 6, intensity: 4, depth: 0, events: 2 },
          { name: "Conflict", tone: 3, intensity: 8, depth: 1, events: 5 },
          { name: "Resolution", tone: 7, intensity: 6, depth: 2, events: 3 },
        ]);
      } else {
        setChartData(data);
      }
    } catch (err) {
      console.error("Error generating tone data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 border border-primary/20 bg-black/30 rounded text-center">
        <Loader className="w-4 h-4 text-primary/60 animate-spin mx-auto mb-2" />
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Building tone chart...
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/30 rounded p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm text-primary/80 tracking-widest uppercase">
          Narrative Tone Progression
        </h3>
        <span className="text-[8px] font-mono text-primary/40">
          {chartData.length} chapters tracked
        </span>
      </div>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 30, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(185 50% 15%)" />
            <XAxis
              dataKey="name"
              stroke="hsl(185 30% 40%)"
              style={{ fontSize: "10px", fontFamily: "monospace" }}
            />
            <YAxis
              stroke="hsl(185 30% 40%)"
              style={{ fontSize: "10px", fontFamily: "monospace" }}
              domain={[0, 10]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(220 20% 6%)",
                border: "1px solid hsl(185 100% 50%)",
                borderRadius: "4px",
              }}
              labelStyle={{ color: "hsl(185 100% 50%)", fontFamily: "monospace" }}
              formatter={(value) => Math.round(value)}
            />
            <Legend
              wrapperStyle={{ paddingTop: "10px" }}
              labelStyle={{ color: "hsl(185 30% 50%)", fontSize: "10px", fontFamily: "monospace" }}
            />
            <Line
              type="monotone"
              dataKey="tone"
              stroke="hsl(185 100% 50%)"
              strokeWidth={2}
              dot={{ fill: "hsl(185 100% 50%)", r: 3 }}
              name="Narrative Tone (Positivity)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="intensity"
              fill="hsl(185 80% 40%)"
              opacity={0.4}
              name="Emotional Intensity"
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-[9px] font-mono text-primary/30 py-8">
          No narrative data yet. Create branches to see tone shifts.
        </p>
      )}

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 text-[8px] font-mono border-t border-primary/10 pt-3">
        <div className="flex items-center gap-2 text-primary/60">
          <div className="w-2 h-0.5 bg-cyan-400" />
          <span>Tone (0=Dark, 10=Uplifting)</span>
        </div>
        <div className="flex items-center gap-2 text-primary/60">
          <div className="w-2 h-2 bg-cyan-500/40" />
          <span>Emotional Intensity</span>
        </div>
      </div>
    </motion.div>
  );
}