/**
 * Deepnet (working name) vertical slice API (#757). Flag-gated, server-decided.
 *
 *   GET  /api/deepnet/status                      → { enabled, allowed, display_name }
 *   GET  /api/deepnet/map?character_id=           → DeepnetMap (locks from server quest state)
 *   POST /api/deepnet/enter   { character_id, node_id }
 *   GET  /api/deepnet/quest?character_id=&quest_id=   → quest state + content view
 *   POST /api/deepnet/quest/events { character_id, quest_id, step, expected_seq,
 *                                    dialogue_choices?, option_id?, tuned_w? }
 *
 * Order: flag (404 when off: the feature is invisible) → Clerk session (401) →
 * allowlist ANIMA_DEEPNET_USER_IDS (403, logged) → rate limit → character ownership
 * (403, logged) → action. user_id comes only from the session; the bond tier is
 * read on the server; outcomes are computed by @workspace/deepnet-core.
 *
 * No model calls, no tools, no outbound fetch, no SQL writes. Quest state uses the
 * in-memory stub adapter until migration U2 is approved; the access log writes app
 * logs until U1 is approved. Nothing here changes adult mode: the slice has no chat.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import {
  DEEPNET_CONTENT_VERSION,
  DEEPNET_DISPLAY_NAME,
  DEEPNET_MAP_SPEC,
  GREY_CORRIDOR,
  QUESTS,
  applyQuestEvent,
  availableOptions,
  bondTierForScore,
  buildMap,
  emptyQuestState,
  loreText,
  nextQuestEvent,
  replayQuest,
  type BondTier,
  type QuestDefinition,
  type QuestError,
  type QuestRequest,
  type QuestState,
} from "@workspace/deepnet-core";
import { rateLimit as defaultRateLimit } from "../lib/rateLimit";
import { characterOwnedBy } from "../lib/memoryCore/characterOwnedBy";
import { loadRelationshipState } from "../lib/relationshipEngine";
import { decideDeepnetAccess, deepnetEnabled } from "../lib/deepnet/access";
import { appLogAccessLog, type DeepnetAccessLog } from "../lib/deepnet/accessLog";
import { defaultQuestStore, type DeepnetQuestStore } from "../lib/deepnet/questStore";

export type DeepnetDeps = {
  env?: NodeJS.ProcessEnv;
  questStore?: DeepnetQuestStore;
  accessLog?: DeepnetAccessLog;
  ownsCharacter?: (userId: string, characterId: string) => Promise<boolean>;
  /** 0..100 bond score for (user, character), read on the server. */
  bondScore?: (userId: string, characterId: string) => Promise<number>;
  rateLimit?: (req: Request, res: Response, next: NextFunction) => unknown;
  now?: () => string;
};

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function serverBondScore(userId: string, characterId: string): Promise<number> {
  const state = await loadRelationshipState(characterId, userId);
  const level = state?.relationship_level;
  return typeof level === "number" && Number.isFinite(level) ? level : 0;
}

const STATUS_BY_ERROR: Record<QuestError, number> = {
  bad_step: 400,
  out_of_order: 409,
  already_resolved: 409,
  bad_log: 409,
  bad_choice: 422,
  encounter_incomplete: 422,
  unknown_option: 422,
  option_locked: 403,
  invalid_w: 422,
  bad_tier: 500,
};

function questView(def: QuestDefinition, state: QuestState, tier: BondTier) {
  const open = new Set(availableOptions(def.gate, tier).map((o) => o.id));
  return {
    quest_id: def.id,
    content_version: DEEPNET_CONTENT_VERSION,
    state: { step: state.step, seq: state.seq, outcome: state.outcome, events: state.events },
    bond_tier: tier,
    corridor: {
      id: GREY_CORRIDOR.id,
      name: loreText(GREY_CORRIDOR.name),
      description: loreText(GREY_CORRIDOR.description),
      ambient_band: GREY_CORRIDOR.ambientBand,
      segments: GREY_CORRIDOR.segments.map((s) => ({ id: s.id, kind: s.kind, label: loreText(s.label), at: s.at, requires: s.requires })),
    },
    dialogue: {
      id: def.dialogue.id,
      start: def.dialogue.start,
      nodes: def.dialogue.nodes.map((n) => ({
        id: n.id,
        speaker: loreText(n.speaker),
        line: loreText(n.line),
        choices: n.choices.map((c) => ({ id: c.id, label: loreText(c.label), next: c.next })),
      })),
    },
    gate: {
      id: def.gate.id,
      band: def.gate.band,
      prompt: loreText(def.gate.prompt),
      options: def.gate.options.map((o) => ({ id: o.id, label: loreText(o.label), min_tier: o.minTier, available: open.has(o.id) })),
    },
  };
}

