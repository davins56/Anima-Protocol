// @ts-check
import { useState, useEffect, useRef, useCallback } from "react";
import { animaClient } from "@/api/animaClient";

/** Auto-analyze once this many new messages arrive since the last attempt. */
export const INSIGHTS_EVERY_N_MESSAGES = 10;
const MIN_MESSAGES = 5;

/**
 * Whether the hook should auto-run now. Pure so it can be tested.
 * `lastAttemptCount` moves on every attempt, success OR failure, so a failing
 * server is retried only after another batch of messages, never in a loop.
 * @param {{ messageCount: number, lastAttemptCount: number, inFlight: boolean }} s
 */
export function shouldAutoAnalyze({ messageCount, lastAttemptCount, inFlight }) {
  if (inFlight) return false;
  if (messageCount < MIN_MESSAGES) return false;
  return messageCount > lastAttemptCount + INSIGHTS_EVERY_N_MESSAGES;
}

/**
 * The invoke helper resolves `result` (a short summary string today) or null
 * on any failure. Shape it for AIInsightsPanel.
 * @param {unknown} result
 * @returns {Record<string, any> | null}
 */
export function normalizeInsights(result) {
  if (result == null) return null;
  if (typeof result === "string") {
    const summary = result.trim();
    return summary ? { summary, analysis_timestamp: new Date().toISOString() } : null;
  }
  if (typeof result === "object") {
    const obj = /** @type {Record<string, any>} */ (result);
    const data = obj.data && typeof obj.data === "object" ? obj.data : obj;
    return Object.keys(data).length ? data : null;
  }
  return null;
}

/**
 * @param {string} sessionId
 * @param {any[]} messages
 */
export function useAIInsights(sessionId, messages) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastAttemptCount, setLastAttemptCount] = useState(0);
  const inFlightRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // A different chat starts its own count.
  useEffect(() => {
    setLastAttemptCount(0);
    setInsights(null);
  }, [sessionId]);

  const analyzeConversation = useCallback(async () => {
    const current = messagesRef.current;
    if (!sessionId || !current || current.length < MIN_MESSAGES) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Mark the attempt BEFORE the call: an error or empty answer must not
    // re-trigger the effect (it used to re-fire every time `loading` flipped
    // back to false, hammering the server with retries).
    setLastAttemptCount(current.length);
    setLoading(true);
    try {
      const result = await animaClient.functions.invoke("generateInsightsSummary", {
        session_id: sessionId,
        messages: current.slice(-50), // Last 50 messages for context
        focus_areas: ["character_themes", "plot_coherence", "character_evolution"],
      });
      const next = normalizeInsights(result);
      if (next) setInsights(next);
    } catch (err) {
      console.warn("Insights unavailable right now:", err?.message || err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [sessionId]);

  const messageCount = messages?.length || 0;
  useEffect(() => {
    if (shouldAutoAnalyze({ messageCount, lastAttemptCount, inFlight: inFlightRef.current })) {
      analyzeConversation();
    }
  }, [messageCount, lastAttemptCount, analyzeConversation]);

  return {
    insights,
    loading,
    analyzeNow: analyzeConversation,
  };
}
