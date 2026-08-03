import { useState } from "react";
import { Plus, Zap, MessageSquare, Users, Trash2, Wand2, ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import SessionSummary from "../sidebar/SessionSummary";

import SidebarFooterMenu from "./SidebarFooterMenu";

export default function Sidebar({ sessions, activeSessionId, onNewSession, onDeleteSession, mode, onModeChange, onNavigate, collapsed, onToggleCollapse }) {

  const navigate = useNavigate();

  if (collapsed) {
    return (
      <div className="border-r border-primary/20 bg-black/95 flex flex-col items-center backdrop-blur-md flex-shrink-0" style={{ height: "100dvh", width: "40px" }}>
        <button
          onClick={onToggleCollapse}
          className="mt-3 p-1.5 text-primary/40 hover:text-primary transition-colors"
          title="Expand sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-primary/20 bg-black/95 flex flex-col backdrop-blur-md overflow-hidden flex-shrink-0" style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Mode Tabs */}
      <div className="grid grid-cols-2 border-b border-primary/20 flex-shrink-0">
        <button
          onClick={() => onModeChange("solo")}
          className={`flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 font-mono text-[9px] sm:text-[10px] tracking-[0.25em] uppercase transition-all ${
            mode === "solo"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-primary/30 hover:text-primary/60 border-b-2 border-transparent"
          }`}
        >
          <MessageSquare className="w-2.5 sm:w-3 h-2.5 sm:h-3" />
          <span>Solo</span>
        </button>
        <button
          onClick={() => onModeChange("group")}
          className={`flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 font-mono text-[9px] sm:text-[10px] tracking-[0.25em] uppercase transition-all ${
            mode === "group"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-primary/30 hover:text-primary/60 border-b-2 border-transparent"
          }`}
        >
          <Users className="w-2.5 sm:w-3 h-2.5 sm:h-3" />
          <span>Group</span>
        </button>
      </div>



      {/* Recent Chat Button */}
      {sessions.length > 0 && (
        <button
          onClick={() => {
            navigate(`/chat/${sessions[0].id}`);
            onNavigate?.();
          }}
          className="m-3 w-full flex items-center justify-center gap-2 py-1.5 sm:py-2 px-3 sm:px-4 border border-primary/40 bg-primary/5 text-primary/70 hover:bg-primary/15 hover:text-primary font-mono text-[9px] sm:text-xs tracking-widest uppercase transition-all"
        >
          ↻ Recent
        </button>
      )}

      {/* New Session Button */}
      <div className="p-3 border-b border-primary/10 space-y-2">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 py-1.5 sm:py-2 px-3 sm:px-4 btn-sacred text-primary font-mono text-[9px] sm:text-xs tracking-widest uppercase hud-corner glow-border"
        >
          <Plus className="w-3 sm:w-4 h-3 sm:h-4" />
          <span>New Session</span>
        </button>

        <Link
          to="/companion-generator"
          onClick={onNavigate}
          className="w-full flex items-center justify-center gap-2 py-1.5 sm:py-2 px-3 sm:px-4 sacred-glow border border-purple-500/30 bg-purple-900/15 text-purple-300 hover:border-purple-500/50 font-mono text-[9px] sm:text-xs tracking-widest uppercase transition-all"
        >
          <Wand2 className="w-3 sm:w-4 h-3 sm:h-4" />
          <span>Create AI</span>
        </Link>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1 min-h-0">
        {sessions.length === 0 && (
          <p className="text-center text-primary/20 font-mono text-[10px] py-8 tracking-widest uppercase">
            No sessions
          </p>
        )}
        {sessions.map((session) => (

          <div key={session.id}>
            <div
              className={`group relative flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                activeSessionId === session.id
                  ? "bg-primary/10 border border-primary/30 text-primary"
                  : "text-primary/40 hover:bg-primary/5 hover:text-primary/70 border border-transparent"
              }`}
              onClick={() => {
                navigate(`/chat/${session.id}`);
                onNavigate?.();
              }}
            >
              <MessageSquare className="w-3 h-3 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[9px] sm:text-[10px] tracking-wider uppercase truncate">
                  {session.title || "Untitled"}
                </p>
                {session.last_message && (
                  <p className="text-[8px] sm:text-[9px] text-primary/30 truncate mt-0.5">{session.last_message}</p>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-destructive transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {activeSessionId === session.id && (
              <SessionSummary sessionId={session.id} characterId={session.character_id} />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 sm:px-4 py-2 border-t border-primary/10 bg-primary/5 flex items-center justify-end w-full flex-shrink-0 min-h-[44px]">
        <div className="flex items-center gap-2">
          <div className="sm:flex hidden">
            <SidebarFooterMenu activeSessionId={activeSessionId} onMobileMenuClick={onNavigate} />

          </div>
        </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 text-primary/30 hover:text-primary transition-colors"
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>


    </div>
  );
}