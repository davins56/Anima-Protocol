/**
 * One local-Ollama slot shared across Worker isolates.
 *
 * Production uses the `LOCAL_LLM_SLOT` Durable Object (see wrangler.jsonc).
 * Node, vitest, and a Worker that has not bound the object yet share an
 * in-process book — correct for one process, not across isolates.
 *
 * Chat turns wait FIFO and jump ahead of every queued background job.
 * A background holder is told to yield as soon as a chat turn arrives.
 * Chat waits at most `LLM_BACKGROUND_YIELD_MS` for that abort, then takes
 * the slot. The 90s first-token budget starts at acquisition, not while
 * the turn is queued.
 *
 * Hosted / non-local chains never take the slot. `ANIMA_LOCAL_LLM_SLOT=false`
 * turns the feature off. The default is on whenever the chain is local-only.
 */

import { readRuntimeBinding } from "./cloudflareEnv";
import {
  capBackgroundNumPredict,
  LLM_BACKGROUND_SLOT_TTL_MS,
  LLM_BACKGROUND_WALL_MS,
  LLM_BACKGROUND_YIELD_MS,
  LLM_BACKGROUND_YIELD_POLL_MS,
  LLM_LOCAL_FIRST_TOKEN_MS,
  LLM_LOCAL_SLOT_HEARTBEAT_MS,
  LLM_LOCAL_SLOT_POLL_MS,
  LLM_LOCAL_SLOT_QUEUE_TTL_MS,
  LLM_LOCAL_SLOT_TTL_MS,
  LLM_LOCAL_SLOT_WAIT_MS,
} from "./chatTimeouts";
import { isLocalOnlyProviderChain } from "./llmFailover";
import {
  admitBackgroundJob,
  backgroundJobDefers,
  type LocalLlmJobId,
} from "./localLlmPriority";
import { backgroundLlmSignal } from "./sidecarLlm";
import {
  applyChatStep,
  applyEnqueueBackground,
  applyHeartbeat,
  applyPollBackground,
  applyRelease,
  applyTryBackground,
  emptySlotBook,
  type BackgroundPoll,
  type SlotBook,
  type SlotStep,
} from "./localLlmSlotState";

const OFF_VALUES = new Set(["0", "false", "off", "no"]);
const SLOT_OBJECT_NAME = "ollama";

export class LocalLlmSlotWaitError extends Error {
  readonly code = "llm_slot_wait_timeout";

  constructor() {
    super(
      "The companion is still finishing another reply. Please try again in a moment.",
    );
    this.name = "LocalLlmSlotWaitError";
  }
}

export class LocalLlmSlotClientLeftError extends Error {
  readonly code = "llm_slot_client_left";

  constructor() {
    super("The chat client left before the model was free.");
    this.name = "LocalLlmSlotClientLeftError";
  }
}

export type LocalLlmSlotCoordinator = {
  chatStep(turnId: string): Promise<SlotStep>;
  tryBackground(id: string): Promise<boolean>;
  enqueueBackground(id: string): Promise<number>;
  pollBackground(id: string): Promise<BackgroundPoll>;
  heartbeat(id: string): Promise<boolean>;
  release(id: string): Promise<void>;
};

export type LocalChatSlotGrant = {
  acquiredAt: number;
  waitedMs: number;
  /** `acquiredAt + LLM_LOCAL_FIRST_TOKEN_MS`. Queue time is not included. */
  firstTokenDeadline: number;
  release: () => Promise<void>;
};

type SlotStub = {
  chatStep(turnId: string): Promise<SlotStep>;
  tryBackground(id: string): Promise<boolean>;
  enqueueBackground(id: string): Promise<number>;
  pollBackground(id: string): Promise<BackgroundPoll>;
  heartbeat(id: string): Promise<boolean>;
  release(id: string): Promise<void>;
};

type SlotNamespace = {
  getByName(name: string): SlotStub;
};

let testCoordinator: LocalLlmSlotCoordinator | undefined;
let memorySlot: LocalLlmSlotCoordinator | undefined;

/**
 * Partial test mocks of llmFailover omit this export and throw on access.
 * Missing or unreadable means the chain is not known to be local-only, so
 * the slot stays off and hosted callers keep their previous behavior.
 */
function chainIsLocalOnly(): boolean {
  try {
    return typeof isLocalOnlyProviderChain === "function" && isLocalOnlyProviderChain();
  } catch {
    return false;
  }
}

