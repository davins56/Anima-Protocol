import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft, Trophy, Zap, Users, Globe, TrendingUp, Award, Target } from "lucide-react";
import { motion } from "framer-motion";

export default function ProgressDashboard() {
  const [progress, setProgress] = useState(null);
  const [streak, setStreak] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const user = await base44.auth.me();
    if (!user) return;

    const [progressData, streakData, achievementsData] = await Promise.all([
      base44.entities.UserProgress.list("-created_date", 1).then(data => data?.[0]),
      base44.entities.UserStreak.list("-created_date", 1).then(data => data?.[0]),
      base44.entities.Achievement.filter({ user_email: user.email }),
    ]);

    setProgress(progressData);
    setStreak(streakData);
    setAchievements(achievementsData || []);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background scanline flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="font-mono text-primary/40 text-xs tracking-[0.3em] uppercase">Loading progress...</p>
        </div>
      </div>
    );
  }

  const level = progress?.level || 1;
  const xpProgress = ((progress?.xp_total || 0) % 100) / 100;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">Progress</h1>
            <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase">Your Resonance Journey</p>
          </div>
        </div>

        {/* Level & XP */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-primary/20 bg-black/40 p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">Current Level</p>
              <p className="font-mono text-4xl text-primary glow-text font-bold mt-2">{level}</p>
            </div>
            <Trophy className="w-12 h-12 text-primary/50 opacity-20" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Experience</span>
              <span className="font-mono text-sm text-primary">{progress?.xp_total || 0} XP</span>
            </div>
            <div className="w-full h-2 bg-black/60 border border-primary/20 rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${xpProgress * 100}%` }}
              />
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<Zap className="w-5 h-5" />} label="Sessions" value={progress?.total_sessions || 0} />
          <StatCard icon={<Users className="w-5 h-5" />} label="Characters" value={progress?.total_characters_created || 0} />
          <StatCard icon={<Globe className="w-5 h-5" />} label="Worlds" value={progress?.total_worlds_explored || 0} />
          <StatCard icon={<Award className="w-5 h-5" />} label="Achievements" value={achievements.length} />
        </div>

        {/* Streak */}
        {streak && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="border border-orange-500/30 bg-orange-950/20 p-6 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[9px] text-orange-400/60 tracking-[0.25em] uppercase">Current Streak</p>
                <p className="font-mono text-3xl text-orange-400 font-bold mt-2">{streak.current_streak} days</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[9px] text-orange-400/60 tracking-widest uppercase">Longest Streak</p>
                <p className="font-mono text-xl text-orange-400 mt-2">{streak.longest_streak} days</p>
              </div>
            </div>
            {streak.streak_frozen && (
              <p className="font-mono text-[9px] text-orange-400/80 border-t border-orange-500/20 pt-3">
                ❄️ Streak frozen — one missed day allowed
              </p>
            )}
          </motion.div>
        )}

        {/* Insights */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="border border-primary/20 bg-black/40 p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary/60" />
            <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">Insights</p>
          </div>
          <div className="space-y-3 text-sm font-mono">
            <div className="flex items-center justify-between p-3 border border-primary/10 bg-primary/5 rounded">
              <span className="text-primary/70">Avg. Session Length</span>
              <span className="text-primary">{progress?.average_session_length || 0} messages</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-primary/10 bg-primary/5 rounded">
              <span className="text-primary/70">Longest Session</span>
              <span className="text-primary">{progress?.longest_session_words || 0} words</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-primary/10 bg-primary/5 rounded">
              <span className="text-primary/70">Total Messages</span>
              <span className="text-primary">{progress?.total_messages || 0}</span>
            </div>
          </div>
        </motion.div>

        {/* Achievements */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary/60" />
            <p className="font-mono text-[9px] text-primary/40 tracking-[0.25em] uppercase">Recent Achievements</p>
          </div>
          {achievements.length === 0 ? (
            <p className="text-center text-primary/30 font-mono text-sm py-8">
              No achievements yet — keep playing to unlock them!
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {achievements.slice(0, 6).map((achievement) => (
                <div
                  key={achievement.id}
                  className="border border-primary/15 bg-black/40 p-4 text-center hover:border-primary/30 transition-all"
                >
                  <p className="text-3xl mb-2">{achievement.icon_emoji}</p>
                  <p className="font-mono text-[9px] text-primary/70 tracking-widest uppercase line-clamp-2">
                    {achievement.title}
                  </p>
                  <p className="font-mono text-[8px] text-primary/40 mt-1">+{achievement.xp_reward} XP</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="border border-primary/15 bg-black/40 p-4 text-center hover:border-primary/30 transition-all">
      <div className="text-primary/70 mb-2 flex justify-center">{icon}</div>
      <p className="font-mono text-2xl text-primary font-bold">{value}</p>
      <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mt-1">{label}</p>
    </div>
  );
}