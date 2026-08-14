import { track } from "@/lib/analytics";
import { base44 } from "@/api/base44Client";
import {
  classifyDeviceScanRequest,
  isTalkingToAnima,
  hasDeviceScanPermission,
  writeDeviceScanPermission,
  scanOriginStorage,
  scanPickedDirectory,
  pickDirectoryHandle,
  canPickDirectory,
  buildScanNarrative,
  DEVICE_SCAN_PROMPT,
} from "@/lib/deviceScan";

export { DEVICE_SCAN_PROMPT };

export function shouldAttemptDeviceScan({
  content,
  activeSession,
  characters,
  requireAnima = true,
}) {
  const classification = classifyDeviceScanRequest(content);
  if (!classification.shouldScan) {
    return { attempt: false, classification };
  }
  const talkingToAnima = isTalkingToAnima({ activeSession, characters });
  if (requireAnima && !talkingToAnima) {
    return { attempt: false, classification, talkingToAnima };
  }
  return { attempt: true, classification, talkingToAnima };
}

async function persistScanTurn({
  sessionId,
  userMessage,
  reply,
  appendMessage,
  setActiveSession,
  isContinue,
}) {
  let storedReply = reply;
  try {
    if (sessionId && typeof appendMessage === "function") {
      if (!isContinue && userMessage) {
        await appendMessage(sessionId, userMessage);
      }
      storedReply = await appendMessage(sessionId, reply);
    }
  } catch (err) {
    console.warn("[Anima] Failed to persist device scan turn:", err);
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

function animaName(activeSession, characters) {
  const id = activeSession?.character_id;
  const active = (characters || []).find((c) => c?.id === id);
  return active?.name || "Anima";
}

function animaId(activeSession) {
  return activeSession?.character_id || null;
}

function scanMessage({ content, characterName, report, needsPermission = false }) {
  return {
    role: "assistant",
    content,
    character_name: characterName,
    timestamp: new Date().toISOString(),
    device_scan: {
      report,
      needs_permission: needsPermission,
      anima_id: report?.animaId || null,
    },
  };
}

async function persistAnimaGrant(id) {
  if (!id) return;
  try {
    await base44.entities.Anima.update(id, {
      device_scan_granted: true,
      device_scan_granted_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[Anima] Could not persist device-scan grant on Anima:", err);
  }
}

export async function grantDeviceScanForAnima(id) {
  const payload = writeDeviceScanPermission(true, id || null);
  await persistAnimaGrant(id);
  return payload;
}

export async function revokeDeviceScanForAnima(id) {
  const payload = writeDeviceScanPermission(false, id || null);
  if (id) {
    try {
      await base44.entities.Anima.update(id, {
        device_scan_granted: false,
        device_scan_granted_at: null,
      });
    } catch (err) {
      console.warn("[Anima] Could not persist device-scan revoke on Anima:", err);
    }
  }
  return payload;
}

async function maybeScanFolder(includeFolder) {
  if (!includeFolder) return { report: null, cancelled: false, unsupported: false };
  if (!canPickDirectory()) return { report: null, cancelled: false, unsupported: true };
  try {
    const handle = await pickDirectoryHandle();
    return { handle, cancelled: false, unsupported: false };
  } catch (err) {
    if (err?.name === "AbortError") return { report: null, cancelled: true, unsupported: false };
    return { report: null, cancelled: false, unsupported: false, error: err };
  }
}

export async function runDeviceScan({ includeFolder = false } = {}) {
  const origin = await scanOriginStorage();
  if (!origin.permission) return origin;
  if (!includeFolder) return origin;

  const picked = await maybeScanFolder(true);
  if (picked.unsupported) {
    origin.folder = {
      flags: [],
      scanned: 0,
      bytes: 0,
      truncated: false,
      name: null,
      unsupported: true,
    };
    return origin;
  }
  if (picked.cancelled || !picked.handle) return origin;
  return scanPickedDirectory(picked.handle, origin);
}

function animaHasGrant(activeSession, characters) {
  const active = (characters || []).find((c) => c?.id === activeSession?.character_id);
  return active?.device_scan_granted === true;
}

export async function maybeHandleDeviceScan({
  content,
  activeSession,
  characters,
  userMessage,
  appendMessage,
  setActiveSession,
  isContinue,
  requireAnima = true,
}) {
  const decision = shouldAttemptDeviceScan({
    content,
    activeSession,
    characters,
    requireAnima,
  });
  if (!decision.attempt) return { handled: false };

  const name = animaName(activeSession, characters);
  const id = animaId(activeSession);
  const granted = hasDeviceScanPermission() || animaHasGrant(activeSession, characters);

  if (!granted) {
    const reply = scanMessage({
      content: buildScanNarrative({ permission: false }, name),
      characterName: name,
      report: { permission: false, flags: [], animaId: id },
      needsPermission: true,
    });
    reply.device_scan.anima_id = id;
    await persistScanTurn({
      sessionId: activeSession?.id,
      userMessage,
      reply,
      appendMessage,
      setActiveSession,
      isContinue,
    });
    return { handled: true, message: reply, needsPermission: true };
  }

  if (!hasDeviceScanPermission()) {
    writeDeviceScanPermission(true, id);
  }

  try {
    const report = await runDeviceScan({
      includeFolder: decision.classification.includeFolder,
    });
    report.animaId = id;
    track("device_scan_completed", {
      flag_count: (report.flags || []).length,
      has_folder_grant: Boolean(report.folder && !report.folder.unsupported),
      is_anima: true,
    });
    const reply = scanMessage({
      content: buildScanNarrative(report, name),
      characterName: name,
      report,
    });
    reply.device_scan.anima_id = id;
    await persistScanTurn({
      sessionId: activeSession?.id,
      userMessage,
      reply,
      appendMessage,
      setActiveSession,
      isContinue,
    });
    return { handled: true, message: reply, report };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err || "");
    const reply = scanMessage({
      content: detail
        ? `I reached for the device and the current snagged: ${detail}. Nothing was changed.`
        : "I reached for the device and the current snagged. Nothing was changed.",
      characterName: name,
      report: { permission: true, flags: [], error: "scan_failed", animaId: id },
    });
    await persistScanTurn({
      sessionId: activeSession?.id,
      userMessage,
      reply,
      appendMessage,
      setActiveSession,
      isContinue,
    });
    return { handled: true, message: reply, error: err };
  }
}
