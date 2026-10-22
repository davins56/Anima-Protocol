// Activation funnel events (see AGENTS.md → Mixpanel Tracking Plan and
// docs/analytics-funnel.md): sign_up_completed → onboarding_completed →
// message_sent → first_reply_received. All go through the consent-gated
// wrapper in analytics.js; no PII.
import { track } from "@/lib/analytics";

const FIRST_REPLY_KEY = "anima_first_reply_tracked";

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Fire once the onboarding Anima has been saved (after the store write). */
export function trackOnboardingCompleted({ voiceTone, hasAesthetic, isSaved } = {}) {
  track("onboarding_completed", {
    voice_tone: voiceTone || null,
    has_aesthetic: Boolean(hasAesthetic),
    is_saved: isSaved !== false,
  });
}

/**
 * Fire the first time this device receives a companion reply (after the
 * reply is in hand). Returns true when it fired.
 */
export function trackFirstReplyReceived({ sessionMode, isAnima, firstWordMs } = {}, store = storage()) {
  try {
    if (store?.getItem(FIRST_REPLY_KEY)) return false;
    store?.setItem(FIRST_REPLY_KEY, new Date().toISOString());
  } catch {
    // Storage blocked: still fire once per page life.
    if (trackFirstReplyReceived._fired) return false;
  }
  trackFirstReplyReceived._fired = true;
  track("first_reply_received", {
    session_mode: sessionMode || "solo",
    is_anima: Boolean(isAnima),
    ...(Number.isFinite(firstWordMs) ? { first_word_ms: Math.round(firstWordMs) } : {}),
  });
  return true;
}
trackFirstReplyReceived._fired = false;
