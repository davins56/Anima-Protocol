/**
 * Chat reply failure types.
 *
 * `phase` reuses the server `chat_pipeline` failure_phase names from
 * `./chatTelemetry.ts`: queue, prefill, decode, post.
 * Do not add a second phase vocabulary.
 *
 * `userMessage` is reserved for a later plain-language toast. It stays null
 * so the HUD copy the user sees today does not change.
 *
 * Twin list: `artifacts/anima-protocol/src/lib/chatFailureTypes.js`.
 * `test/chatFailureTypes.sync.test.ts` fails if they drift.
 */

export const CHAT_FAILURE_PHASES = ["queue", "prefill", "decode", "post"] as const;

export type ChatFailurePhase = (typeof CHAT_FAILURE_PHASES)[number];

export type ChatFailureType = {
  id: string;
  phase: ChatFailurePhase;
  description: string;
  /** Reserved for later HUD copy. Null keeps today's toasts unchanged. */
  userMessage: string | null;
};

export const CHAT_FAILURE_TYPES: readonly ChatFailureType[] = [
  {
    id: "queue",
    phase: "queue",
    description:
      "Failed before generation started, including the local model slot wait.",
    userMessage: null,
  },
  {
    id: "prefill",
    phase: "prefill",
    description:
      "Failed after the model slot was held and before the first token.",
    userMessage: null,
  },
  {
    id: "decode",
    phase: "decode",
    description: "Failed once reply tokens were arriving.",
    userMessage: null,
  },
  {
    id: "post",
    phase: "post",
    description:
      "Failed after reply text was in hand, during checkpoint or an empty reply.",
    userMessage: null,
  },
  {
    id: "queue_waiting",
    phase: "queue",
    description:
      "The client was still waiting in the model queue when the reply failed.",
    userMessage: null,
  },
  {
    id: "queue_timeout",
    phase: "queue",
    description: "The client timed out while waiting in the model queue.",
    userMessage: null,
  },
  {
    id: "no_first_token",
    phase: "prefill",
    description:
      "The reply ended with no token after the client had left the queue.",
    userMessage: null,
  },
  {
    id: "stream_dropped",
    phase: "decode",
    description:
      "The stream dropped after at least one token and before a normal done.",
    userMessage: null,
  },
  {
    id: "network_lost",
    phase: "prefill",
    description:
      "The browser lost the connection, for example Mobile Safari Load failed.",
    userMessage: null,
  },
  {
    id: "auth_expired",
    phase: "queue",
    description:
      "The session was missing or the server rejected it as unauthorized.",
    userMessage: null,
  },
  {
    id: "server_error",
    phase: "prefill",
    description:
      "The server returned an error status or an error event for this reply.",
    userMessage: null,
  },
  {
    id: "save_failed",
    phase: "post",
    description:
      "A reply or partial reply was kept locally but saving it failed.",
    userMessage: null,
  },
];

export type ChatFailureTypeId = (typeof CHAT_FAILURE_TYPES)[number]["id"];

const BY_ID = new Map(CHAT_FAILURE_TYPES.map((entry) => [entry.id, entry]));

export function chatFailureTypeById(id: unknown): ChatFailureType | null {
  if (typeof id !== "string") return null;
  return BY_ID.get(id) ?? null;
}

export function isChatFailurePhase(value: unknown): value is ChatFailurePhase {
  return (CHAT_FAILURE_PHASES as readonly string[]).includes(String(value));
}