export function localLlmSlotEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isLocalHost: boolean = chainIsLocalOnly(),
): boolean {
  const raw = String(env.ANIMA_LOCAL_LLM_SLOT ?? "").trim().toLowerCase();
  if (OFF_VALUES.has(raw)) return false;
  return isLocalHost;
}

export function createMemoryLocalLlmSlot(options?: {
  now?: () => number;
  ttlMs?: number;
  queueTtlMs?: number;
  yieldMs?: number;
  backgroundLeaseMs?: number;
  backgroundWallMs?: number;
}): LocalLlmSlotCoordinator {
  const book: SlotBook = emptySlotBook();
  const now = options?.now ?? (() => Date.now());
  const ttlMs = options?.ttlMs ?? LLM_LOCAL_SLOT_TTL_MS;
  const queueTtlMs = options?.queueTtlMs ?? LLM_LOCAL_SLOT_QUEUE_TTL_MS;
  let chain: Promise<void> = Promise.resolve();
  const run = <T>(fn: () => T): Promise<T> => {
    const result = chain.then(fn);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const backgroundLimits = {
    leaseMs: options?.backgroundLeaseMs ?? LLM_BACKGROUND_SLOT_TTL_MS,
    wallMs: options?.backgroundWallMs ?? LLM_BACKGROUND_WALL_MS,
  };
  const yieldMs = options?.yieldMs ?? LLM_BACKGROUND_YIELD_MS;
  return {
    chatStep: (turnId) =>
      run(() => applyChatStep(book, turnId, now(), ttlMs, queueTtlMs, yieldMs)),
    tryBackground: (id) =>
      run(() => applyTryBackground(book, id, now(), ttlMs, queueTtlMs, backgroundLimits)),
    enqueueBackground: (id) =>
      run(() => applyEnqueueBackground(book, id, now(), queueTtlMs)),
    pollBackground: (id) =>
      run(() => applyPollBackground(book, id, now(), queueTtlMs)),
    heartbeat: (id) =>
      run(() => applyHeartbeat(book, id, now(), ttlMs, queueTtlMs)),
    release: (id) =>
      run(() => {
        applyRelease(book, id, now(), queueTtlMs);
      }),
  };
}

function readSlotNamespace(): SlotNamespace | null {
  const value = readRuntimeBinding("LOCAL_LLM_SLOT");
  if (!value || typeof value !== "object") return null;
  if (typeof (value as { getByName?: unknown }).getByName !== "function") {
    return null;
  }
  return value as SlotNamespace;
}

function createDoCoordinator(namespace: SlotNamespace): LocalLlmSlotCoordinator {
  const stub = () => namespace.getByName(SLOT_OBJECT_NAME);
  return {
    chatStep: (turnId) => stub().chatStep(turnId),
    tryBackground: (id) => stub().tryBackground(id),
    enqueueBackground: (id) => stub().enqueueBackground(id),
    pollBackground: (id) => stub().pollBackground(id),
    heartbeat: (id) => stub().heartbeat(id),
    release: (id) => stub().release(id),
  };
}

export function getLocalLlmSlotCoordinator(): LocalLlmSlotCoordinator {
  if (testCoordinator) return testCoordinator;
  const namespace = readSlotNamespace();
  if (namespace) return createDoCoordinator(namespace);
  if (!memorySlot) memorySlot = createMemoryLocalLlmSlot();
  return memorySlot;
}

/** Test-only: force a coordinator, or clear the override and the memory book. */
export function setLocalLlmSlotCoordinatorForTests(
  coordinator: LocalLlmSlotCoordinator | undefined,
): void {
  testCoordinator = coordinator;
}

export function resetLocalLlmSlotForTests(): void {
  testCoordinator = undefined;
  memorySlot = undefined;
}

const noopGrant = {
  release: async () => {},
  signal: new AbortController().signal,
  maxTokens: (requested: number) => requested,
};

export type LocalBackgroundGrant = {
  release: () => Promise<void>;
  /** Aborts when chat asks this holder to yield, or the wall cap hits. */
  signal: AbortSignal;
  /** Clamp a requested token budget to the background cap. */
  maxTokens: (requested?: number) => number;
};

export type AcquireBackgroundOptions = {
  /** Which policy row to apply. Defaults to skip-while-chatting. */
  job?: LocalLlmJobId;
  /**
   * Drain path: take the slot if chat is not waiting, even inside the
   * quiet window. Still yields when a chat turn arrives.
   */
  force?: boolean;
  /**
   * Caller already holds the same-isolate companion counter. The quiet
   * window is still the Postgres ledger.
   */
  ledgerOnly?: boolean;
  /** Called once when the job is deferred instead of started. */
  onDefer?: () => Promise<void> | void;
};

/**
 * Try to take the slot for work that is not a chat turn.
 * `null` means skip or defer this call. A noop release means the feature is off.
 * While the grant is held, `signal` aborts if a chat turn wants the slot.
 */
export async function acquireLocalLlmBackground(
  id: string,
  options: AcquireBackgroundOptions = {},
): Promise<LocalBackgroundGrant | null> {
  if (!localLlmSlotEnabled()) return noopGrant;
  const job = options.job ?? "sidecar";
  const coordinator = getLocalLlmSlotCoordinator();
  if (!options.force) {
    const decision = await admitBackgroundJob(job, { ledgerOnly: options.ledgerOnly });
    if (decision === "skip") return null;
    if (decision === "defer") {
      // The row in local_llm_deferred_jobs is the queue. Parking a slot-book
      // entry here blocks drain when the stored id and this id differ.
      await options.onDefer?.();
      return null;
    }
  }
  const granted = await coordinator.tryBackground(id);
  if (!granted) {
    if (!options.force && backgroundJobDefers(job)) {
      await options.onDefer?.();
    }
    return null;
  }
  const abort = new AbortController();
  const wall = setTimeout(() => abort.abort(), LLM_BACKGROUND_WALL_MS);
  wall.unref?.();
  const onBackgroundAbort = () => abort.abort();
  const background = backgroundLlmSignal();
  if (background.aborted) abort.abort();
  else background.addEventListener("abort", onBackgroundAbort, { once: true });
  const timer = setInterval(() => {
    void coordinator
      .pollBackground(id)
      .then((status) => {
        if (!status.held || status.yield) abort.abort();
      })
      .catch(() => {});
  }, LLM_BACKGROUND_YIELD_POLL_MS);
  timer.unref?.();
  let released = false;
  return {
    signal: abort.signal,
    maxTokens: (requested?: number) => capBackgroundNumPredict(requested),
    release: async () => {
      if (released) return;
      released = true;
      clearTimeout(wall);
      clearInterval(timer);
      background.removeEventListener("abort", onBackgroundAbort);
      await coordinator.release(id);
    },
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Wait until this chat turn holds the local slot.
 * `firstTokenDeadline` is measured from acquisition.
 */
export async function waitForLocalChatSlot(options: {
  turnId: string;
  onWaiting?: (position: number) => void;
  shouldStop?: () => boolean;
  coordinator?: LocalLlmSlotCoordinator;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
  pollMs?: number;
}): Promise<LocalChatSlotGrant> {
  const coordinator = options.coordinator ?? getLocalLlmSlotCoordinator();
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const waitMs = options.waitMs ?? LLM_LOCAL_SLOT_WAIT_MS;
  const pollMs = options.pollMs ?? LLM_LOCAL_SLOT_POLL_MS;
  const turnId = String(options.turnId || "").trim();
  const started = now();
  const deadline = started + waitMs;

  const leave = async () => {
    await coordinator.release(turnId);
  };

  while (true) {
    const step = await coordinator.chatStep(turnId);
    if (step.granted) {
      const acquiredAt = now();
      const timer = setInterval(() => {
        void coordinator.heartbeat(turnId).catch(() => {});
      }, LLM_LOCAL_SLOT_HEARTBEAT_MS);
      timer.unref?.();
      let released = false;
      return {
        acquiredAt,
        waitedMs: Math.max(0, acquiredAt - started),
        firstTokenDeadline: acquiredAt + LLM_LOCAL_FIRST_TOKEN_MS,
        release: async () => {
          if (released) return;
          released = true;
          clearInterval(timer);
          await coordinator.release(turnId);
        },
      };
    }
    // A free slot is taken even if the browser already left, so the late
    // reply can still be saved. A client that leaves while queued drops
    // its place instead of holding the line.
    if (options.shouldStop?.()) {
      await leave();
      throw new LocalLlmSlotClientLeftError();
    }
    options.onWaiting?.(step.position);
    const at = now();
    if (at >= deadline) {
      await leave();
      throw new LocalLlmSlotWaitError();
    }
    await sleep(Math.max(1, Math.min(pollMs, deadline - at)));
  }
}
