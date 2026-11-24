/**
 * Situational scenes (#763) PR 2: who heard what. Pure helpers, no I/O.
 *
 * Every chat row written while ANIMA_SITUATIONAL_SCENES is on carries a
 * server-stamped `metadata.heard_by: string[]`:
 *   - absent      -> legacy row (written before scenes): heard by the
 *                    session's authorized cast only;
 *   - `[]`        -> nobody heard it;
 *   - `[ids…]`    -> exactly those ids (intersected with the authorized cast);
 *   - anything else (not an array, non-string entries, too long) is malformed
 *                    and fails closed: nobody heard it.
 *
 * Restore after delete reads `heard_by` only from a server tombstone kept in
 * chat_sessions.metadata.awareness_tombstones (R1): capped at the 50 newest
 * per session, 7 days, bound to the session id, the message id and a digest
 * of the row's content. A restore whose content no longer matches the digest
 * gets `heard_by: []` (an edited restore cannot launder new text through an
 * old stamp).
 *
 * With the flag off none of this runs and rows are read exactly as before.
 */
import { createHash } from "node:crypto";
import { isAspectKey, sceneHeardBy, type SceneState } from "./sceneState";

export const HEARD_BY_MAX = 64;
export const TOMBSTONE_CAP = 50;
export const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** M12: one stage direction for a character who missed part of the thread. */
export const AWAY_GAP_NOTE = "[You were away for a while and didn't hear what was said.]";

type Row = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type HeardByRead =
  | { kind: "legacy" }
  | { kind: "list"; ids: string[] }
  | { kind: "malformed" };

/** Classify a stored `heard_by` value (metadata.heard_by, or a bare value). */
export function classifyHeardBy(value: unknown): HeardByRead {
  if (!Array.isArray(value) || value.length > HEARD_BY_MAX) return { kind: "malformed" };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > 200) return { kind: "malformed" };
    if (!ids.includes(item)) ids.push(item);
  }
  return { kind: "list", ids };
}

/** The awareness a stored row carries. */
export function readHeardBy(row: unknown): HeardByRead {
  if (!isObject(row)) return { kind: "malformed" };
  const metadata = row.metadata;
  if (metadata === undefined || metadata === null) return { kind: "legacy" };
  if (!isObject(metadata)) return { kind: "malformed" };
  if (!Object.prototype.hasOwnProperty.call(metadata, "heard_by")) return { kind: "legacy" };
  return classifyHeardBy(metadata.heard_by);
}

/**
 * Did `characterId` hear this row? `authorizedCast` is the server's stored
 * cast for the session (never the request's ids). Aspect keys share the solo
 * Anima's memory and are not separate listeners.
 */
export function heardByCharacter(row: unknown, characterId: string, authorizedCast: readonly string[]): boolean {
  if (!characterId || !authorizedCast.includes(characterId)) return false;
  const read = readHeardBy(row);
  if (read.kind === "legacy") return true;
  if (read.kind === "malformed") return false;
  return read.ids.includes(characterId);
}

/** Rows `characterId` heard, in order. Scene event rows are never history. */
export function rowsHeardBy<T>(rows: readonly T[], characterId: string, authorizedCast: readonly string[]): T[] {
  return rows.filter((row) => {
    if (isObject(row) && row.role === "event") return false;
    return heardByCharacter(row, characterId, authorizedCast);
  });
}

/**
 * The history `characterId` may see, plus the M12 stage direction: when she
 * missed rows after the last one she heard (or missed everything in the
 * window but heard nothing at all), one bracketed note is attached to the
 * first row she heard after the most recent gap, or returned as `trailing`
 * when the gap runs up to the current turn. The note never carries content
 * from the gap.
 */
export function historyForCharacter<T extends Row>(
  rows: readonly T[],
  characterId: string,
  authorizedCast: readonly string[],
): { rows: T[]; trailingGapNote: string | null; dropped: number } {
  const out: T[] = [];
  let dropped = 0;
  let gapOpen = false;
  let gapIndex = -1;
  for (const row of rows) {
    if (row.role === "event") continue;
    if (heardByCharacter(row, characterId, authorizedCast)) {
      if (gapOpen) {
        gapIndex = out.length;
        gapOpen = false;
      }
      out.push(row);
    } else {
      dropped += 1;
      gapOpen = true;
    }
  }
  if (gapOpen) return { rows: out, trailingGapNote: AWAY_GAP_NOTE, dropped };
  if (gapIndex >= 0) {
    const target = out[gapIndex]!;
    out[gapIndex] = { ...target, content: `${AWAY_GAP_NOTE}\n\n${String(target.content ?? "")}` };
  }
  return { rows: out, trailingGapNote: null, dropped };
}

