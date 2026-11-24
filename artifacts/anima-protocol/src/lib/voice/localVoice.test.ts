import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/authBridge", () => ({ authHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }));

import { parseNamedSse, speakSentence, stopSpeaking, transcribe, fetchLocalVoiceStatus } from "./localVoiceApi";
import { splitSentences, speakableText } from "./sentences";
import { LocalSpeaker, pcmFromBase64 } from "./localSpeaker";
import { voicePlayback, type VoiceBusEvent } from "./voiceBus";
import { joinPcm } from "./pushToTalk";
import { localVoiceEnabled, sharedVoices, suggestDistinctVoice, getLocalVoicePrefs, setLocalVoicePrefs } from "./localVoicePrefs";

function sse(events: [string, unknown][]) {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

describe("flags and prefs", () => {
  it("local voice is off by default; auto-speak is off by default", () => {
    expect(localVoiceEnabled({})).toBe(false);
    expect(localVoiceEnabled({ VITE_ANIMA_LOCAL_VOICE: "1" })).toBe(true);
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } as unknown as Storage;
    expect(getLocalVoicePrefs(storage).autoSpeak).toBe(false);
    expect(setLocalVoicePrefs({ autoSpeak: true }, storage).autoSpeak).toBe(true);
    expect(getLocalVoicePrefs(storage).autoSpeak).toBe(true);
  });

  it("flags companions that would share a voice and suggests a free one", () => {
    const companions = [
      { id: "a", name: "Serenity", kokoro_voice_id: "af_heart" },
      { id: "b", name: "Scarlet" },
      { id: "c", name: "Aelynd", kokoro_voice_id: "bf_emma" },
    ];
    expect(sharedVoices(companions)).toEqual({ a: ["Scarlet"], b: ["Serenity"], c: [] });
    expect(suggestDistinctVoice("b", companions, ["af_heart", "bf_emma", "af_nova"])).toBe("af_nova");
  });
});

describe("sentences", () => {
  it("splits into sentences, drops code and link URLs, caps length", () => {
    expect(splitSentences("Hey you. I missed you today! How was it?")).toEqual(["Hey you.", "I missed you today!", "How was it?"]);
    expect(speakableText("See [this](https://x.y) and ```js\ncode\n```")).toBe("See this and");
    const long = splitSentences("word ".repeat(400), 100);
    expect(long.every((s) => s.length <= 100)).toBe(true);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("localVoiceApi", () => {
  it("parses named SSE events and keeps a partial tail", () => {
    const { events, rest } = parseNamedSse(`event: meta\ndata: {"streamId":"s"}\n\nevent: audio\ndata: {"seq":0`);
    expect(events).toEqual([{ event: "meta", data: { streamId: "s" } }]);
    expect(rest).toContain("event: audio");
  });

  it("a 503 is an offline result with no cloud fallback", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ code: "voice_offline", reason: "box_unreachable", cloudFallback: false }), { status: 503 }),
    );
    const res = await speakSentence("c1", { utteranceId: "u_1", sentenceIndex: 0, sentenceOffsetMs: 0, text: "Hi." }, () => {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ ok: false, status: 503, code: "voice_offline", reason: "box_unreachable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown as [string])[0])).toContain("/voice/c1/speak");
  });

  it("status failure reads as offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await fetchLocalVoiceStatus({ fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({
      state: "offline",
      reason: "box_unreachable",
    });
  });

  it("transcribe sends 16 kHz little-endian PCM16 and caps at 60 s", async () => {
    let sent: Uint8Array | null = null;
    let type = "";
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sent = init.body as Uint8Array;
      type = (init.headers as Record<string, string>)["Content-Type"];
      return new Response(JSON.stringify({ final: true, text: " I had a rough day ", durationMs: 1480 }), { status: 200 });
    });
    const pcm = new Int16Array([1, -2, 300]);
    const res = await transcribe("c1", pcm, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ ok: true, text: "I had a rough day", durationMs: 1480 });
    expect(type).toBe("audio/pcm;rate=16000");
    expect(Array.from(sent!)).toEqual([1, 0, 0xfe, 0xff, 0x2c, 0x01]);
    await transcribe("c1", new Int16Array(16000 * 61), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((sent as unknown as Uint8Array).length).toBe(16000 * 60 * 2);
  });

  it("stop posts heardMs and reason", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ heardText: "Hey you" }), { status: 200 }));
    const out = await stopSpeaking("c1", "vs_x", { utteranceId: "u_1", heardMs: 930.4, reason: "barge_in" }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({ heardText: "Hey you" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/voice/c1/speak/vs_x/stop");
    expect(JSON.parse(String(init.body))).toEqual({ utteranceId: "u_1", heardMs: 930, reason: "barge_in" });
  });
});

