import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async () => ({ "Content-Type": "application/json", Authorization: "Bearer test" })),
}));

import {
  decideBotDraft,
  isStatusStale,
  linkDomain,
  loadBotPermissions,
  loadBotStatuses,
  loadBridgeConfig,
  permissionModeFor,
  relativeTime,
} from "./botBridge";
import { botStatuses, enabledConfig, FIXTURE_NOW, permissions } from "@/components/botBridge/fixtures";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("botBridge client", () => {
  it("treats any failure or odd shape as disabled", async () => {
    expect((await loadBridgeConfig({ fetchImpl: async () => json({}, 404) })).enabled).toBe(false);
    expect((await loadBridgeConfig({ fetchImpl: async () => json({ enabled: "yes" }) })).enabled).toBe(false);
    expect((await loadBridgeConfig({ fetchImpl: async () => { throw new Error("offline"); } })).enabled).toBe(false);
    expect((await loadBridgeConfig({ fetchImpl: async () => json({ enabled: false }) })).capabilities.remember).toBe(false);
    expect((await loadBridgeConfig({ fetchImpl: async () => json(enabledConfig) })).enabled).toBe(true);
  });

  it("explains 503 bridge_disabled on data routes", async () => {
    const res = await loadBotStatuses({ fetchImpl: async () => json({ code: "bridge_disabled" }, 503) });
    expect(res).toEqual({ ok: false, message: "The bot bridge is not enabled on this server." });
    const perm = await loadBotPermissions({ fetchImpl: async () => json({}, 503) });
    expect(perm.ok).toBe(false);
  });

  it("parses statuses and permissions", async () => {
    const res = await loadBotStatuses({ fetchImpl: async () => json({ bots: botStatuses }) });
    expect(res.ok && res.bots).toHaveLength(2);
    const perm = await loadBotPermissions({ fetchImpl: async () => json(permissions) });
    expect(perm.ok && perm.permissions.companions[0].name).toBe("Serenity");
  });

  it("posts a draft decision to the action's URL", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    expect(await decideBotDraft("act/1", "send", { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/bridge/drafts/act%2F1/decision");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "send" });
  });

  it("defaults every pair to ask", () => {
    expect(permissionModeFor([], "c1", "b1")).toBe("ask");
    expect(permissionModeFor([{ companion_id: "c1", bot_id: "b1", mode: "allow" }], "c1", "b1")).toBe("allow");
    expect(permissionModeFor([{ companion_id: "c1", bot_id: "b1", mode: "allow" }], "c2", "b1")).toBe("ask");
  });

  it("marks status older than 6 hours stale and formats times", () => {
    expect(isStatusStale("2026-11-14T22:10:00Z", FIXTURE_NOW)).toBe(false);
    expect(isStatusStale("2026-11-14T16:29:00Z", FIXTURE_NOW)).toBe(true);
    expect(isStatusStale("not a date", FIXTURE_NOW)).toBe(true);
    expect(relativeTime("2026-11-14T22:10:00Z", FIXTURE_NOW)).toBe("20 min ago");
    expect(relativeTime("2026-11-14T09:00:00Z", FIXTURE_NOW)).toBe("14 h ago");
  });

  it("shows only https link domains", () => {
    expect(linkDomain("https://www.github.com/x")).toBe("github.com");
    expect(linkDomain("javascript:alert(1)")).toBeNull();
    expect(linkDomain("http://example.com")).toBeNull();
  });
});
