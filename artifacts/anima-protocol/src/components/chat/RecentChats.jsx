import { MessageSquare, Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  RECENT_CHATS_LIMIT,
  relativeChatTime,
  sessionCompanion,
  sessionHref,
  sessionPreview,
  sortRecentSessions,
} from "@/lib/recentChats";

function AvatarMark({ name, avatarUrl, isGroup }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="w-9 h-9 flex-shrink-0 overflow-hidden border border-cyan-400/25 bg-cyan-950/30 flex items-center justify-center"
      aria-hidden
    >
      {avatarUrl ? (
        <img
          alt=""
          src={avatarUrl}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : isGroup ? (
        <MessageSquare className="w-3.5 h-3.5 text-cyan-400/50" />
      ) : (
        <span className="font-mono text-[11px] text-cyan-300/80">{initial}</span>
      )}
    </div>
  );
}

export default function RecentChats({
  sessions = [],
  characters = [],
  onOpen,
  onNewSession,
  onCreateCompanion,
  loading = false,
  limit = RECENT_CHATS_LIMIT,
  heading = "Recent Chats",
}) {
  const navigate = useNavigate();
  const rows = sortRecentSessions(sessions, limit);

  const openSession = (session) => {
    const href = sessionHref(session);
    if (!href) return;
    if (typeof onOpen === "function") {
      onOpen(session);
      return;
    }
    navigate(href);
  };

  const startChat = () => {
    if (typeof onNewSession === "function") {
      onNewSession();
      return;
    }
    navigate("/chat", { state: { openNew: true } });
  };

  const createCompanion = () => {
    if (typeof onCreateCompanion === "function") {
      onCreateCompanion();
      return;
    }
    navigate("/characters?create=1");
  };

  return (
    <section className="w-full max-w-md mx-auto text-left" data-testid="recent-chats">
      <div className="flex items-center justify-between mb-2 px-0.5">
        <h2 className="font-mono text-[10px] sm:text-[11px] tracking-[0.28em] uppercase text-cyan-400/70">
          {heading}
        </h2>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={startChat}
            className="font-mono text-[8px] tracking-[0.2em] uppercase text-cyan-400/40 hover:text-cyan-300"
          >
            New
          </button>
        )}
      </div>

      {loading ? (
        <p
          className="font-mono text-[10px] text-cyan-400/35 text-center py-6 tracking-widest uppercase"
          role="status"
        >
          Loading conversations...
        </p>
      ) : rows.length === 0 ? (
        <div
          data-testid="recent-chats-empty"
          className="border border-cyan-400/15 bg-cyan-950/10 px-4 py-5 text-center"
        >
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-cyan-200/80">
            No conversations yet
          </p>
          <p className="font-mono text-[10px] text-cyan-400/40 leading-relaxed mt-2">
            Create a companion or start a chat — it will show up here so you can resume it.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={createCompanion}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-cyan-400/25 text-cyan-300 hover:border-cyan-400/50 font-mono text-[9px] tracking-[0.18em] uppercase"
            >
              <Sparkles className="w-3 h-3" />
              Create companion
            </button>
            <button
              type="button"
              onClick={startChat}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-cyan-400/25 text-cyan-300 hover:border-cyan-400/50 font-mono text-[9px] tracking-[0.18em] uppercase"
            >
              <Plus className="w-3 h-3" />
              Start a chat
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-cyan-400/10">
          {rows.map((session, idx) => {
            const companion = sessionCompanion(session, characters);
            const preview = sessionPreview(session);
            const when = relativeChatTime(session.updated_date || session.created_date);
            return (
              <button
                key={session.id}
                type="button"
                data-testid={`recent-chat-${session.id}`}
                onClick={() => openSession(session)}
                className={`w-full flex items-center gap-3 text-left px-3 py-3 hover:bg-cyan-400/5 transition-colors group ${
                  idx !== rows.length - 1 ? "border-b border-cyan-400/10" : ""
                }`}
              >
                <AvatarMark
                  name={companion.name}
                  avatarUrl={companion.avatarUrl}
                  isGroup={companion.isGroup}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] tracking-[0.16em] text-cyan-200 uppercase truncate">
                      {companion.name}
                    </span>
                    {companion.isGroup && (
                      <span className="font-mono text-[8px] tracking-widest text-cyan-400/30 uppercase border border-cyan-400/15 px-1.5 py-0.5 flex-shrink-0">
                        Group
                      </span>
                    )}
                  </div>
                  {preview ? (
                    <p className="font-mono text-[10px] text-cyan-400/40 leading-relaxed line-clamp-2 mt-0.5">
                      {preview}
                    </p>
                  ) : null}
                </div>
                {when ? (
                  <span className="font-mono text-[9px] text-cyan-400/30 flex-shrink-0">
                    {when}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