export function createDeepnetRouter(deps: DeepnetDeps = {}) {
  const env = () => deps.env ?? process.env;
  const store = deps.questStore ?? defaultQuestStore;
  const log = deps.accessLog ?? appLogAccessLog;
  const owns = deps.ownsCharacter ?? characterOwnedBy;
  const bond = deps.bondScore ?? serverBondScore;
  const limiter = deps.rateLimit ?? defaultRateLimit;
  const now = deps.now ?? (() => new Date().toISOString());

  const router = Router();

  const deny = (req: Request, res: Response, userId: string | null, characterId: string | null, reason: string, status: number) => {
    log.record({ userId, characterId, action: "denied", reason, route: `${req.method} ${req.path}`, at: now() });
    res.status(status).json({ error: status === 401 ? "Unauthorized" : "Not available", code: status === 401 ? "signed_out" : "not_available" });
  };

  // 1. Flag: invisible when off.
  router.use((req, res, next) => {
    if (!deepnetEnabled(env())) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  });

  // 2–3. Session + allowlist.
  router.use((req, res, next) => {
    const { userId } = getAuth(req);
    const access = decideDeepnetAccess(userId, env());
    if (!access.allowed) {
      deny(req, res, userId ?? null, null, access.reason, access.reason === "signed_out" ? 401 : 403);
      return;
    }
    res.locals.deepnetUserId = userId;
    next();
  });

  // 4. Rate limit (after the gate so outsiders never touch shared buckets).
  router.use((req, res, next) => limiter(req, res, next));

  router.get("/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: true, allowed: true, display_name: DEEPNET_DISPLAY_NAME });
  });

  /** 5. Ownership of the character named in the request. */
  async function ownedCharacter(req: Request, res: Response, raw: unknown): Promise<{ userId: string; characterId: string } | null> {
    const userId = String(res.locals.deepnetUserId);
    const characterId = typeof raw === "string" ? raw.trim() : "";
    if (!ID_RE.test(characterId)) {
      res.status(400).json({ error: "character_id is required", code: "bad_character" });
      return null;
    }
    let ok = false;
    try {
      ok = await owns(userId, characterId);
    } catch {
      res.status(503).json({ error: "Ownership check unavailable", code: "owner_check_failed" });
      return null;
    }
    if (!ok) {
      deny(req, res, userId, characterId, "not_owner", 403);
      return null;
    }
    return { userId, characterId };
  }

  async function loadState(userId: string, characterId: string, def: QuestDefinition): Promise<QuestState> {
    const events = await store.load(userId, characterId, def.id);
    const replayed = replayQuest(def, events);
    // A log that no longer replays (e.g. content changed) is treated as empty rather than trusted.
    return replayed.ok ? replayed.state : emptyQuestState(def.id);
  }

  async function tierFor(userId: string, characterId: string): Promise<BondTier> {
    try {
      return bondTierForScore(await bond(userId, characterId));
    } catch {
      return "distant";
    }
  }

  router.get("/map", async (req, res) => {
    const who = await ownedCharacter(req, res, req.query.character_id);
    if (!who) return;
    const quests: Record<string, QuestState> = {};
    for (const def of Object.values(QUESTS)) quests[def.id] = await loadState(who.userId, who.characterId, def);
    res.setHeader("Cache-Control", "no-store");
    res.json(buildMap(DEEPNET_MAP_SPEC, quests));
  });

  router.post("/enter", async (req, res) => {
    const who = await ownedCharacter(req, res, req.body?.character_id);
    if (!who) return;
    const nodeId = typeof req.body?.node_id === "string" ? req.body.node_id : "";
    const quests: Record<string, QuestState> = {};
    for (const def of Object.values(QUESTS)) quests[def.id] = await loadState(who.userId, who.characterId, def);
    const node = buildMap(DEEPNET_MAP_SPEC, quests).nodes.find((n) => n.id === nodeId);
    if (!node) {
      res.status(404).json({ error: "Unknown node", code: "unknown_node" });
      return;
    }
    if (node.locked) {
      deny(req, res, who.userId, who.characterId, "node_locked", 403);
      return;
    }
    log.record({ userId: who.userId, characterId: who.characterId, action: "enter", reason: "ok", nodeId, route: "POST /enter", at: now() });
    res.json({ node, quest_id: node.id === GREY_CORRIDOR.nodeId ? GREY_CORRIDOR.questId : null });
  });

  router.get("/quest", async (req, res) => {
    const who = await ownedCharacter(req, res, req.query.character_id);
    if (!who) return;
    const def = QUESTS[String(req.query.quest_id ?? "")];
    if (!def) {
      res.status(404).json({ error: "Unknown quest", code: "unknown_quest" });
      return;
    }
    const [state, tier] = await Promise.all([loadState(who.userId, who.characterId, def), tierFor(who.userId, who.characterId)]);
    res.setHeader("Cache-Control", "no-store");
    res.json(questView(def, state, tier));
  });

  router.post("/quest/events", async (req, res) => {
    const body = req.body ?? {};
    const who = await ownedCharacter(req, res, body.character_id);
    if (!who) return;
    const def = QUESTS[String(body.quest_id ?? "")];
    if (!def) {
      res.status(404).json({ error: "Unknown quest", code: "unknown_quest" });
      return;
    }
    const state = await loadState(who.userId, who.characterId, def);
    if (body.expected_seq !== state.seq) {
      res.status(409).json({ error: "Quest state changed; reload", code: "stale_seq", seq: state.seq });
      return;
    }
    // Only these fields are read from the body. Tier/outcome/band in the body are ignored.
    const request = {
      step: body.step,
      dialogueChoices: body.dialogue_choices,
      optionId: body.option_id,
      tunedW: body.tuned_w,
    } as QuestRequest;
    const tier = await tierFor(who.userId, who.characterId);
    const out = nextQuestEvent(def, state, request, { bondTier: tier, contentVersion: DEEPNET_CONTENT_VERSION, now: now() });
    if (!out.ok) {
      res.status(STATUS_BY_ERROR[out.code] ?? 400).json({ error: "Step rejected", code: out.code });
      return;
    }
    const appended = await store.append(who.userId, who.characterId, def.id, state.seq, out.event);
    if (!appended) {
      res.status(409).json({ error: "Quest state changed; reload", code: "stale_seq" });
      return;
    }
    res.status(201).json(questView(def, applyQuestEvent(state, out.event), tier));
  });

  return router;
}

export default createDeepnetRouter();
