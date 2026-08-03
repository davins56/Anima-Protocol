import { useState } from "react";
import { Upload, FileText, X, Loader, Lock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { useBiometricAuth } from "@/hooks/useBiometricAuth";
import { useConfirm } from "@/lib/ConfirmDialog";

export default function YnStoryImporter({ onClose }) {
  const [mode, setMode] = useState("paste"); // "paste" or "upload"
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { authenticate, isAuthenticating, isSupported } = useBiometricAuth();

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setContent(event.target.result || "");
      setError("");
    };
    reader.onerror = () => setError("Failed to read file");
    reader.readAsText(file);
  };

  const handleLoginToYn = () => {
    // Take user to Anima local login/onboarding flow
    // (The old behavior opened https://yn.app/login in a new tab.)
    window.location.href = "/onboarding";
  };


  const handleImport = async () => {
    if (!content.trim()) {
      setError("Please provide a story link, paste text, or upload a file");
      return;
    }

    // If importing from link and not authenticated with Y/n, prompt login
    if (mode === "link" && !content.includes("localhost")) {
      const confirmed = await confirm({
        heading: "Login",
        title: "Log in to Y/n first?",
        message:
          "You may need to be logged into Y/n to access this story. Log in before importing?",
        confirmLabel: "Log In",
        cancelLabel: "Not Now",
      });
      if (confirmed) {
        handleLoginToYn();
        return;
      }
    }

    // Prompt for biometric authentication if supported
    if (isSupported) {
      try {
        await authenticate();
      } catch (err) {
        setError(err.message || "Biometric authentication failed");
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      if (mode === "username") {
        // Fetch stories by username
        const result = await base44.functions.invoke("fetchYnStoryByUsername", {
          username: content.trim(),
        });
        
        const stories = result?.data?.stories || result?.stories || [];
        if (stories.length === 0) {
          throw new Error("No stories found for this user");
        }

        // Create sessions for each story
        let createdCount = 0;
        for (const story of stories) {
          try {
            const storyContent = story.content || story.text || story.body || "";
            if (!storyContent) continue;
            
            await base44.entities.ChatSession.create({
              title: story.title || story.name || "Imported Y/n Story",
              mode: "solo",
              messages: [
                {
                  role: "assistant",
                  character_name: "Narrator",
                  content: storyContent,
                  timestamp: new Date().toISOString(),
                },
              ],
              last_message: storyContent.slice(0, 60),
              _imported_from: "yn",
            });
            createdCount++;
          } catch (storyErr) {
            console.error("Error creating session:", storyErr);
          }
        }

        if (createdCount === 0) {
          throw new Error("Failed to import any stories");
        }

        navigate("/");
        onClose?.();
      } else {
        // Parse pasted or uploaded content
        const result = await base44.functions.invoke("parseYnStory", {
          content: content.trim(),
        });
        const sessionId = result?.data?.session_id || result?.session_id;
        if (!sessionId) {
          throw new Error(result?.data?.error || result?.error || "Failed to import story");
        }
        navigate(`/chat/${sessionId}`);
        onClose?.();
      }
    } catch (err) {
      console.error("Import error:", err);
      setError(err.message || "Failed to import story");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
    <div className="w-full max-w-2xl h-[90vh] sm:max-h-[90vh] bg-background border border-primary/30 hud-corner glow-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-6 border-b border-primary/20 flex-shrink-0">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
              // Import Y/n Story
            </h2>
            <p className="text-[10px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
              Paste or upload Y/n story text to convert into a narrative session
            </p>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="flex border-b border-primary/20 text-[10px] sm:text-xs">
          <button
            onClick={() => { setMode("paste"); setError(""); }}
            className={`flex-1 py-3 font-mono tracking-widest uppercase transition-all ${
              mode === "paste"
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-primary/30 hover:text-primary/60 border-b-2 border-transparent"
            }`}
          >
            Paste Text
          </button>
          <button
            onClick={() => { setMode("upload"); setError(""); }}
            className={`flex-1 py-3 font-mono tracking-widest uppercase transition-all ${
              mode === "upload"
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-primary/30 hover:text-primary/60 border-b-2 border-transparent"
            }`}
          >
            Upload File
          </button>
          <button
            onClick={() => { setMode("username"); setError(""); }}
            className={`flex-1 py-3 font-mono tracking-widest uppercase transition-all ${
              mode === "username"
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-primary/30 hover:text-primary/60 border-b-2 border-transparent"
            }`}
          >
            Y/n Profile
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 min-h-0">
          {mode === "paste" ? (
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setError(""); }}
              placeholder="Paste your Y/n story here... (supports markdown, plain text, or JSON format)"
              className="w-full h-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-3 resize-none focus:outline-none focus:border-primary/50 focus:bg-primary/5 transition-colors"
            />
          ) : mode === "upload" ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-16 h-16 border-2 border-primary/30 border-dashed rounded flex items-center justify-center">
                <Upload className="w-6 h-6 text-primary/40" />
              </div>
              <label className="cursor-pointer">
                <span className="font-mono text-primary/80 tracking-wider uppercase hover:text-primary transition-colors">
                  Choose File
                </span>
                <input
                  type="file"
                  accept=".txt,.md,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest">
                Supports .txt, .md, .json
              </p>
              {content && (
                <p className="text-[9px] font-mono text-green-400/60 tracking-widest mt-4">
                  ✓ File loaded ({Math.round(content.length / 1024)}KB)
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <input
                type="text"
                value={content}
                onChange={(e) => { setContent(e.target.value); setError(""); }}
                placeholder="Enter Y/n username (e.g., nevhael)..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-3 focus:outline-none focus:border-primary/50 focus:bg-primary/5 transition-colors"
              />
              <p className="text-[10px] font-mono text-primary/30 tracking-widest">
                Import all published stories from a Y/n author
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 py-3 bg-red-900/20 border-t border-red-900/30">
            <p className="font-mono text-[10px] text-red-400 tracking-widest uppercase">
              ✗ {error}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 sm:p-6 border-t border-primary/20 bg-black/60 flex-shrink-0">
          <button
            onClick={handleLoginToYn}
            className="px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Login to Y/n
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!content.trim() || loading || isAuthenticating}
              className="flex items-center gap-2 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
            >
              {isAuthenticating ? (
                <>
                  <Lock className="w-3 h-3 animate-pulse" />
                  Authenticating...
                </>
              ) : loading ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  {isSupported && <Lock className="w-3 h-3" />}
                  Import
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}