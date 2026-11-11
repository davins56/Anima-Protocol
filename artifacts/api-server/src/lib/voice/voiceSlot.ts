/**
 * One home-box voice stream at a time, across Worker isolates.
 *
 * Uses the existing `LOCAL_LLM_SLOT` Durable Object class under a separate
 * object name, `"voice"`. Durable Object instances are keyed by name, so this
 * is an independent book from the LLM's `"ollama"` slot: TTS never queues
 * behind (or blocks) a chat generate. No new class, so no DO migration.
 *
 * The slot also carries cross-isolate stop: `/stop` releases the stream id,
 * and the streaming isolate sees its heartbeat fail and cancels Kokoro.
 */
import { readRuntimeBinding } from "../cloudflareEnv";
import { createMemoryLocalLlmSlot, type LocalLlmSlotCoordinator } from "../localLlmSlot";

export const VOICE_SLOT_OBJECT_NAME = "voice";
export const VOICE_SLOT_WAIT_MS = 6_000;
export const VOICE_SLOT_POLL_MS = 250;
export const VOICE_SLOT_HEARTBEAT_MS = 1_000;

type Stub = Pick<LocalLlmSlotCoordinator, "chatStep" | "heartbeat" | "release">;
type Namespace = { getByName(name: string): Stub };

let testCoordinator: Stub | undefined;
let memory: Stub | undefined;

export function setVoiceSlotForTests(c: Stub | undefined): void {
  testCoordinator = c;
  memory = undefined;
}

export function voiceSlot(): Stub {
  if (testCoordinator) return testCoordinator;
  const ns = readRuntimeBinding("LOCAL_LLM_SLOT") as Namespace | null | undefined;
  if (ns && typeof ns === "object" && typeof ns.getByName === "function") {
    const stub = () => ns.getByName(VOICE_SLOT_OBJECT_NAME);
    return {
      chatStep: (id) => stub().chatStep(id),
      heartbeat: (id) => stub().heartbeat(id),
      release: (id) => stub().release(id),
    };
  }
  if (!memory) memory = createMemoryLocalLlmSlot();
  return memory;
}

export class VoiceSlotBusyError extends Error {
  readonly reason = "busy" as const;
  constructor() {
    super("voice slot busy");
  }
}

export type VoiceSlotGrant = { release: () => Promise<void>; stillHeld: () => Promise<boolean> };

/** FIFO wait for the voice slot; throws VoiceSlotBusyError after `waitMs`. */
export async function acquireVoiceSlot(
  id: string,
  opts: { waitMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<VoiceSlotGrant> {
  const slot = voiceSlot();
  const deadline = Date.now() + (opts.waitMs ?? VOICE_SLOT_WAIT_MS);
  while (true) {
    const step = await slot.chatStep(id);
    if (step.granted) break;
    if (opts.signal?.aborted || Date.now() >= deadline) {
      await slot.release(id).catch(() => {});
      throw new VoiceSlotBusyError();
    }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? VOICE_SLOT_POLL_MS));
  }
  let released = false;
  return {
    stillHeld: () => (released ? Promise.resolve(false) : slot.heartbeat(id).catch(() => true)),
    release: async () => {
      if (released) return;
      released = true;
      await slot.release(id).catch(() => {});
    },
  };
}

/** `/stop` from any isolate: drop the stream's hold so its heartbeat fails. */
export async function releaseVoiceSlot(id: string): Promise<void> {
  await voiceSlot().release(id).catch(() => {});
}
