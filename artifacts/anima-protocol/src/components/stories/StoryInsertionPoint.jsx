import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { X, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function StoryInsertionPoint({ story, onCreateSession, onClose }) {
  const { user, isAuthenticated } = useAuth();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [creatingSession, setCreatingSession] = useState(false);

  // Parse story content on mount
  const loadStoryContent = async () => {
    if (!story?.url) {
      setLoading(false);
      return;
    }

    try {
      const res = await base44.functions.invoke("fetchYnStory", {
        story_url: story.url,
      });

      if (res?.data?.content) {
        const parsed = await base44.functions.invoke("parseYnStory", {
          raw_content: res.data.content,
        });
        setContent(parsed?.data?.segments || []);
      }
    } catch (err) {
      console.error("Error loading story:", err);
      setContent([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStoryContent();
  }, [story]);

  const handleInsertHere = async () => {
    if (selectedIndex === null) return;

    // Check auth - if not authenticated, redirect to login
    if (!isAuthenticated) {
      base44.auth.redirectToLogin(window.location.href);
      return;
    }

    setCreatingSession(true);
    const insertionPoint = content?.[selectedIndex];
    onCreateSession({
      story_title: story.title,
      insertion_index: selectedIndex,
      context_before: content?.slice(0, selectedIndex)?.map(s => s.text).join("\n") || "",
      insertion_prompt: `You are entering the story "${story.title}" at a crucial moment. What do you do next?`,
    });
    onClose();
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      >
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading story content...
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-3xl max-h-[90vh] bg-background border border-primary/30 rounded overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60 sticky top-0">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm">
              {story.title}
            </h2>
            <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest">
              Click a moment to insert yourself
            </p>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Story Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {!content || content.length === 0 ? (
            <div className="text-center py-12">
              <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                Unable to load story segments. Try another story.
              </p>
            </div>
          ) : (
            content.map((segment, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`transition-all cursor-pointer group p-3 border rounded ${
                  selectedIndex === idx
                    ? "border-primary/60 bg-primary/10"
                    : "border-primary/15 bg-black/30 hover:border-primary/40 hover:bg-primary/5"
                }`}
                onClick={() => setSelectedIndex(idx)}
              >
                <p className="font-mono text-[10px] text-primary/60 mb-1.5 tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                  Insert here
                </p>
                <p className="text-[9.5px] font-mono leading-relaxed text-primary/80">
                  {segment.text}
                </p>
              </motion.div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-primary/20 bg-black/60 flex gap-3 sticky bottom-0">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary font-mono text-xs tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleInsertHere}
            disabled={selectedIndex === null || creatingSession}
            className="flex-1 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
          >
            {creatingSession ? (
              <>
                <Loader className="w-3 h-3 animate-spin" />
                Creating
              </>
            ) : (
              "Create What If"
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}