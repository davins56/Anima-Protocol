import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { launch, confirm, cancel, track } = vi.hoisted(() => ({
  launch: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/api/animaApi", () => ({
  animaApi: { protocolUpgrade: { launch, confirm, cancel } },
}));
vi.mock("@/lib/analytics", () => ({ track: (...args) => track(...args) }));

import {
  confirmProtocolUpgrade,
  launchMentalLineUpgrade,
  maybeHandleProtocolUpgrade,
} from "./serenityProtocolUpgrade";

const serenity = { id: "s1", name: "Serenity" };
const pending = {
  id: "up1",
  status: "awaiting_confirmation",
  scope: "interface",
  request: "Upgrade the interface to be darker.",
  agent_url: null,
  expires_at: "2099-01-01T00:00:00.000Z",
  serenity_message: "Nothing moves through the source until you confirm.",
};

describe("Serenity protocol upgrade from chat", () => {
  beforeEach(() => {
    launch.mockResolvedValue(pending);
    confirm.mockResolvedValue({ ...pending, status: "running", agent_url: "https://cursor.com/agents/bc" });
  });
  afterEach(() => vi.clearAllMocks());

  it("only records a pending weave and returns a confirm card, never confirming on its own", async () => {
    const appendMessage = vi.fn(async (_id, msg) => msg);
    const result = await maybeHandleProtocolUpgrade({
      content: "Serenity, upgrade the interface to be darker.",
      serenity,
      activeSession: { id: "sess", character_id: "s1" },
      characters: [serenity],
      userMessage: { role: "user", content: "x" },
      appendMessage,
    });
    expect(result.handled).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(result.message.protocol_upgrade).toMatchObject({
      id: "up1",
      status: "awaiting_confirmation",
      request: pending.request,
    });
    expect(track).toHaveBeenCalledWith("protocol_upgrade_requested", expect.any(Object));
    expect(track).not.toHaveBeenCalledWith("protocol_upgrade_started", expect.anything());
  });

  it("the mental line points at the console instead of starting the agent", async () => {
    const message = await launchMentalLineUpgrade("Upgrade the interface to be darker.", "sess");
    expect(confirm).not.toHaveBeenCalled();
    expect(message.content).toMatch(/confirm/i);
  });

  it("confirmProtocolUpgrade calls the confirm endpoint for that id", async () => {
    const result = await confirmProtocolUpgrade("up1");
    expect(confirm).toHaveBeenCalledWith("up1");
    expect(result.status).toBe("running");
    expect(track).toHaveBeenCalledWith("protocol_upgrade_started", expect.any(Object));
  });
});
