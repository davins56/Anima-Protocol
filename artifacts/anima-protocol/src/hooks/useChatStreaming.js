import { useCallback } from "react";
import { chatStreamStatusCopy } from "@/lib/chatStreamStatusCopy";
import { HELD_SEND_NOTE } from "@/lib/heldChatSend";
import { messageTurnId } from "@/lib/chatReplyActions";

/**
 * This turn's snapshot is the source of truth for its own rows. A reply that
 * landed for an earlier turn while this send was in flight stays on the live
 * thread, in the same place, instead of being wiped by the snapshot.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} live
 * @param {Array<Record<string, unknown>> | null | undefined} snapshot
 * @param {unknown} activeTurnId
 * @param {{ omitTurnIds?: Iterable<string> | null, omitMessageIds?: Iterable<string> | null }} [options]
 *   Replies the user already retried. They stay out even when this snapshot
 *   omitted them and an older paint still has them.
 */
function rowIsOmitted(row, omitTurnIds, omitMessageIds) {
  if (!row) return false;
  const rowId = row.id ? String(row.id) : "";
  if (rowId && omitMessageIds.has(rowId)) return true;
  const rowTurn = messageTurnId(row);
  return Boolean(row.role !== "user" && rowTurn && omitTurnIds.has(rowTurn));
}

export function stitchLiveMessages(live, snapshot, activeTurnId, options) {
  const current = Array.isArray(live) ? live : [];
  const turnId = String(activeTurnId || "");
  const omitTurnIds = new Set(options?.omitTurnIds || []);
  const omitMessageIds = new Set(options?.omitMessageIds || []);
  const next = (Array.isArray(snapshot) ? snapshot : []).filter(
    (row) => !rowIsOmitted(row, omitTurnIds, omitMessageIds),
  );
  if (!turnId || current.length === 0) return next;

  const snapshotIds = new Set();
  const snapshotRefs = new Set(next);
  for (const row of next) {
    if (row?.id) snapshotIds.add(row.id);
  }
  const anchorOf = new Map();
  next.forEach((row, index) => {
    if (row?.id) anchorOf.set(`id:${row.id}`, index);
  });

  const inSnapshot = (row) => {
    if (!row) return false;
    if (snapshotRefs.has(row)) return true;
    return Boolean(row.id && snapshotIds.has(row.id));
  };
  const belongsToActiveTurn = (row) => {
    if (!row) return false;
    return String(row.turn_id || "") === turnId || String(row.late_turn_id || "") === turnId;
  };

  /** @type {Map<number, Record<string, unknown>[]>} */
  const extrasAfter = new Map();
  let lastAnchor = -1;
  let seenSnapshotRow = false;
  for (const row of current) {
    if (!row) continue;
    if (inSnapshot(row)) {
      const at = row.id ? anchorOf.get(`id:${row.id}`) : next.indexOf(row);
      if (typeof at === "number" && at >= 0) {
        lastAnchor = at;
        seenSnapshotRow = true;
      }
      continue;
    }
    if (rowIsOmitted(row, omitTurnIds, omitMessageIds)) continue;
    const placeholder =
      row.character_name === "__typing__" ||
      row.character_name === "__thinking__" ||
      row.is_streaming === true;
    // This turn's previous bubble, and any other in-flight placeholder, is
    // replaced by the snapshot. A finished reply for another turn is not.
    if (belongsToActiveTurn(row) || placeholder) continue;
    const key = seenSnapshotRow ? lastAnchor : -1;
    const list = extrasAfter.get(key) || [];
    list.push(row);
    extrasAfter.set(key, list);
  }
  if (extrasAfter.size === 0) return next;

  /** @type {Record<string, unknown>[]} */
  const stitched = [];
  const leading = extrasAfter.get(-1);
  if (leading) stitched.push(...leading);
  next.forEach((row, index) => {
    stitched.push(row);
    const extra = extrasAfter.get(index);
    if (extra) stitched.push(...extra);
  });
  return stitched;
}

/**
 * Paint a streaming/thinking bubble onto the session that started the send.
 * After /chat/:id navigation the updater still sees the newly opened thread —
 * never replace that history with the previous thread's prefix.
 */
export function applyStreamingMessage(session, { sessionId, prefixMessages, message, omitTurnIds, omitMessageIds }) {
  if (!session) return session;
  if (sessionId && session.id !== sessionId) return session;
  const snapshot = [...prefixMessages, message];
  const turnId = message?.turn_id;
  if (!turnId) return { ...session, messages: snapshot };
  return {
    ...session,
    messages: stitchLiveMessages(session.messages, snapshot, turnId, { omitTurnIds, omitMessageIds }),
  };
}

export function useChatStreaming(setActiveSession) {
  const createStreamUi = useCallback(
    ({ sessionId, updatedMessages, characterName, timestamp, onDelta, turnId, omitTurnIds, omitMessageIds }) => {
      let paintedTokens = false;
      const resolveTurnId = () => (typeof turnId === "function" ? turnId() : turnId);
      const resolveOmit = (value) => (typeof value === "function" ? value() : value);

      const replaceTransient = (message) => {
        const id = resolveTurnId();
        setActiveSession((session) =>
          applyStreamingMessage(session, {
            sessionId,
            prefixMessages: updatedMessages,
            message: id ? { ...message, turn_id: id } : message,
            omitTurnIds: resolveOmit(omitTurnIds),
            omitMessageIds: resolveOmit(omitMessageIds),
          }),
        );
      };

      const showTyping = () => {
        replaceTransient({
          role: "assistant",
          content: "...",
          character_name: "__typing__",
          timestamp,
        });
      };

      const showStreamingPartial = (accumulated) => {
        paintedTokens = true;
        onDelta?.(accumulated);
        replaceTransient({
          role: "assistant",
          content: accumulated,
          character_name: characterName,
          timestamp,
          is_streaming: true,
        });
      };

      const showStatus = (event) => {
        if (paintedTokens && event?.status === "progress") return;
        if (event?.status === "thinking") {
          replaceTransient({
            role: "assistant",
            content: "...",
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        if (event?.status === "waiting") {
          if (paintedTokens) return;
          replaceTransient({
            role: "assistant",
            content: chatStreamStatusCopy(event) || HELD_SEND_NOTE,
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        const copy = chatStreamStatusCopy(event);
        if (!copy) return;
        if (event?.status === "progress") {
          replaceTransient({
            role: "assistant",
            content: copy,
            character_name: "__thinking__",
            timestamp,
          });
          return;
        }
        if (event?.status !== "ensemble") return;
        replaceTransient({
          role: "assistant",
          content: copy,
          character_name: "__typing__",
          timestamp,
        });
      };

      return { showTyping, showStreamingPartial, showStatus };
    },
    [setActiveSession],
  );

  return { createStreamUi };
}
