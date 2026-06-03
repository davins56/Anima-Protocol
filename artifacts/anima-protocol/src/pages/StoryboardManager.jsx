// @ts-check
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import StorypointManager from "@/components/storyboard/StorypointManager";
import { ChevronLeft } from "lucide-react";
import { motion } from "framer-motion";

export default function StoryboardManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(/** @type {Record<string, any> | null} */ (null));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) {
      loadSession();
    }
  }, [sessionId]);

  const loadSession = async () => {
    try {
      const data = await base44.entities.ChatSession.list("-updated_date", 200);
      const found = data.find((s) => s.id === sessionId);
      setSession(found);
    } catch (err) {
      console.error("Error loading session:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase animate-pulse">
            Loading session...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <button
            onClick={() => navigate(`/chat/${sessionId}`)}
            className="flex items-center gap-2 text-primary/40 hover:text-primary transition-colors mb-4 font-mono text-xs tracking-widest uppercase"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Chat
          </button>

          <div>
            <h1 className="text-3xl sm:text-4xl font-mono text-primary glow-text tracking-[0.15em] uppercase mb-2">
              Storyboard
            </h1>
            {session && (
              <p className="text-[10px] font-mono text-primary/40 tracking-widest uppercase">
                {session.title || "Untitled Session"}
              </p>
            )}
          </div>
        </motion.div>

        {/* Content */}
        {sessionId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <StorypointManager sessionId={sessionId} isVisible={true} />
          </motion.div>
        )}
      </div>
    </div>
  );
}