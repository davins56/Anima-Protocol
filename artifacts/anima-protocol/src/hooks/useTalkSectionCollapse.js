// @ts-check
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  readTalkCollapsed,
  talkCollapseUserId,
  writeTalkCollapsed,
} from "@/lib/talkCollapseStorage";

/**
 * Persist Talk-screen section collapse per Clerk user in localStorage.
 * @param {"header" | "resonance"} section
 */
export function useTalkSectionCollapse(section) {
  const { user } = useAuth();
  const userId = talkCollapseUserId(user?.id);

  const [collapsed, setCollapsed] = useState(() => readTalkCollapsed(userId, section));

  useEffect(() => {
    setCollapsed(readTalkCollapsed(userId, section));
  }, [userId, section]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeTalkCollapsed(userId, section, next);
      return next;
    });
  }, [userId, section]);

  return { collapsed, toggle, userId, setCollapsed };
}

export default useTalkSectionCollapse;
