/**
 * anima-voice/1 routes against a mocked home box (Kokoro-FastAPI + speaches
 * on a local HTTP server). Owner 404s, fail-closed 503s with no cloud call,
 * barge-in, cumulative timeline + ordering, and the push-to-talk caps.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({ userId: req.headers["x-test-user"] ?? null }),
}));

import voiceLocalRouter, { resetVoiceLocalStateForTests, wavHeader } from "../src/routes/voiceLocal";
import { resetLocalVoiceProbeForTests } from "../src/lib/voice/localVoiceClient";
import { setVoiceSlotForTests } from "../src/lib/voice/voiceSlot";
import { STT_MAX_PCM_BYTES, STT_MAX_BODY_BYTES } from "../src/lib/voice/localContract";
import { db, userEntities } from "@workspace/db";
import { like } from "drizzle-orm";

const PREFIX = `vlocal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_`;
const ALICE = `${PREFIX}alice`;
const BOB = `${PREFIX}bob`;
const CHAR = `${PREFIX}serenity`;

// ---- mock home box -------------------------------------------------------
type BoxMode = { health: "ok" | "loading" | "down"; stt: "ok" | "down"; kokoro: "ok" | "fail" | "hold" };
const box = {
  mode: { health: "ok", stt: "ok", kokoro: "ok" } as BoxMode,
  calls: [] as string[],
  kokoroAborted: false,
  release: null as null | (() => void),
  sttBytes: 0,
  ttsBodies: [] as any[],
};

/** 24 kHz PCM16 silence of `ms`. */
function pcm(ms: number): string {
  return Buffer.alloc(Math.round((ms / 1000) * 24000) * 2).toString("base64");
}

function boxHandler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || "";
  box.calls.push(`${req.method} ${url}`);
  let body = "";
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    body = Buffer.concat(chunks).toString("utf8");
    const json = (status: number, obj: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (url === "/tts/health") {
      if (box.mode.health === "loading") return json(503, { status: "loading" });
      return json(200, { status: "healthy" });
    }
    if (url === "/stt/health") return box.mode.stt === "ok" ? json(200, { status: "ok" }) : json(502, {});
    if (url === "/tts/v1/audio/voices") return json(200, { voices: ["af_heart", "am_michael", "bad+blend"] });
    if (url === "/tts/dev/phonemize") return json(200, { phonemes: "hˈA jˈu" });
    if (url === "/tts/dev/captioned_speech") {
      box.ttsBodies.push(JSON.parse(body || "{}"));
      if (box.mode.kokoro === "fail") return json(500, { error: "boom" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.on("close", () => {
        if (!res.writableFinished) box.kokoroAborted = true;
      });
      // Chunk 1: "Hey you" over 0..600 ms of audio.
      res.write(
        JSON.stringify({ audio: pcm(600), audio_format: "pcm", timestamps: [
          { word: "Hey", start_time: 0.05, end_time: 0.25 },
          { word: "you", start_time: 0.4, end_time: 0.55 },
        ] }) + "\n",
      );
      if (box.mode.kokoro === "hold") {
        box.release = () => {
          if (!res.writableEnded) res.end();
        };
        return;
      }
      // Chunk 2: "there" over 600..1000 ms (sentence-relative timings).
      res.end(
        JSON.stringify({ audio: pcm(400), audio_format: "pcm", timestamps: [{ word: "there.", start_time: 0.62, end_time: 0.9 }] }) + "\n",
      );
      return;
    }
    if (url === "/stt/v1/audio/transcriptions") {
      box.sttBytes = chunks.reduce((n, c) => n + c.length, 0);
      return json(200, { text: " I had a rough day", language: "en", duration: 1.48, words: [{ word: " I", start: 0.12, end: 0.22 }] });
    }
    json(404, { error: "nope" });
  });
}

let boxServer: Server;
let boxUrl = "";
let server: Server;
let baseUrl = "";
const CLOUD = /elevenlabs\.io|api\.x\.ai|openrouter|openai\.com/;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  boxServer = http.createServer(boxHandler);
  await new Promise<void>((r) => boxServer.listen(0, "127.0.0.1", () => r()));
  boxUrl = `http://127.0.0.1:${(boxServer.address() as AddressInfo).port}`;
  const app: Express = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/voice", voiceLocalRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.insert(userEntities).values([
    { userId: ALICE, entityName: "Character", entityId: CHAR, data: { name: "Serenity", kokoro_voice_id: "af_bella" } },
  ]);
});

afterAll(async () => {
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => boxServer.close(() => r()));
});