/**
 * @mentions in a line, resolved case-insensitively against cast names (the
 * longest name wins so "Ser" never shadows "Serenity").
 */
export function mentionedCastIds(content: unknown, names: ReadonlyMap<string, string>): string[] {
  const text = typeof content === "string" ? content.toLowerCase() : "";
  if (!text.includes("@")) return [];
  const out: string[] = [];
  const entries = [...names.entries()]
    .filter(([, name]) => name.trim())
    .sort((a, b) => b[1].length - a[1].length);
  for (const [id, name] of entries) {
    const needle = `@${name.trim().toLowerCase()}`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      const after = text.charAt(at + needle.length);
      if (!after || !/[\p{L}\p{N}_]/u.test(after)) {
        if (!out.includes(id)) out.push(id);
        break;
      }
      from = at + needle.length;
    }
  }
  return out;
}

/**
 * The stamp for a line written now: who is `here`, plus mentioned characters
 * reachable by text or phone, plus `speakerId` (a speaker hears herself).
 */
export function stampHeardBy(input: {
  scene: SceneState;
  content: unknown;
  names: ReadonlyMap<string, string>;
  speakerId?: string | null;
}): string[] {
  const ids = sceneHeardBy(input.scene, mentionedCastIds(input.content, input.names));
  const speaker = input.speakerId ? String(input.speakerId) : "";
  if (speaker && !isAspectKey(speaker) && input.scene.cast[speaker] && !ids.includes(speaker)) ids.push(speaker);
  return ids;
}

/** Digest of what a row says, binding a tombstone to its exact content. */
export function rowDigest(row: Row): string {
  const metadata = isObject(row.metadata) ? row.metadata : {};
  const parts = [
    String(row.role ?? ""),
    String(row.content ?? ""),
    String(row.character_id ?? metadata.character_id ?? ""),
    String(row.character_name ?? ""),
    JSON.stringify(Array.isArray(row.attachments) ? row.attachments : []),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export type AwarenessTombstone = {
  session_id: string;
  message_id: string;
  /** null = the deleted row was legacy (no stamp). */
  heard_by: string[] | null;
  stamped_at: string | null;
  deleted_at: string;
  digest: string;
};

/** Build the tombstone for a row that is being deleted. */
export function tombstoneFor(row: Row, sessionId: string, nowIso: string): AwarenessTombstone {
  const read = readHeardBy(row);
  const metadata = isObject(row.metadata) ? row.metadata : {};
  return {
    session_id: sessionId,
    message_id: String(row.id ?? ""),
    // A malformed stamp stays fail-closed through delete + restore.
    heard_by: read.kind === "legacy" ? null : read.kind === "list" ? read.ids : [],
    stamped_at:
      typeof metadata.heard_by_at === "string"
        ? metadata.heard_by_at
        : typeof row.created_date === "string"
          ? row.created_date
          : null,
    deleted_at: nowIso,
    digest: rowDigest(row),
  };
}

/** Parse stored tombstones, dropping junk, expired entries and overflow (newest 50 kept). */
export function liveTombstones(raw: unknown, sessionId: string, now: Date): Record<string, AwarenessTombstone> {
  if (!isObject(raw)) return {};
  const list: AwarenessTombstone[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    if (value.session_id !== sessionId || value.message_id !== key) continue;
    if (typeof value.digest !== "string" || typeof value.deleted_at !== "string") continue;
    const deletedAt = Date.parse(value.deleted_at);
    if (!Number.isFinite(deletedAt) || now.getTime() - deletedAt > TOMBSTONE_TTL_MS || deletedAt - now.getTime() > 60_000) continue;
    let heardBy: string[] | null;
    if (value.heard_by === null) heardBy = null;
    else {
      const read = classifyHeardBy(value.heard_by);
      heardBy = read.kind === "list" ? read.ids : [];
    }
    list.push({
      session_id: sessionId,
      message_id: key,
      heard_by: heardBy,
      stamped_at: typeof value.stamped_at === "string" ? value.stamped_at : null,
      deleted_at: value.deleted_at,
      digest: value.digest,
    });
  }
  list.sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at));
  const out: Record<string, AwarenessTombstone> = {};
  for (const t of list.slice(0, TOMBSTONE_CAP)) out[t.message_id] = t;
  return out;
}

