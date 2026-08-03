import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Loader, RefreshCw, Save } from "lucide-react";
import { Link } from "react-router-dom";
import DecisionTree from "@/components/branching/DecisionTree";
import { motion } from "framer-motion";

export default function StoryBranching() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");
  const [currentNode, setCurrentNode] = useState(null);
  const [branchHistory, setBranchHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      generateBranchingTree();
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    try {
      const data = await base44.entities.ChatSession.list("-updated_date", 50);
      setSessions(data || []);
      if (!selectedSession && data?.length > 0) {
        setSelectedSession(data[0].id);
      }
    } catch (err) {
      console.error("Error loading sessions:", err);
    }
  };

  const generateBranchingTree = async () => {
    if (!selectedSession) return;
    setGenerating(true);
    try {
      const session = sessions.find(s => s.id === selectedSession);
      if (!session?.messages?.length) {
        setGenerating(false);
        return;
      }

      const recentContext = session.messages
        .slice(-8)
        .map(m => `${m.character_name || "User"}: ${m.content}`)
        .join('\n');

      const result = await base44.functions.invoke("generateChoices", {
        session_id: selectedSession,
        character_name: session.character_id ? "Current Character" : "Narrator",
        recent_context: recentContext,
      });

      if (result?.data?.choices) {
        // Build initial node with generated choices
        const initialNode = {
          id: "root",
          current_context: "Current story moment - Choose your next action",
          choices: result.data.choices.map(c => ({
            ...c,
            consequences: [
              {
                type: "positive",
                description: "Deepens character development"
              },
              {
                type: "neutral",
                description: "Advances the narrative"
              }
            ],
            world_impact: c.world_impact || "Ripples through the world's events",
            confidence: Math.random() * 0.4 + 0.6, // 60-100%
          })),
          impact_level: "major",
        };

        setCurrentNode(initialNode);
        setBranchHistory([initialNode]);
      }
    } catch (err) {
      console.error("Error generating branching tree:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleChooseOption = async (choice) => {
    setLoading(true);
    try {
      // Generate choices for the next branch
      const result = await base44.functions.invoke("generateChoices", {
        session_id: selectedSession,
        character_name: "Current Character",
        recent_context: choice.text,
      });

      // Create new branch node
      const newNode = {
        id: `branch-${Date.now()}`,
        parent_id: currentNode.id,
        chosen_path: choice.text,
        current_context: `After choosing: "${choice.text}"`,
        choices: result?.data?.choices || [],
        impact_level: choice.impact_scale || "major",
      };

      setCurrentNode(newNode);
      setBranchHistory([...branchHistory, newNode]);
    } catch (err) {
      console.error("Error generating next branch:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoBack = () => {
    if (branchHistory.length > 1) {
      const previousNode = branchHistory[branchHistory.length - 2];
      setCurrentNode(previousNode);
      setBranchHistory(branchHistory.slice(0, -1));
    }
  };

  const handleReset = () => {
    setBranchHistory([]);
    generateBranchingTree();
  };

  const currentSession = sessions.find(s => s.id === selectedSession);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl">
              // Story Branching
            </h1>
            <p className="text-[9px] sm:text-[10px] font-mono text-primary/40 tracking-widest">
              Decision tree & world impact analysis
            </p>
          </div>
        </div>
      </div>

      {/* Session Selector & Controls */}
      <div className="px-4 sm:px-6 py-3 border-b border-primary/10 bg-black/40 space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
              Session
            </label>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            >
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title || "Untitled"} ({s.messages?.length || 0} messages)
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            {branchHistory.length > 1 && (
              <button
                onClick={handleGoBack}
                className="px-3 py-2 border border-primary/30 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                Back
              </button>
            )}
            <button
              onClick={handleReset}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-2 border border-primary/30 text-primary/60 hover:text-primary disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        {branchHistory.length > 1 && (
          <div className="text-[8px] font-mono text-primary/30 flex items-center gap-2 overflow-x-auto pb-1">
            <span>Root</span>
            {branchHistory.slice(1).map((node, idx) => (
              <div key={idx} className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-primary/20">→</span>
                <span className="truncate max-w-xs">{node.chosen_path?.slice(0, 30)}...</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {generating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Generating decision tree...
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl">
            <DecisionTree
              currentNode={currentNode}
              onChoose={handleChooseOption}
              loading={loading}
            />

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 p-4 border border-primary/15 bg-primary/5 grid grid-cols-3 gap-4"
            >
              <div className="text-center">
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Branches Explored
                </p>
                <p className="text-2xl font-mono text-primary">{branchHistory.length}</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Choices Available
                </p>
                <p className="text-2xl font-mono text-primary">{currentNode?.choices?.length || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                  Current Impact
                </p>
                <p className="text-sm font-mono text-primary capitalize">{currentNode?.impact_level || "—"}</p>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}