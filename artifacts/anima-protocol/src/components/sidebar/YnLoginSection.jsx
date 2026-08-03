// @ts-check
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, Loader, LogOut, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * @param {{ onStoriesLoaded?: (...args: any[]) => void }} props
 */
export default function YnLoginSection({ onStoriesLoaded }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!inputValue.trim()) return;
    setLoading(true);
    setError("");

    try {
      // Fetch Y/n stories for the user
      const result = await base44.functions.invoke("fetchYnStory", {
        username: inputValue.trim(),
      });

      if (!result) {
        setError("No response from Y/n. Please try again.");
        setLoading(false);
        return;
      }

      const stories = result?.data?.stories || [];
      
      if (stories.length > 0) {
        setUsername(inputValue.trim());
        setIsAuthenticated(true);
        setInputValue("");

        // Load stories as chat sessions
        for (const story of stories) {
          try {
            await base44.entities.ChatSession.create({
              title: story.title || "Imported Y/n Story",
              mode: "solo",
              messages: [
                {
                  role: "assistant",
                  character_name: "Narrator",
                  content: story.content || story.text || "",
                  timestamp: new Date().toISOString(),
                },
              ],
              last_message: (story.content || story.text || "").slice(0, 60),
              _imported_from: "yn",
            });
          } catch (storyErr) {
            console.error("Error creating session for story:", storyErr);
          }
        }

        onStoriesLoaded?.(stories.length);
      } else {
        setError("No stories found for this user");
      }
    } catch (err) {
      console.error("Y/n login error:", err);
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUsername("");
    setInputValue("");
    setError("");
  };

  return (
    <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-primary/10 bg-primary/5">
      <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
        Y/n Stories
      </p>

      <AnimatePresence mode="wait">
        {isAuthenticated ? (
          <motion.div
            key="authenticated"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between px-2 py-1.5 border border-green-500/30 bg-green-500/10 rounded">
              <span className="text-[9px] font-mono text-green-400 tracking-wider">
                @{username}
              </span>
              <Check className="w-3 h-3 text-green-400" />
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all"
            >
              <LogOut className="w-3 h-3" /> Logout
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="login"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setError("");
              }}
              onKeyPress={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Y/n username..."
              disabled={loading}
              className="w-full bg-black/60 border border-primary/20 text-primary/70 placeholder-primary/20 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-50"
            />
            <button
              onClick={handleLogin}
              disabled={!inputValue.trim() || loading}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all"
            >
              {loading ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" /> Loading
                </>
              ) : (
                <>
                  <Upload className="w-3 h-3" /> Load Stories
                </>
              )}
            </button>
            {error && (
              <p className="text-[8px] font-mono text-red-400/70 text-center">
                {error}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}