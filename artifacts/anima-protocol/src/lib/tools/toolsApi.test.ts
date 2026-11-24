import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra: Record<string, string> = {}) => ({ ...extra, Authorization: "Bearer test" })),
}));

import { decideToolAction, stopToolAction, followToolAction, parseSseBlocks } from "./toolsApi";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("decideToolAction", () => {
  it("posts the decision with the confirmation id and request hash", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { action_id: "a1", status: "confirmed" }));
    const res = await decideToolAction(
      "a1",
      { confirmationId: "c1", decision: "confirm", requestHash: "h" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(res).toMatchObject({ ok: true, status: "confirmed" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/tools/actions/a1/confirm");
    expect(JSON.parse(String(init.body))).toEqual({ confirmation_id: "c1", decision: "confirm", request_hash: "h" });
  });

  it.each([
    [409, "already_decided"],
    [410, "expired"],
    [412, "changed"],
    [423, "killed"],
    [429, "rate_limited"],
    [404, "not_found"],
  ])("maps %i to %s", async (status, code) => {
    const fetchImpl = vi.fn(async () => jsonResponse(status, { retry_after: 5, action: { action_id: "a1" } }));
    const res = await decideToolAction(
      "a1",
      { confirmationId: "c1", decision: "deny", requestHash: "h" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(res).toMatchObject({ ok: false, status, code });
  });

  it("reports a network failure without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await stopToolAction("a1", { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({
      ok: false,
      code: "network",
    });
  });
});

describe("followToolAction", () => {
  it("replays frames after a seq from the SSE endpoint", async () => {
    const body = [
      `data: ${JSON.stringify({ tool: { action_id: "a1", event: "started", seq: 2 } })}`,
      "",
      `data: ${JSON.stringify({ tool: { action_id: "a1", event: "succeeded", seq: 3 } })}`,
      "",
      "",
    ].join("\n");
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const frames: unknown[] = [];
    const res = await followToolAction("a1", 1, (f) => frames.push(f), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(String((fetchImpl.mock.calls[0] as unknown as [string])[0])).toContain("events?after_seq=1");
    expect(frames).toEqual([
      { action_id: "a1", event: "started", seq: 2 },
      { action_id: "a1", event: "succeeded", seq: 3 },
    ]);
  });

  it("parses CRLF blocks and keeps a partial tail", () => {
    const { rest, payloads } = parseSseBlocks('data: {"a":1}\r\n\r\ndata: {"b"');
    expect(payloads).toEqual([{ a: 1 }]);
    expect(rest).toBe('data: {"b"');
  });
});
