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
});

describe("GET /voice/local/voices", () => {
  it("lists Kokoro built-ins only (no blends)", async () => {
    const res = await fetch(`${baseUrl}/voice/local/voices`, { headers: { "x-test-user": ALICE } });
    expect(await res.json()).toEqual({ voices: ["af_heart", "am_michael"] });
  });
});