beforeEach(() => {
  process.env.ANIMA_LOCAL_VOICE_BASE_URL = boxUrl;
  process.env.ANIMA_LOCAL_VOICE_API_KEY = "box-token";
  delete process.env.ANIMA_LOCAL_VOICE;
  process.env.ANIMA_VOICE_SLOT_WAIT_MS = "300";
  box.mode = { health: "ok", stt: "ok", kokoro: "ok" };
  box.calls = [];
  box.kokoroAborted = false;
  box.release = null;
  box.ttsBodies = [];
  resetLocalVoiceProbeForTests();
  resetVoiceLocalStateForTests();
  setVoiceSlotForTests(undefined);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  box.release?.();
  const cloudCalls = fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => CLOUD.test(u));
  expect(cloudCalls).toEqual([]); // never a cloud voice, in any test
  fetchSpy.mockRestore();
  delete process.env.ANIMA_LOCAL_VOICE_BASE_URL;
  delete process.env.ANIMA_LOCAL_VOICE_API_KEY;
  delete process.env.ANIMA_VOICE_SLOT_WAIT_MS;
});

// ---- helpers --------------------------------------------------------------
type Ev = { event: string; data: any };
function parseSse(text: string): Ev[] {
  return text
    .split("\n\n")
    .map((block) => {
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return ev && data ? { event: ev, data: JSON.parse(data) } : null;
    })
    .filter(Boolean) as Ev[];
}

