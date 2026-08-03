import { base44 } from '@/api/base44Client';

export function useSerenityDebug() {
  const handleDebugRequest = async (thought, activeSessionId) => {
    const isDebugRequest = /debug|diagnose|check|health|status|what.?s wrong/i.test(thought);
    
    if (isDebugRequest) {
      try {
        const diagnostics = await base44.functions.invoke("debugApp", {
          session_id: activeSessionId,
          debug_level: thought.toLowerCase().includes('deep') ? 'deep' : 'standard',
        });

        if (diagnostics?.data?.diagnostics) {
          const diag = diagnostics.data.diagnostics;
          const debugResponse = `${diag.summary}\n\n${
            diag.issues.length > 0
              ? `Observations:\n${diag.issues.join('\n')}`
              : 'No issues detected.'
          }${
            diag.activeSession
              ? `\n\nActive Session: ${diag.activeSession.messageCount} messages, mode: ${diag.activeSession.mode}`
              : ''
          }`;
          return debugResponse;
        }
      } catch (err) {
        return `⚠️ Debug error: ${err.message}`;
      }
    }
    
    return null;
  };

  return { handleDebugRequest };
}