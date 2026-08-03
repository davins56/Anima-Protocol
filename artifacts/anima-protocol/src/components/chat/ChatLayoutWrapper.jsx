// @ts-check
import QuestTrackerSidebar from "@/components/quests/QuestTrackerSidebar";

/**
 * @param {{ activeSession?: any, children?: import('react').ReactNode }} props
 */
export default function ChatLayoutWrapper({ activeSession, children }) {
  return (
    <div className="flex w-full h-full overflow-hidden relative">
      {/* Quest Tracker Sidebar - Desktop Only */}
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
      
      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}