import { describe, expect, it, beforeEach, vi } from "vitest";
import { shouldAttemptDeviceScan, maybeHandleDeviceScan } from "./animaDeviceScan";
import { writeDeviceScanPermission } from "./deviceScan";

describe("shouldAttemptDeviceScan", () => {
  const anima = { id: "a1", name: "Lumen", _isAnima: true };
  const korra = { id: "c2", name: "Korra", _isAnima: false };

  it("attempts when an Anima is asked to scan the device", () => {
    const decision = shouldAttemptDeviceScan({
      content: "scan my device for unnecessary data",
      activeSession: { mode: "solo", character_id: "a1" },
      characters: [anima],
    });
    expect(decision.attempt).toBe(true);
    expect(decision.talkingToAnima).toBe(true);
  });

  it("does not attempt for a roster character", () => {
    const decision = shouldAttemptDeviceScan({
      content: "scan my device for junk",
      activeSession: { mode: "solo", character_id: "c2" },
      characters: [korra],
    });
    expect(decision.attempt).toBe(false);
  });

  it("does not attempt ordinary chat with an Anima", () => {
    const decision = shouldAttemptDeviceScan({
      content: "I missed you tonight.",
      activeSession: { mode: "solo", character_id: "a1" },
      characters: [anima],
    });
    expect(decision.attempt).toBe(false);
  });
});

describe("maybeHandleDeviceScan", () => {
  beforeEach(() => {
    localStorage.clear();
    writeDeviceScanPermission(false);
  });

  it("asks for permission instead of scanning", async () => {
    const appendMessage = vi.fn(async (_id, msg) => msg);
    const setActiveSession = vi.fn();
    const result = await maybeHandleDeviceScan({
      content: "scan my device for leftover data",
      activeSession: { id: "s1", mode: "solo", character_id: "a1" },
      characters: [{ id: "a1", name: "Lumen", _isAnima: true }],
      userMessage: { role: "user", content: "scan my device for leftover data" },
      appendMessage,
      setActiveSession,
      isContinue: false,
    });
    expect(result.handled).toBe(true);
    expect(result.needsPermission).toBe(true);
    expect(result.message.device_scan.needs_permission).toBe(true);
    expect(result.message.content).toMatch(/grant permission/i);
  });

  it("scans after a stored Anima grant even if local permission was empty", async () => {
    const appendMessage = vi.fn(async (_id, msg) => msg);
    const result = await maybeHandleDeviceScan({
      content: "scan my device for leftover data",
      activeSession: { id: "s1", mode: "solo", character_id: "a1" },
      characters: [
        { id: "a1", name: "Lumen", _isAnima: true, device_scan_granted: true },
      ],
      userMessage: { role: "user", content: "scan my device for leftover data" },
      appendMessage,
      isContinue: false,
    });
    expect(result.handled).toBe(true);
    expect(result.needsPermission).toBeUndefined();
    expect(result.report?.permission).toBe(true);
  });
});
