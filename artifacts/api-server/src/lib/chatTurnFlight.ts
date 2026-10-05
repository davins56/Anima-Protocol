/**
 * In-isolate join for one user turn.
 *
 * `turn_id` is the idempotency key. A second POST with the same id and the
 * same user text waits on the generate already running here instead of
 * starting another Ollama request. A pending row with no local flight
 * (other isolate, or a crashed owner) is not claimed — the route returns
 * 409 and the client polls.
 */

export type ChatTurnFlightOutcome = {
  content: string;
  done: Record<string, unknown>;
};

export class ChatTurnFlightElsewhere extends Error {
  code = "turn_in_flight";
  constructor() {
    super("This chat turn is already being processed.");
    this.name = "ChatTurnFlightElsewhere";
  }
}

type FlightRecord = {
  userContent: string;
  promise: Promise<ChatTurnFlightOutcome>;
  resolve: (value: ChatTurnFlightOutcome) => void;
  reject: (err: unknown) => void;
  settled: boolean;
  /** Same-isolate retries waiting on this generate. The owner is not counted. */
  waiters: number;
};

const flights = new Map<string, FlightRecord>();

export type ChatTurnFlightReservation = {
  joined: boolean;
  mismatched: boolean;
  result: Promise<ChatTurnFlightOutcome>;
  resolve: (value: ChatTurnFlightOutcome) => void;
  /** Pending in the database, but this isolate is not generating it. */
  abandon: () => void;
  fail: (err: unknown) => void;
  /** Drop a same-isolate join so a disconnect does not keep the model slot. */
  releaseWaiter: () => void;
};

function releaseLater(turnId: string, record: FlightRecord) {
  queueMicrotask(() => {
    if (flights.get(turnId) === record) flights.delete(turnId);
  });
}

/**
 * Reserve the in-flight slot for `turnId`, or subscribe to the slot that
 * already exists for the same user text.
 */
export function reserveChatTurnFlight(
  turnId: string,
  userContent: string,
): ChatTurnFlightReservation {
  const existing = flights.get(turnId);
  if (existing) {
    if (existing.userContent !== userContent) {
      const rejected = Promise.reject(new ChatTurnFlightElsewhere());
      rejected.catch(() => {});
      return {
        joined: false,
        mismatched: true,
        result: rejected,
        resolve: () => {},
        abandon: () => {},
        fail: () => {},
        releaseWaiter: () => {},
      };
    }
    existing.waiters += 1;
    let released = false;
    return {
      joined: true,
      mismatched: false,
      result: existing.promise,
      resolve: () => {},
      abandon: () => {},
      fail: () => {},
      releaseWaiter: () => {
        if (released) return;
        released = true;
        existing.waiters = Math.max(0, existing.waiters - 1);
      },
    };
  }

  let resolveOutcome: (value: ChatTurnFlightOutcome) => void = () => {};
  let rejectOutcome: (err: unknown) => void = () => {};
  const promise = new Promise<ChatTurnFlightOutcome>((resolve, reject) => {
    resolveOutcome = resolve;
    rejectOutcome = reject;
  });
  // A joiner may attach after the owner already settled a replay.
  promise.catch(() => {});

  const record: FlightRecord = {
    userContent,
    promise,
    resolve: resolveOutcome,
    reject: rejectOutcome,
    settled: false,
    waiters: 0,
  };
  flights.set(turnId, record);

  const settle = (run: () => void) => {
    if (record.settled) return;
    record.settled = true;
    run();
    releaseLater(turnId, record);
  };

  return {
    joined: false,
    mismatched: false,
    result: promise,
    resolve: (value) => settle(() => record.resolve(value)),
    abandon: () => settle(() => record.reject(new ChatTurnFlightElsewhere())),
    fail: (err) => settle(() => record.reject(err)),
    releaseWaiter: () => {},
  };
}

/** Same-isolate retries subscribed to this turn. Zero when this isolate is not the owner. */
export function chatTurnFlightWaiters(turnId: string): number {
  return flights.get(turnId)?.waiters ?? 0;
}

export function isChatTurnFlightElsewhere(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: unknown }).code === "turn_in_flight";
}

/** Test helper. */
export function resetChatTurnFlightsForTests(): void {
  flights.clear();
}
