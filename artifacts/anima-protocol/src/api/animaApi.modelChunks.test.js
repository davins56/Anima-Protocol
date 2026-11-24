import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animaApi } from "./animaApi.js";

const authHeaders = vi.fn();
const fetchMock = vi.fn();

vi.mock("./authBridge", () => ({ authHeaders: (...args) => authHeaders(...args) }));
vi.mock("@/lib/apiOrigin", () => ({ apiUrl: (path) => `https://example.test/api${path}` }));

// Regression: animaApi.js called base64ToBytes / bytesToBase64 without
// importing them, so every own-model chunk download and Model Tutor upload
// threw "ReferenceError: base64ToBytes is not defined".
describe("own model chunk transport", () => {
  beforeEach(() => {
    authHeaders.mockReset().mockResolvedValue({ Authorization: "Bearer t", "Content-Type": "application/json" });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("model.chunk decodes the base64 body into an ArrayBuffer", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "AQID/w==\n" });
    const buf = await animaApi.model.chunk("v1", 0);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(buf)]).toEqual([1, 2, 3, 255]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/model/v/v1/inference/0");
  });

  it("tutor.uploadChunk sends the bytes as base64 text", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await animaApi.tutor.uploadChunk("v1", "inference", 2, new Uint8Array([1, 2, 3, 255]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/tutor/uploads/v1/inference/2");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("AQID/w==");
  });
});
