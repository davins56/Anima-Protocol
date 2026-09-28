import { useEffect, useRef, useState } from "react";
import {
  AI_NOTICE_REPEAT_MS,
  latestNoticeShownAt,
  parseNoticeTimestamp,
  readAiNoticeShownAt,
  shouldShowAiCompanionNotice,
  writeAiNoticeShownAt,
} from "@/lib/aiCompanionNotice";

/**
 * System notices for the open conversation. They live in component state,
 * not in session.messages, so they are never saved as character lines.
 */
export function useAiCompanionNotice({
  sessionId,
  serverShownAt,
  persistShownAt,
  now = () => Date.now(),
  storage,
} = {}) {
  const [notices, setNotices] = useState([]);
  const persistRef = useRef(persistShownAt);
  persistRef.current = persistShownAt;
  const serverRef = useRef(serverShownAt);
  serverRef.current = serverShownAt;
  const nowRef = useRef(now);
  nowRef.current = now;
  const storageRef = useRef(storage);
  storageRef.current = storage;

  useEffect(() => {
    if (!sessionId) {
      setNotices([]);
      return undefined;
    }
    let timer = 0;
    let cancelled = false;
    const clock = () => nowRef.current();
    const show = (at, placement) => {
      writeAiNoticeShownAt(sessionId, at, storageRef.current);
      persistRef.current?.(sessionId, new Date(at).toISOString());
      if (cancelled) return;
      setNotices((prev) => {
        if (prev.some((notice) => notice.id === `${sessionId}:${at}`)) return prev;
        return [...prev, { id: `${sessionId}:${at}`, shownAt: at, placement }];
      });
    };
    const arm = (delay) => {
      timer = window.setTimeout(() => {
        show(clock(), "repeat");
        arm(AI_NOTICE_REPEAT_MS);
      }, Math.max(0, delay));
    };

    const at = clock();
    const lastShownAt = readAiNoticeShownAt(sessionId, storageRef.current);
    const serverAt = parseNoticeTimestamp(serverRef.current);
    if (shouldShowAiCompanionNotice({ lastShownAt, serverShownAt: serverAt, now: at })) {
      writeAiNoticeShownAt(sessionId, at, storageRef.current);
      persistRef.current?.(sessionId, new Date(at).toISOString());
      setNotices([{ id: `${sessionId}:${at}`, shownAt: at, placement: "start" }]);
      arm(AI_NOTICE_REPEAT_MS);
    } else {
      setNotices([]);
      const latest = latestNoticeShownAt(lastShownAt, serverAt) ?? at;
      arm(latest + AI_NOTICE_REPEAT_MS - at);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionId]);

  return notices;
}