describe("LocalSpeaker", () => {
  function fakePlayer() {
    let played = 0;
    return {
      analyser: null,
      pushed: [] as Int16Array[],
      beginItem: vi.fn(() => {
        played = 0;
      }),
      push(p: Int16Array) {
        this.pushed.push(p);
        played += 100;
      },
      flush: vi.fn(),
      playedMsForItem: () => played,
      waitForDrain: vi.fn(async () => {}),
      close: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("speaks sentence by sentence on one cumulative clock and feeds the bus", async () => {
    const player = fakePlayer();
    const calls: { sentenceIndex: number; sentenceOffsetMs: number }[] = [];
    const speakSentenceFake = vi.fn(async (_id: string, body: { sentenceIndex: number; sentenceOffsetMs: number }, onEvent: (e: never) => void) => {
      calls.push({ sentenceIndex: body.sentenceIndex, sentenceOffsetMs: body.sentenceOffsetMs });
      const text = sse([
        ["meta", { streamId: `vs_${body.sentenceIndex}`, utteranceId: "u", sentenceIndex: body.sentenceIndex, offsetMs: 0, sampleRate: 24000 }],
        ["visemes", { seq: 0, offsetMs: body.sentenceOffsetMs, cues: [{ viseme: "aa", startMs: body.sentenceOffsetMs, endMs: body.sentenceOffsetMs + 50 }] }],
        ["audio", { seq: 0, offsetMs: 0, samples: 2, durationMs: 1, pcm: "AQD+/w==" }],
        ["done", { reason: "completed", durationMs: 1000, totalMs: body.sentenceOffsetMs + 1000 }],
      ]);
      for (const e of parseNamedSse(text).events) onEvent({ type: e.event, ...(e.data as object) } as never);
      return { ok: true as const };
    });
    const events: VoiceBusEvent[] = [];
    const off = voicePlayback.subscribe((e) => events.push(e));
    const speaker = new LocalSpeaker({
      createContext: () => ({ state: "running" }) as unknown as AudioContext,
      createPlayer: async () => player,
      speakSentence: speakSentenceFake as never,
    });
    const out = await speaker.speak("c1", "Hey you. I missed you.");
    off();
    expect(out).toEqual({ kind: "completed", totalMs: 2000 });
    expect(calls).toEqual([
      { sentenceIndex: 0, sentenceOffsetMs: 0 },
      { sentenceIndex: 1, sentenceOffsetMs: 1000 },
    ]);
    expect(Array.from(player.pushed[0])).toEqual([1, -2]);
    expect(events.map((e) => e.type)).toEqual(["start", "visemes", "visemes", "end"]);
  });

  it("an offline answer ends text-only and reports it", async () => {
    const speaker = new LocalSpeaker({
      createContext: () => ({ state: "running" }) as unknown as AudioContext,
      createPlayer: async () => fakePlayer(),
      speakSentence: (async () => ({ ok: false, status: 503, code: "voice_offline", reason: "box_unreachable", message: "x" })) as never,
    });
    const out = await speaker.speak("c1", "Hello.");
    expect(out).toMatchObject({ kind: "offline", unavailable: { code: "voice_offline" } });
    expect(speaker.speaking).toBe(false);
  });

  it("stop flushes, emits the bus stop at once, and posts heardMs", async () => {
    const player = fakePlayer();
    let release: () => void = () => {};
    const stopFake = vi.fn(async () => null);
    const speaker = new LocalSpeaker({
      createContext: () => ({ state: "running" }) as unknown as AudioContext,
      createPlayer: async () => player,
      stopSpeaking: stopFake,
      speakSentence: (async (_id: string, _b: unknown, onEvent: (e: never) => void) => {
        onEvent({ type: "meta", streamId: "vs_1" } as never);
        onEvent({ type: "audio", pcm: "AQD+/w==" } as never);
        await new Promise<void>((r) => {
          release = r;
        });
        return { ok: true };
      }) as never,
    });
    const events: VoiceBusEvent[] = [];
    const off = voicePlayback.subscribe((e) => events.push(e));
    const pending = speaker.speak("c1", "One. Two.");
    await new Promise((r) => setTimeout(r, 0));
    const heard = speaker.stop("barge_in");
    expect(heard).toBe(100);
    expect(player.flush).toHaveBeenCalled();
    expect(events.find((e) => e.type === "stop")).toMatchObject({ heardMs: 100, reason: "barge_in" });
    expect(stopFake).toHaveBeenCalledWith("c1", "vs_1", expect.objectContaining({ heardMs: 100, reason: "barge_in" }));
    release();
    expect(await pending).toMatchObject({ kind: "stopped" });
    off();
  });

  it("decodes little-endian PCM and joins capped chunks", () => {
    expect(Array.from(pcmFromBase64("AQD+/w=="))).toEqual([1, -2]);
    expect(Array.from(joinPcm([new Int16Array([1, 2]), new Int16Array([3, 4])], 3))).toEqual([1, 2, 3]);
  });
});