function speak(user: string | null, body: Record<string, unknown>, characterId = CHAR, signal?: AbortSignal) {
  return fetch(`${baseUrl}/voice/${characterId}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
    signal,
  });
}

/** Read SSE events until `until` matches. */
async function readUntil(res: Response, until: (e: Ev) => boolean): Promise<{ events: Ev[]; reader: ReadableStreamDefaultReader<Uint8Array>; rest: () => Promise<Ev[]> }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: Ev[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    let hit = false;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = parseSse(buf.slice(0, i + 2));
      buf = buf.slice(i + 2);
      events.push(...ev);
      if (ev.some(until)) hit = true;
    }
    if (hit) break;
  }
  const rest = async () => {
    let tail = buf;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      tail += dec.decode(value, { stream: true });
    }
    return parseSse(tail);
  };
  return { events, reader, rest };
}

const say = (extra: Record<string, unknown> = {}) => ({ utteranceId: "u_1", text: "Hey you there.", ...extra });

// ---- status ---------------------------------------------------------------
describe("GET /voice/local/status", () => {
  it("needs sign-in", async () => {
    expect((await fetch(`${baseUrl}/voice/local/status`)).status).toBe(401);
  });
  it("online with no reason when the box is healthy", async () => {
    const s = await (await fetch(`${baseUrl}/voice/local/status`, { headers: { "x-test-user": ALICE } })).json();
    expect(s).toMatchObject({ contract: "anima-voice/1", state: "online", cloudFallback: false, tts: { ok: true, sampleRate: 24000 }, stt: { ok: true, sampleRate: 16000, maxSeconds: 60 } });
    expect(s.reason).toBeUndefined();
  });
  it("reason box_unreachable when the box is down", async () => {
    process.env.ANIMA_LOCAL_VOICE_BASE_URL = "http://127.0.0.1:1";
    const s = await (await fetch(`${baseUrl}/voice/local/status`, { headers: { "x-test-user": ALICE } })).json();
    expect(s).toMatchObject({ state: "offline", reason: "box_unreachable", cloudFallback: false });
  });
  it("reason model_loading while Kokoro is still loading", async () => {
    box.mode.health = "loading";
    const s = await (await fetch(`${baseUrl}/voice/local/status`, { headers: { "x-test-user": ALICE } })).json();
    expect(s).toMatchObject({ state: "offline", reason: "model_loading" });
  });
  it("reason disabled_by_user when the owner switched local voice off", async () => {
    process.env.ANIMA_LOCAL_VOICE = "off";
    const s = await (await fetch(`${baseUrl}/voice/local/status`, { headers: { "x-test-user": ALICE } })).json();
    expect(s).toMatchObject({ state: "disabled", reason: "disabled_by_user" });
    expect(box.calls).toEqual([]);
  });
  it("reason busy while a stream holds the voice slot", async () => {
    box.mode.kokoro = "hold";
    const res = await speak(ALICE, say());
    await readUntil(res, (e) => e.event === "audio");
    const s = await (await fetch(`${baseUrl}/voice/local/status`, { headers: { "x-test-user": ALICE } })).json();
    expect(s).toMatchObject({ state: "busy", reason: "busy" });
    box.release?.();
  });
});

// ---- owner-only ------------------------------------------------------------
describe("owner-only 404s", () => {
  it("speak: another user's companion and a missing one look the same, and the box is never called", async () => {
    const a = await speak(BOB, say());
    const b = await speak(ALICE, say(), `${PREFIX}missing`);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
    expect(box.calls.filter((c) => c.includes("captioned"))).toEqual([]);
  });
  it("stop is owner-only too", async () => {
    const s = await fetch(`${baseUrl}/voice/${CHAR}/speak/vs_x_y/stop`, {
      method: "POST",
      headers: { "x-test-user": BOB, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(s.status).toBe(404);
  });
  it("a stream id minted for another user is a 404 even on your own companion", async () => {
    box.mode.kokoro = "hold";
    const res = await speak(ALICE, say());
    const { events } = await readUntil(res, (e) => e.event === "meta");
    const streamId = events[0].data.streamId;
    await db.insert(userEntities).values({ userId: BOB, entityName: "Character", entityId: `${PREFIX}bobchar`, data: { name: "B" } });
    const s = await fetch(`${baseUrl}/voice/${PREFIX}bobchar/speak/${streamId}/stop`, {
      method: "POST",
      headers: { "x-test-user": BOB, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(s.status).toBe(404);
    box.release?.();
  });
});

// ---- fail-closed -----------------------------------------------------------
describe("fail-closed 503 (no cloud fallback)", () => {
  it("box unreachable → 503 voice_offline / box_unreachable", async () => {
    process.env.ANIMA_LOCAL_VOICE_BASE_URL = "http://127.0.0.1:1";
    const res = await speak(ALICE, say());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_offline", reason: "box_unreachable", cloudFallback: false, retryable: true });
  });
  it("model loading → 503 voice_offline / model_loading", async () => {
    box.mode.health = "loading";
    const res = await speak(ALICE, say());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_offline", reason: "model_loading", cloudFallback: false });
  });
  it("switched off → 503 voice_disabled / disabled_by_user", async () => {
    delete process.env.ANIMA_LOCAL_VOICE_BASE_URL;
    const res = await speak(ALICE, say());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_disabled", reason: "disabled_by_user", cloudFallback: false });
  });
  it("slot taken → SSE error voice_busy / busy after meta", async () => {
    box.mode.kokoro = "hold";
    const first = await speak(ALICE, say());
    await readUntil(first, (e) => e.event === "audio");
    const second = await speak(ALICE, say({ utteranceId: "u_2" }));
    const evs = parseSse(await second.text());
    expect(evs[0].event).toBe("meta");
    expect(evs.find((e) => e.event === "error")?.data).toMatchObject({ code: "voice_busy", reason: "busy", cloudFallback: false });
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { reason: "error" } });
    box.release?.();
  });
  it("Kokoro failing mid-request → SSE error, never a cloud voice", async () => {
    box.mode.kokoro = "fail";
    const evs = parseSse(await (await speak(ALICE, say())).text());
    expect(evs.find((e) => e.event === "error")?.data).toMatchObject({ code: "voice_offline", cloudFallback: false });
  });
});

// ---- speak timeline --------------------------------------------------------
describe("POST /speak timeline", () => {
  it("meta first, her saved Kokoro voice, then visemes/words before the audio they cover", async () => {
    const evs = parseSse(await (await speak(ALICE, say())).text());
    expect(evs[0].event).toBe("meta");
    expect(evs[0].data).toMatchObject({ utteranceId: "u_1", sentenceIndex: 0, sentenceOffsetMs: 0, sampleRate: 24000, format: "pcm16", voice: { id: "af_bella" } });
    expect(typeof evs[0].data.streamId).toBe("string");
    expect(box.ttsBodies[0]).toMatchObject({ voice: "af_bella", response_format: "pcm", stream: true });
    expect(evs.findIndex((e) => e.event === "visemes")).toBeLessThan(evs.findIndex((e) => e.event === "audio"));
    expect(evs.findIndex((e) => e.event === "word")).toBeLessThan(evs.findIndex((e) => e.event === "audio"));
    // Every audio window is already covered by cues sent before it.
    let coveredTo = 0;
    for (const e of evs) {
      if (e.event === "visemes") coveredTo = Math.max(coveredTo, ...e.data.cues.map((c: any) => c.endMs));
      if (e.event === "audio") expect(coveredTo).toBeGreaterThanOrEqual(e.data.offsetMs + e.data.durationMs - 1);
    }
    const done = evs.at(-1)!;
    expect(done).toMatchObject({ event: "done", data: { reason: "completed", durationMs: 1000, totalMs: 1000 } });
  });

  it("offsets are cumulative across sentences, monotonic, with matching sampleOffsets", async () => {
    const s0 = parseSse(await (await speak(ALICE, say({ sentenceIndex: 0 }))).text());
    const total0 = s0.at(-1)!.data.totalMs;
    const s1 = parseSse(await (await speak(ALICE, say({ sentenceIndex: 1, sentenceOffsetMs: total0 }))).text());
    expect(s1[0].data).toMatchObject({ sentenceIndex: 1, sentenceOffsetMs: total0, offsetMs: total0, sampleOffset: total0 * 24 });
    expect(s1.at(-1)!.data.totalMs).toBe(total0 + 1000);
    const cues = [...s0, ...s1].filter((e) => e.event === "visemes").flatMap((e) => e.data.cues);
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i].endMs).toBeGreaterThan(cues[i].startMs);
      if (i) expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
    }
    for (const e of s1.filter((x) => x.event !== "done" && x.event !== "meta")) {
      expect(e.data.offsetMs).toBeGreaterThanOrEqual(total0);
      expect(Math.abs(e.data.sampleOffset - e.data.offsetMs * 24)).toBeLessThanOrEqual(24);
    }
    const audio = [...s0, ...s1].filter((e) => e.event === "audio").map((e) => e.data.offsetMs);
    expect(audio).toEqual([...audio].sort((a, b) => a - b));
    // Sentence end closes the mouth.
    const last = s1.filter((e) => e.event === "visemes").at(-1)!.data.cues.at(-1);
    expect(last).toMatchObject({ viseme: "sil", endMs: total0 + 1000 });
    // No amplitude anywhere in the contract.
    expect(JSON.stringify([...s0, ...s1])).not.toMatch(/amplitude/);
  });

  it("validates the request", async () => {
    expect((await speak(ALICE, { text: "hi" })).status).toBe(400);
    expect((await speak(ALICE, say({ sentenceOffsetMs: -5 }))).status).toBe(400);
    expect((await speak(null, say())).status).toBe(401);
  });
});

// ---- barge-in --------------------------------------------------------------
describe("stop / barge-in", () => {
  it("emits stopped {heardMs} at once, cancels Kokoro upstream, and returns heardText", async () => {
    box.mode.kokoro = "hold";
    const res = await speak(ALICE, say());
    const { events, rest } = await readUntil(res, (e) => e.event === "audio");
    const streamId = events[0].data.streamId;
    const stop = await fetch(`${baseUrl}/voice/${CHAR}/speak/${streamId}/stop`, {
      method: "POST",
      headers: { "x-test-user": ALICE, "Content-Type": "application/json" },
      body: JSON.stringify({ utteranceId: "u_1", heardMs: 300, reason: "barge_in" }),
    });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ event: "final", streamId, reason: "stopped", stopReason: "barge_in", heardMs: 300, heardText: "Hey", heardTextSource: "server" });
    const tail = await rest();
    expect(tail[0]).toMatchObject({ event: "stopped", data: { heardMs: 300, sampleOffset: 7200 } });
    expect(tail.at(-1)).toMatchObject({ event: "done", data: { reason: "stopped" } });
    await vi.waitFor(() => expect(box.kokoroAborted).toBe(true), { timeout: 3000 });
  });

  it("a stop handled by another isolate still ends the stream (voice slot release)", async () => {
    box.mode.kokoro = "hold";
    const res = await speak(ALICE, say());
    const { events, rest } = await readUntil(res, (e) => e.event === "audio");
    const streamId = events[0].data.streamId;
    // Simulate another isolate: drop only the slot hold, not this isolate's handle.
    const { releaseVoiceSlot } = await import("../src/lib/voice/voiceSlot");
    await releaseVoiceSlot(streamId);
    const tail = await rest();
    expect(tail.map((e) => e.event)).toContain("stopped");
    expect(tail.at(-1)).toMatchObject({ event: "done", data: { reason: "stopped" } });
    await vi.waitFor(() => expect(box.kokoroAborted).toBe(true), { timeout: 3000 });
  });

  it("a client disconnect cancels Kokoro upstream", async () => {
    box.mode.kokoro = "hold";
    const ctrl = new AbortController();
    const res = await speak(ALICE, say(), CHAR, ctrl.signal);
    await readUntil(res, (e) => e.event === "audio");
    ctrl.abort();
    await vi.waitFor(() => expect(box.kokoroAborted).toBe(true), { timeout: 3000 });
  });
});

describe("GET /voice/local/voices", () => {
  it("lists Kokoro built-ins only (no blends)", async () => {
    const res = await fetch(`${baseUrl}/voice/local/voices`, { headers: { "x-test-user": ALICE } });
    expect(await res.json()).toEqual({ voices: ["af_heart", "am_michael"] });
  });
});
