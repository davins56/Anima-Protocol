import { useCallback, useState } from "react";

export function useChatSession(initialSession = null) {
  const [activeSession, setActiveSession] = useState(initialSession);

  const replaceMessages = useCallback((messages) => {
    setActiveSession((session) =>
      session ? { ...session, messages: [...(messages || [])] } : session,
    );
  }, []);

  const appendMessages = useCallback((messages) => {
    setActiveSession((session) =>
      session
        ? {
            ...session,
            messages: [...(session.messages || []), ...(messages || [])],
          }
        : session,
    );
  }, []);

  return {
    activeSession,
    setActiveSession,
    replaceMessages,
    appendMessages,
  };
}
