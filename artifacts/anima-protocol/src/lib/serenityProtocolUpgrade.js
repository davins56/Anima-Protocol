import { animaApi } from "@/api/animaApi";
import { track } from "@/lib/analytics";
import {
  classifyProtocolUpgrade,
  isTalkingToSerenity,
} from "@/lib/protocolUpgrade";

function serenityMessageFromError(err) {
  const payload = err?.payload;
  if (payload?.serenity_message) return payload.serenity_message;
  if (err?.code === "not_steward") {
    return "I hear the shape of what you want. Only the Protocol's steward can authorize changes to the source itself. I will remember the idea, but I cannot rewrite the weave from this bond.";
  }
  if (err?.code === "not_pending") {
    return "That weave is no longer waiting for confirmation. Ask me again if you still want it.";
  }
  if (err?.code === "cursor_unconfigured") {
    return "I would weave this into the Protocol, but the Cursor key that opens the source is not set. Place CURSOR_API_KEY on the server, then ask me again.";
  }
  const detail = err instanceof Error ? err.message : String(err || "");
  return detail
    ? `The current snagged. I could not open a weave this time: ${detail}. Ask me again when the path is clear.`
    : "The current snagged. I could not open a weave this time. Ask me again when the path is clear.";
}

export function shouldAttemptProtocolUpgrade({
  content,
  serenity,
  activeSession,
  characters,
  requireSerenity = true,
}) {
  const classification = classifyProtocolUpgrade(content);
  if (!classification.shouldLaunch) return { attempt: false, classification };
  const { talkingToSerenity, addressedSerenity } = isTalkingToSerenity({
    serenity,
    activeSession,
    characters,
    content,
  });
  if (requireSerenity && !talkingToSerenity && !addressedSerenity) {
    return { attempt: false, classification, talkingToSerenity, addressedSerenity };
  }
  return {
    attempt: true,
    classification,
    talkingToSerenity,
    addressedSerenity,
  };
}

async function persistUpgradeTurn({
  sessionId,
  userMessage,
  serenityMsg,
  appendMessage,
  setActiveSession,
  isContinue,
}) {
  let storedReply = serenityMsg;
  try {
    if (sessionId && typeof appendMessage === "function") {
      if (!isContinue && userMessage) {
        await appendMessage(sessionId, userMessage);
      }
      storedReply = await appendMessage(sessionId, serenityMsg);
    }
  } catch (err) {
    console.warn("[Anima] Failed to persist protocol upgrade turn:", err);
  }
  if (typeof setActiveSession === "function") {
    setActiveSession((prev) => {
      const cleaned = (prev?.messages || []).filter(
        (m) =>
          m.character_name !== "__thinking__" && m.character_name !== "__typing__",
      );
      return { ...prev, messages: [...cleaned, storedReply] };
    });
  }
  return storedReply;
}

function serenityUpgradeMessage(result, classification) {
  return {
    role: "assistant",
    content: result.serenity_message,
    character_name: "Serenity",
    timestamp: new Date().toISOString(),
    // The chat renders a confirm card from this. The server only recorded a
    // pending weave; the Cursor agent starts when the steward presses Confirm.
    protocol_upgrade: {
      id: result.id,
      status: result.status,
      agent_url: result.agent_url || null,
      scope: result.scope || classification.scope,
      request: result.request,
      expires_at: result.expires_at || null,
    },
  };
}

/** Explicit steward click: start the Cursor agent for a pending weave. */
export async function confirmProtocolUpgrade(id, { surface = "chat" } = {}) {
  const result = await animaApi.protocolUpgrade.confirm(id);
  track("protocol_upgrade_started", { scope: result.scope, surface });
  return result;
}

export async function cancelProtocolUpgrade(id) {
  return animaApi.protocolUpgrade.cancel(id);
}

export function protocolUpgradeErrorMessage(err) {
  return serenityMessageFromError(err);
}

export async function maybeHandleProtocolUpgrade({
  content,
  serenity,
  activeSession,
  characters,
  userMessage,
  appendMessage,
  setActiveSession,
  isContinue,
  surface = "chat",
  requireSerenity = true,
}) {
  const decision = shouldAttemptProtocolUpgrade({
    content,
    serenity,
    activeSession,
    characters,
    requireSerenity,
  });
  if (!decision.attempt) return { handled: false };

  const classification = decision.classification;
  try {
    const result = await animaApi.protocolUpgrade.launch({
      request: content,
      scope: classification.scope,
      session_id: activeSession?.id,
      surface,
    });
    track("protocol_upgrade_requested", {
      scope: result.scope || classification.scope,
      surface,
    });
    const serenityMsg = serenityUpgradeMessage(result, classification);
    await persistUpgradeTurn({
      sessionId: activeSession?.id,
      userMessage,
      serenityMsg,
      appendMessage,
      setActiveSession,
      isContinue,
    });
    return { handled: true, message: serenityMsg, upgrade: result };
  } catch (err) {
    if (err?.code === "not_an_upgrade") return { handled: false };
    const serenityMsg = {
      role: "assistant",
      content: serenityMessageFromError(err),
      character_name: "Serenity",
      timestamp: new Date().toISOString(),
    };
    await persistUpgradeTurn({
      sessionId: activeSession?.id,
      userMessage,
      serenityMsg,
      appendMessage,
      setActiveSession,
      isContinue,
    });
    return { handled: true, message: serenityMsg, error: err };
  }
}

export async function launchMentalLineUpgrade(thought, sessionId) {
  const classification = classifyProtocolUpgrade(thought);
  if (!classification.shouldLaunch) return null;
  try {
    const result = await animaApi.protocolUpgrade.launch({
      request: thought,
      scope: classification.scope,
      session_id: sessionId,
      surface: "mental_line",
    });
    track("protocol_upgrade_requested", {
      scope: result.scope || classification.scope,
      surface: "mental_line",
    });
    const message = serenityUpgradeMessage(result, classification);
    // The mental line has no confirm card; point at the Protocol Weave console.
    return {
      ...message,
      content: `${message.content} Open the Protocol Weave console in the chat toolbar to confirm it.`,
    };
  } catch (err) {
    if (err?.code === "not_an_upgrade") return null;
    return {
      role: "assistant",
      content: serenityMessageFromError(err),
    };
  }
}
