import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, TrendingUp, Activity, Brain } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const moodColors = {
  joyful: "#4ade80",
  calm: "#60a5fa",
  sad: "#06b6d4",
  anxious: "#f97316",
  angry: "#ef4444",
  peaceful: "#8b5cf6",
  hopeful: "#eab308",
  conflicted: "#ec4899",
  neutral: "#6b7280"
};

export default function Insights() {
  const [checkIns, setCheckIns] = useState([]);
  const [reflections, setReflections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [cis, refs] = await Promise.all([
      base44.entities.CheckIn.list('-created_date', 100),
      base44.entities.Reflection.list('-created_date', 100),
    ]);
    setCheckIns(cis || []);
    setReflections(refs || []);
    setLoading(false);
  };

  // Prepare mood trend data
  const moodTrendData = checkIns
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(ci => ({
      date: new Date(ci.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      mood: ci.mood,
      intensity: ci.mood_intensity,
      timestamp: ci.timestamp
    }))
    .slice(-30);

  // Mood distribution
  const moodCounts = {};
  checkIns.forEach(ci => {
    moodCounts[ci.mood] = (moodCounts[ci.mood] || 0) + 1;
  });
  const moodDistribution = Object.entries(moodCounts).map(([mood, count]) => ({
    name: mood,
    value: count,
    color: moodColors[mood]
  }));

  // Intensity trend
  const intensityData = checkIns
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((ci, idx) => ({
      date: `Day ${idx + 1}`,
      intensity: ci.mood_intensity || 0
    }))
    .slice(-30);

  // Growth metrics
  const breakthroughs = reflections.filter(r => r.tags?.includes('breakthrough')).length;
  const shadowWorkSessions = reflections.filter(r => r.tags?.includes('shadow-work')).length;
  const avgIntensity = checkIns.length > 0 ? (checkIns.reduce((sum, ci) => sum + (ci.mood_intensity || 0), 0) / checkIns.length).toFixed(1) : 0;

  // Dominant mood
  const dominantMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
              // Personal Insights
            </h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
              Your emotional evolution & growth metrics
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 pb-24 lg:pb-6 space-y-8">
        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
            Loading insights...
          </div>
        ) : (
          <>
            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="Breakthroughs"
                value={breakthroughs}
                color="text-green-400"
              />
              <MetricCard
                icon={<Brain className="w-5 h-5" />}
                label="Shadow Work Sessions"
                value={shadowWorkSessions}
                color="text-purple-400"
              />
              <MetricCard
                icon={<Activity className="w-5 h-5" />}
                label="Avg Emotional Intensity"
                value={avgIntensity}
                color="text-yellow-400"
              />
              <MetricCard
                icon={<Activity className="w-5 h-5" />}
                label="Dominant Mood"
                value={dominantMood}
                color="text-cyan-400"
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Mood Intensity Trend */}
              <div className="border border-primary/15 bg-black/40 p-6 hud-corner">
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-4">Emotional Intensity Trend</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={intensityData}>
                    <CartesianGrid stroke="hsl(185 50% 20%)" />
                    <XAxis stroke="hsl(185 100% 50% / 0.5)" />
                    <YAxis stroke="hsl(185 100% 50% / 0.5)" />
                    <Tooltip contentStyle={{ background: '#0a0f1e', border: '1px solid hsl(185 100% 50% / 0.3)' }} />
                    <Line type="monotone" dataKey="intensity" stroke="hsl(185 100% 50%)" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Mood Distribution */}
              <div className="border border-primary/15 bg-black/40 p-6 hud-corner">
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-4">Mood Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={moodDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.name} (${entry.value})`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {moodDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0a0f1e', border: '1px solid hsl(185 100% 50% / 0.3)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Mood Timeline */}
            {moodTrendData.length > 0 && (
              <div className="border border-primary/15 bg-black/40 p-6 hud-corner">
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-4">Mood Timeline (Last 30 Days)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={moodTrendData}>
                    <CartesianGrid stroke="hsl(185 50% 20%)" />
                    <XAxis stroke="hsl(185 100% 50% / 0.5)" dataKey="date" angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke="hsl(185 100% 50% / 0.5)" />
                    <Tooltip
                      contentStyle={{ background: '#0a0f1e', border: '1px solid hsl(185 100% 50% / 0.3)' }}
                      formatter={(value, name) => {
                        if (name === 'intensity') return [value, 'Intensity'];
                        return value;
                      }}
                    />
                    <Bar
                      dataKey="intensity"
                      fill="hsl(185 100% 50%)"
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Insights Summary */}
            <div className="border border-primary/15 bg-black/40 p-6 hud-corner">
              <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-4">Reflection Summary</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="border border-primary/10 p-3">
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Total Reflections</p>
                  <p className="font-mono text-xl text-primary">{reflections.length}</p>
                </div>
                <div className="border border-primary/10 p-3">
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Check-Ins</p>
                  <p className="font-mono text-xl text-primary">{checkIns.length}</p>
                </div>
                <div className="border border-primary/10 p-3">
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">Growth Rate</p>
                  <p className="font-mono text-xl text-green-400">{reflections.length > 0 ? ((breakthroughs / reflections.length) * 100).toFixed(0) : 0}%</p>
                </div>
              </div>
            </div>

            <Link to="/reflections" className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase hud-corner glow-border transition-all">
              View Full Reflections Journal →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, color }) {
  return (
    <div className="border border-primary/15 bg-black/40 p-4 hud-corner">
      <div className="flex items-center gap-2 mb-2">
        <div className={`${color}`}>{icon}</div>
        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">{label}</p>
      </div>
      <p className={`font-mono text-2xl ${color}`}>{value}</p>
    </div>
  );
}