/** Add tombstones (newest wins), then apply the cap and expiry. */
export function withTombstones(
  raw: unknown,
  sessionId: string,
  added: AwarenessTombstone[],
  now: Date,
): Record<string, AwarenessTombstone> {
  const current = liveTombstones(raw, sessionId, now);
  for (const t of added) current[t.message_id] = t;
  return liveTombstones(current, sessionId, now);
}

/**
 * The stamp a restored row gets (R1 + Serenity's integrity note): only the
 * tombstone's, and only when the content still matches; otherwise nobody.
 * `null` means restore it as legacy (it was legacy when deleted).
 */
export function restoredHeardBy(row: Row, tombstone: AwarenessTombstone | undefined): string[] | null {
  if (!tombstone) return [];
  if (tombstone.digest !== rowDigest(row)) return [];
  return tombstone.heard_by === null ? null : [...tombstone.heard_by];
}

/** Copy of `row` with `metadata.heard_by` set (or removed for legacy `null`). */
export function withHeardBy<T extends Row>(row: T, heardBy: string[] | null, stampedAt?: string): T {
  const metadata: Record<string, unknown> = isObject(row.metadata) ? { ...row.metadata } : {};
  delete metadata.heard_by;
  delete metadata.heard_by_at;
  if (heardBy !== null) {
    metadata.heard_by = heardBy;
    if (stampedAt) metadata.heard_by_at = stampedAt;
  }
  const out: Row = { ...row };
  // Never write a top-level heard_by: only metadata.heard_by is read.
  delete out.heard_by;
  if (heardBy === null && Object.keys(metadata).length === 0 && !isObject(row.metadata)) {
    delete out.metadata;
  } else {
    out.metadata = metadata;
  }
  return out as T;
}

/** Copy of `row` keeping exactly the awareness `prev` had (edits never change it). */
export function keepStoredAwareness<T extends Row>(row: T, prev: Row): T {
  const prevMeta = isObject(prev.metadata) ? prev.metadata : null;
  const metadata: Record<string, unknown> = isObject(row.metadata) ? { ...row.metadata } : {};
  delete metadata.heard_by;
  delete metadata.heard_by_at;
  if (prevMeta && Object.prototype.hasOwnProperty.call(prevMeta, "heard_by")) {
    metadata.heard_by = prevMeta.heard_by;
    if (Object.prototype.hasOwnProperty.call(prevMeta, "heard_by_at")) metadata.heard_by_at = prevMeta.heard_by_at;
  } else if (prev.metadata !== undefined && prev.metadata !== null && !prevMeta) {
    // A malformed stored metadata stays malformed-closed: nobody.
    metadata.heard_by = [];
  }
  const out: Row = { ...row };
  delete out.heard_by;
  if (!isObject(row.metadata) && Object.keys(metadata).length === 0) delete out.metadata;
  else out.metadata = metadata;
  return out as T;
}

/** Whether a row (as sent by a client) tries to say who heard it. */
export function claimsAwareness(row: unknown): boolean {
  if (!isObject(row)) return false;
  if (Object.prototype.hasOwnProperty.call(row, "heard_by")) return true;
  return isObject(row.metadata) && Object.prototype.hasOwnProperty.call(row.metadata, "heard_by");
}

/**
 * Session shared (crossover) facts a character may read. A fact stamped with
 * heard_by is hers only if she is in it and in the stored cast; an unstamped
 * (legacy) fact stays visible to the stored cast.
 */
export function sharedFactsHeardBy<T>(facts: T, characterId: string | null, cast: readonly string[]): T {
  if (!Array.isArray(facts)) return facts;
  if (!characterId || !cast.includes(characterId)) return [] as unknown as T;
  return facts.filter((fact) => {
    if (!isObject(fact)) return true;
    if (!Object.prototype.hasOwnProperty.call(fact, "heard_by")) return true;
    const heard = classifyHeardBy(fact.heard_by);
    return heard.kind === "list" && heard.ids.includes(characterId);
  }) as unknown as T;
}
