import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({
  authHeaders: vi.fn(async () => ({
    "Content-Type": "application/json",
    Authorization: "Bearer clerk-session",
  })),
}));

import { authHeaders } from "@/api/authBridge";
import {
  SESSION_LLM_WARM_KEY,
  resetSessionLlmWarmForTests,
  scheduleSessionLlmWarm,
} from "./warmLocalLlm";

describe("scheduleSessionLlmWarm", () => {
  afterEach(() => {
    resetSessionLlmWarmForTests();
    sessionStorage.clear();
    authHeaders.mockReset();
    authHeaders.mockImplementation(async () => ({
      "Content-Type": "application/json",
      Authorization: "Bearer clerk-session",
    }));
  });

  it("posts once to the app API and does not send model host config", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(scheduleSessionLlmWarm({ fetchImpl })).toBe(true);
    expect(scheduleSessionLlmWarm({ fetchImpl })).toBe(false);

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/llm\/warm$/);
    expect(url).not.toMatch(/llm\.anima-protocol\.com|11434|ollama/i);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers.Authorization).toBe("Bearer clerk-session");
    expect(JSON.stringify(init)).not.toMatch(/keep_alive|ANIMA_LOCAL_LLM|proxy-token/);
    expect(sessionStorage.getItem(SESSION_LLM_WARM_KEY)).toBe("1");
    expect(authHeaders).toHaveBeenCalledTimes(1);
  });

  it("does not fire again after the session flag is set", async () => {
    sessionStorage.setItem(SESSION_LLM_WARM_KEY, "1");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(scheduleSessionLlmWarm({ fetchImpl })).toBe(false);
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows a failed preload", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(() => scheduleSessionLlmWarm({ fetchImpl })).not.toThrow();
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    expect(sessionStorage.getItem(SESSION_LLM_WARM_KEY)).toBe("1");
    expect(scheduleSessionLlmWarm({ fetchImpl })).toBe(false);
  });

  it("does not mark the session when the caller is signed out", async () => {
    authHeaders.mockResolvedValue({ "Content-Type": "application/json" });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(scheduleSessionLlmWarm({ fetchImpl })).toBe(true);
    await vi.waitFor(() => {
      expect(authHeaders).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SESSION_LLM_WARM_KEY)).toBeNull();
    expect(scheduleSessionLlmWarm({ fetchImpl })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
