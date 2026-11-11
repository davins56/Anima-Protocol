/**
 * V5: voice notes are local-first. No cloud voice call unless the request
 * carries an explicit cloud_opt_in for that provider, and no automatic
 * xAI -> ElevenLabs cascade. fetch is stubbed; nothing leaves the process.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({ userId: req.headers["x-test-user"] ?? null }),
}));
vi.mock("../src/lib/kernelFeatures", () => ({ isKernelFeatureEnabled: () => true }));
vi.mock("../src/lib/imageUploads", () => ({
  UPLOADS_PATH_PREFIX: "/objects/uploads/",
  storeUploadedAudio: vi.fn(async (_u: string, bytes: Uint8Array, contentType: string) => ({
    id: "clip1",
    contentType,
    byteSize: bytes.byteLength,
  })),
}));
vi.mock("../src/lib/voice/voiceStore", () => ({
  DEFAULT_VOICE_ID: "eve",
  currentVoice: async () => null,
  loadCharacterRecord: async () => ({ id: "c1", kokoro_voice_id: "af_bella" }),
}));

import mediaRouter from "../src/routes/media";
import { resetLocalVoiceProbeForTests } from "../src/lib/voice/localVoiceClient";

const BOX = "http://home-box.test";
const realFetch = globalThis.fetch;
const calls: Array<{ url: string; body: string }> = [];
let boxUp = true;
const ENV_KEYS = ["ANIMA_LOCAL_VOICE_BASE_URL", "ANIMA_LOCAL_VOICE", "XAI_API_KEY", "ELEVENLABS_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/media", mediaRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ANIMA_LOCAL_VOICE_BASE_URL = BOX;
  delete process.env.ANIMA_LOCAL_VOICE;
  process.env.XAI_API_KEY = "xai-test";
  process.env.ELEVENLABS_API_KEY = "el-test";
  boxUp = true;
  calls.length = 0;
  resetLocalVoiceProbeForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(baseUrl)) return realFetch(input, init);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    const mp3 = () => new Response(new Uint8Array([0xff, 0xfb, 1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    if (url.startsWith(BOX)) {
      if (!boxUp) throw new TypeError("fetch failed");
      return mp3();
    }
    return mp3();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const cloudCalls = () => calls.filter((c) => /api\.x\.ai|elevenlabs\.io/.test(c.url));

function clip(body: Record<string, unknown>) {
  return realFetch(`${baseUrl}/media/voice-clip`, {
    method: "POST",
    headers: { "x-test-user": "user_a", "Content-Type": "application/json" },
    body: JSON.stringify({ characterId: "c1", text: "Goodnight, love.", ...body }),
  });
}

describe("voice-clip cascade (V5)", () => {
  it("speaks on the home box by default, in her kokoro voice, with no cloud call", async () => {
    const res = await clip({});
    expect(res.status).toBe(200);
    expect((await res.json()).provider).toBe("local");
    expect(calls.map((c) => c.url)).toEqual([`${BOX}/tts/v1/audio/speech`]);
    expect(JSON.parse(calls[0].body)).toMatchObject({ voice: "af_bella", response_format: "mp3" });
    expect(cloudCalls()).toEqual([]);
  });

  it("box down and no opt-in: 503 voice_offline, cloudFallback false, no cloud call even with both keys", async () => {
    boxUp = false;
    const res = await clip({});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_offline", reason: "box_unreachable", cloudFallback: false });
    expect(cloudCalls()).toEqual([]);
  });

  it("box not configured and no opt-in: 503 voice_disabled, no cloud call", async () => {
    delete process.env.ANIMA_LOCAL_VOICE_BASE_URL;
    const res = await clip({});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_disabled", reason: "disabled_by_user", cloudFallback: false });
    expect(calls).toEqual([]);
  });

  it("ignores anything that is not an exact provider opt-in", async () => {
    boxUp = false;
    for (const v of [true, "yes", "XAI", ["xai"], { xai: true }]) {
      const res = await clip({ cloud_opt_in: v });
      expect(res.status).toBe(503);
    }
    expect(cloudCalls()).toEqual([]);
  });

  it("opted into xAI and box down: xAI speaks, ElevenLabs is not touched", async () => {
    boxUp = false;
    const res = await clip({ cloud_opt_in: "xai" });
    expect(res.status).toBe(200);
    expect((await res.json()).provider).toBe("xai");
    expect(cloudCalls().map((c) => new URL(c.url).host)).toEqual(["api.x.ai"]);
  });

  it("opted into ElevenLabs and box down: ElevenLabs speaks", async () => {
    boxUp = false;
    const res = await clip({ cloud_opt_in: "elevenlabs" });
    expect(res.status).toBe(200);
    expect((await res.json()).provider).toBe("elevenlabs");
    expect(cloudCalls().map((c) => new URL(c.url).host)).toEqual(["api.elevenlabs.io"]);
  });

  it("opted into xAI without an xAI key: no cascade to ElevenLabs", async () => {
    boxUp = false;
    delete process.env.XAI_API_KEY;
    const res = await clip({ cloud_opt_in: "xai" });
    expect(res.status).toBe(503);
    expect(cloudCalls()).toEqual([]);
  });

  it("opted in but the box is up: the box still speaks", async () => {
    const res = await clip({ cloud_opt_in: "xai" });
    expect((await res.json()).provider).toBe("local");
    expect(cloudCalls()).toEqual([]);
  });

  it("opted in with no box configured: the opted-in cloud provider speaks", async () => {
    delete process.env.ANIMA_LOCAL_VOICE_BASE_URL;
    const res = await clip({ cloud_opt_in: "elevenlabs" });
    expect((await res.json()).provider).toBe("elevenlabs");
  });

  it("capabilities: voice_clip needs the home box; cloud keys are reported only as opt-in options", async () => {
    delete process.env.ANIMA_LOCAL_VOICE_BASE_URL;
    let body = await (await realFetch(`${baseUrl}/media/capabilities`, { headers: { "x-test-user": "user_a" } })).json();
    expect(body).toEqual({ voice_clip: false, voice_clip_local: false, voice_clip_cloud: { xai: true, elevenlabs: true }, cloud_default: false });
    process.env.ANIMA_LOCAL_VOICE_BASE_URL = BOX;
    body = await (await realFetch(`${baseUrl}/media/capabilities`, { headers: { "x-test-user": "user_a" } })).json();
    expect(body.voice_clip).toBe(true);
    expect(calls).toEqual([]);
  });
});
