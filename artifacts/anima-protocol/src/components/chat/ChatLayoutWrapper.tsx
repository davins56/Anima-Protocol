import type { ReactNode } from "react";

import QuestTrackerSidebar from "@/components/quests/QuestTrackerSidebar";

type Message = {
  id?: string;
  content: string;
  role: "user" | "assistant" | "system";
  created_at?: string | Date;
};

type ActiveSession = {
  id: string;
  character_id: string;
  messages: Message[];
};

type ChatLayoutWrapperProps = {
  activeSession?: ActiveSession;
  children?: ReactNode;
};

export default function ChatLayoutWrapper({
  activeSession,
  children,
}: ChatLayoutWrapperProps) {
  return (
    <div className="flex w-full h-full overflow-hidden relative">
      {activeSession && (
        <div className="hidden lg:block">
          <QuestTrackerSidebar
            sessionId={activeSession.id}
            characterId={activeSession.character_id}
            recentMessages={activeSession.messages}
            isVisible={true}
            onQuestUpdate={() => {}}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
