/** Server contract §3.2 alignment (chat-upgrade-server-contracts.md). */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra: Record<string, string> = {}) => ({ ...extra, Authorization: "Bearer test" })),
}));

import {
  decideToolAction,
  errorResult,
  fetchToolPreview,
  fetchToolSettings,
  followToolAction,
  stopAllToolActions,
} from "./toolsApi";
import { applyToolFrame, isConfirmableTool, isWaitingForUser, reasonText } from "./toolFrames";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const asFetch = (fn: unknown) => fn as typeof fetch;

const confirmation = {
  id: "c1",
  action_kind: "send",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  request_hash: "h",
  target: "https://hooks.example/x",
  payload_summary: "hello",
};

describe("tools server contract §3", () => {
  it("reads settings per companion with auth", async () => {
    const fetchImpl = vi.fn(async () => json(200, { character_id: "ch1", tools: [{ tool: "web_search", enabled: true }] }));
    const res = await fetchToolSettings("ch 1", { fetchImpl: asFetch(fetchImpl) });
    expect(res.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/tools/settings?character_id=ch%201");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test");
    expect(init.body).toBeUndefined();
  });

  it("only webhook and browser actions can be confirmed", () => {
    expect(isConfirmableTool("webhook")).toBe(true);
    expect(isConfirmableTool("browser")).toBe(true);
    expect(isConfirmableTool("web_search")).toBe(false);
    const hook = applyToolFrame({}, { action_id: "a1", tool: "webhook", seq: 1, event: "confirmation_required", confirmation });
    expect(isWaitingForUser(hook.a1)).toBe(true);
    const search = applyToolFrame({}, { action_id: "a2", tool: "web_search", seq: 1, event: "confirmation_required", confirmation });
    expect(search.a2.confirmation).toBeNull();
    expect(isWaitingForUser(search.a2)).toBe(false);
  });

  it("423 carries killed:true and kill copy", async () => {
    const fetchImpl = vi.fn(async () => json(423, { error: "killed", killed: true }));
    const res = await decideToolAction("a1", { confirmationId: "c1", decision: "confirm", requestHash: "h" }, { fetchImpl: asFetch(fetchImpl) });
    expect(res).toMatchObject({ ok: false, status: 423, code: "killed", killed: true });
    expect(res.message).toMatch(/kill switch/);
    expect(reasonText("killed")).toMatch(/kill switch/);
  });

  it("503 tools_disabled is reported as disabled, not an error toast", async () => {
    const fetchImpl = vi.fn(async () => json(503, { error: "tools_disabled" }));
    const res = await stopAllToolActions({ fetchImpl: asFetch(fetchImpl) });
    expect(res).toMatchObject({ ok: false, status: 503, code: "tools_disabled", disabled: true, message: "Tools are off on this server." });
    expect(errorResult(503, { error: "something_else" })).not.toHaveProperty("disabled");
  });

  it("the replay stream reports disabled and killed", async () => {
    const off = await followToolAction("a1", 0, () => {}, { fetchImpl: asFetch(vi.fn(async () => json(503, { error: "tools_disabled" }))) });
    expect(off).toMatchObject({ ok: false, status: 503, disabled: true });
    const killed = await followToolAction("a1", 0, () => {}, { fetchImpl: asFetch(vi.fn(async () => json(423, { error: "killed", killed: true }))) });
    expect(killed).toMatchObject({ ok: false, status: 423, killed: true });
  });

  it("preview says clearly that it isn't available until phase 3", async () => {
    const fetchImpl = vi.fn(async () => json(501, { error: "preview_not_available" }));
    const res = await fetchToolPreview("a1", { fetchImpl: asFetch(fetchImpl) });
    expect(res).toMatchObject({ ok: false, status: 501, code: "preview_not_available" });
    expect(res.ok ? "" : res.message).toMatch(/isn't available yet/);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/tools/actions/a1/preview");
  });
});
