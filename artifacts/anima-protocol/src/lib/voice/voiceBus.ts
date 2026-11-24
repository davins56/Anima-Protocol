/**
 * V6 → 3D Visual hand-off for mouth animation.
 *
 * One process-wide bus for whatever companion voice is playing:
 *  - `getClockMs()`: the utterance playback clock (ms actually played since the
 *    utterance began, from the player's played-frames counter, not wall time).
 *    Same timeline as every `startMs`/`endMs`/`offsetMs` in `anima-voice/1`.
 *  - `getAnalyser()`: the AnalyserNode on the output (live level), or null.
 *  - `getCues()`: viseme cues received so far for the current utterance.
 *  - `subscribe(fn)`: events `start`, `visemes`, `word`, `stop` (fired
 *    synchronously the moment playback is cut, before any network call), and
 *    `end`.
 * Also mirrored as a `window` CustomEvent named "anima:voice" with the same
 * payload, for code that can't import this module.
 */
import type { VisemeCue } from "./localVoiceApi";

export type VoiceBusEvent =
  | { type: "start"; characterId: string; utteranceId: string }
  | { type: "visemes"; utteranceId: string; cues: VisemeCue[] }
  | { type: "word"; utteranceId: string; word: string; startMs: number; endMs: number }
  | { type: "stop"; utteranceId: string; heardMs: number; reason: "barge_in" | "user_stop" | "navigation" }
  | { type: "end"; utteranceId: string; reason: "completed" | "stopped" | "error" | "offline" };

type Listener = (e: VoiceBusEvent) => void;

const listeners = new Set<Listener>();
let clock: () => number = () => 0;
let analyser: AnalyserNode | null = null;
let cues: VisemeCue[] = [];
let active: { characterId: string; utteranceId: string } | null = null;

export const VOICE_BUS_EVENT = "anima:voice";

function emit(e: VoiceBusEvent) {
  for (const fn of [...listeners]) {
    try {
      fn(e);
    } catch {
      // A listener never breaks playback.
    }
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(VOICE_BUS_EVENT, { detail: e }));
  } catch {
    // Non-DOM runtime.
  }
}

export const voicePlayback = {
  getClockMs: () => (active ? clock() : 0),
  getAnalyser: () => (active ? analyser : null),
  getCues: () => cues,
  getActive: () => active,
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Internal: used by LocalSpeaker. */
export const voiceBusControl = {
  start(characterId: string, utteranceId: string, getClock: () => number, node: AnalyserNode | null) {
    active = { characterId, utteranceId };
    clock = getClock;
    analyser = node;
    cues = [];
    emit({ type: "start", characterId, utteranceId });
  },
  visemes(utteranceId: string, next: VisemeCue[]) {
    if (active?.utteranceId !== utteranceId) return;
    cues = cues.concat(next);
    emit({ type: "visemes", utteranceId, cues: next });
  },
  word(utteranceId: string, word: string, startMs: number, endMs: number) {
    if (active?.utteranceId !== utteranceId) return;
    emit({ type: "word", utteranceId, word, startMs, endMs });
  },
  stop(utteranceId: string, heardMs: number, reason: "barge_in" | "user_stop" | "navigation") {
    if (active?.utteranceId !== utteranceId) return;
    emit({ type: "stop", utteranceId, heardMs, reason });
  },
  end(utteranceId: string, reason: "completed" | "stopped" | "error" | "offline") {
    if (active?.utteranceId !== utteranceId) return;
    active = null;
    analyser = null;
    clock = () => 0;
    emit({ type: "end", utteranceId, reason });
  },
};
