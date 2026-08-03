import { useState, useMemo } from "react";
import { GitFork, MessageSquare, ChevronRight } from "lucide-react";

export default function NarrativeTimeline({ storypoints, sessions, characters, onSelectSession, onSelectStorypoint }) {
  const [expandedSessions, setExpandedSessions] = useState(new Set());

  // Build a chronological timeline with storypoints and sessions
  const timeline = useMemo(() => {
    const items = [];

    // Add all storypoints
    storypoints.forEach((sp) => {
      items.push({
        type: "storypoint",
        id: sp.id,
        date: sp.created_date || new Date().toISOString(),
        data: sp,
      });
    });

    // Add all sessions
    sessions.forEach((session) => {
      items.push({
        type: "session",
        id: session.id,
        date: session.created_date || new Date().toISOString(),
        data: session,
        parentSessionId: session.parent_session_id,
        forkStoryPointId: session.fork_storypoint_id,
      });
    });

    // Sort by date
    return items.sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [storypoints, sessions]);

  // Group sessions by their parent to show branches
  const sessionsByParent = useMemo(() => {
    const map = new Map();
    sessions.forEach((session) => {
      const parentId = session.parent_session_id || "root";
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId).push(session);
    });
    return map;
  }, [sessions]);

  const toggleSessionExpand = (sessionId) => {
    const newExpanded = new Set(expandedSessions);
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);
    }
    setExpandedSessions(newExpanded);
  };

  const getCharacterName = (charId) => {
    const char = characters.find((c) => c.id === charId);
    return char?.name || "Unknown";
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="w-full bg-black/40 border border-primary/15 p-6">
      <div className="mb-6">
        <h3 className="font-mono text-primary glow-text tracking-[0.2em] uppercase mb-1">
          Narrative Timeline
        </h3>
        <p className="text-[9px] font-mono text-primary/30 tracking-widest">
          {timeline.length} events · {sessionsByParent.get("root")?.length || 0} root sessions · {sessions.filter(s => s.parent_session_id).length} branches
        </p>
      </div>

      <div className="relative space-y-1">
        {/* Timeline vertical line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

        {/* Timeline items */}
        {timeline.map((item, idx) => {
          const isStorypoint = item.type === "storypoint";
          const isSession = item.type === "session";
          const isForked = isSession && item.parentSessionId;
          const childSessions = isStorypoint ? [] : sessionsByParent.get(item.id) || [];
          const isExpanded = expandedSessions.has(item.id);

          return (
            <div key={item.id} className="relative">
              {/* Main timeline item */}
              <div className="flex items-start gap-4 pl-12 py-3 group">
                {/* Timeline dot */}
                <div
                  className={`absolute left-1 top-4 w-3 h-3 rounded-full border-2 flex items-center justify-center transition-all ${
                    isStorypoint
                      ? "border-primary bg-primary/30"
                      : "border-primary/50 bg-primary/10 group-hover:border-primary group-hover:bg-primary/20"
                  }`}
                >
                  {isForked && <GitFork className="w-1.5 h-1.5 text-primary" />}
                </div>

                {/* Content */}
                <button
                  onClick={() =>
                    isStorypoint ? onSelectStorypoint?.(item.id) : onSelectSession?.(item.id)
                  }
                  className="flex-1 text-left p-3 border border-primary/15 bg-black/60 hover:border-primary/40 hover:bg-primary/5 transition-all rounded"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isStorypoint ? (
                          <>
                            <span className="text-[9px] font-mono text-primary/50 tracking-widest uppercase">
                              Act {storypoints.indexOf(item.data) + 1}
                            </span>
                            <span className="font-mono text-xs text-primary tracking-wider uppercase truncate">
                              {item.data.title}
                            </span>
                          </>
                        ) : (
                          <>
                            <MessageSquare className="w-3 h-3 text-primary/60 flex-shrink-0" />
                            <span className="font-mono text-xs text-primary tracking-wider uppercase truncate">
                              {item.data.title || "Untitled Session"}
                            </span>
                            {isForked && (
                              <GitFork className="w-3 h-3 text-primary/40 flex-shrink-0" />
                            )}
                          </>
                        )}
                      </div>

                      {isSession && (
                        <div className="text-[10px] font-mono text-primary/40">
                          {item.data.mode === "solo"
                            ? `Solo: ${getCharacterName(item.data.character_id)}`
                            : `Group: ${item.data.group_character_ids?.length || 0} characters`}
                        </div>
                      )}

                      {isStorypoint && item.data.summary && (
                        <p className="text-[10px] font-mono text-primary/50 mt-1 line-clamp-2">
                          {item.data.summary}
                        </p>
                      )}
                    </div>

                    <div className="text-[9px] font-mono text-primary/30 flex-shrink-0 whitespace-nowrap">
                      {formatDate(item.date)}
                    </div>
                  </div>
                </button>
              </div>

              {/* Child sessions (branches) */}
              {childSessions.length > 0 && (
                <div className="pl-12 ml-6 border-l border-primary/20">
                  <button
                    onClick={() => toggleSessionExpand(item.id)}
                    className="py-2 px-3 text-[9px] font-mono text-primary/40 hover:text-primary/60 transition-colors flex items-center gap-1 uppercase tracking-widest"
                  >
                    <ChevronRight
                      className={`w-3 h-3 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    {childSessions.length} branch{childSessions.length !== 1 ? "es" : ""}
                  </button>

                  {isExpanded && (
                    <div className="space-y-1 pb-2">
                      {childSessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={() => onSelectSession?.(session.id)}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left border border-primary/10 bg-black/40 hover:border-primary/30 hover:bg-primary/5 transition-all rounded text-[10px]"
                        >
                          <GitFork className="w-3 h-3 text-primary/40 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-primary/70 tracking-wider uppercase truncate">
                              {session.title || "Forked Session"}
                            </p>
                            <p className="text-primary/30 mt-0.5">
                              {session.messages?.length || 0} messages
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {timeline.length === 0 && (
        <div className="text-center py-12">
          <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase">
            No timeline events yet
          </p>
        </div>
      )}
    </div>
  );
}