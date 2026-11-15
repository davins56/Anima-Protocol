import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  loadBridgeConfig: vi.fn(),
  loadBotStatuses: vi.fn(),
  loadBotPermissions: vi.fn(),
}));
vi.mock("@/lib/botBridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/botBridge")>("@/lib/botBridge");
  return { ...actual, ...m };
});
vi.mock("@/lib/pushNotifications", () => ({
  supportsPushNotifications: () => false,
  enableProactivePush: vi.fn(),
}));

import BotAwarenessPanel from "./BotAwarenessPanel";
import BotBridgeSettings from "./BotBridgeSettings";
import BotDraftConfirmCard from "./BotDraftConfirmCard";
import BotMessageBubble from "./BotMessageBubble";
import BotPermissionSettings from "./BotPermissionSettings";
import { botStatuses, draft, enabledConfig, FIXTURE_NOW, inboundMessage, permissions } from "./fixtures";
import { DISABLED_BRIDGE_CONFIG } from "@/lib/botBridge";

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe("BotBridgeSettings", () => {
  it("renders nothing while the server reports the bridge disabled", async () => {
    m.loadBridgeConfig.mockResolvedValue(DISABLED_BRIDGE_CONFIG);
    const { container } = render(<BotBridgeSettings nowMs={FIXTURE_NOW} />);
    await waitFor(() => expect(m.loadBridgeConfig).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    expect(m.loadBotStatuses).not.toHaveBeenCalled();
  });

  it("shows bots, permissions and alerts when enabled", async () => {
    m.loadBridgeConfig.mockResolvedValue(enabledConfig);
    m.loadBotStatuses.mockResolvedValue({ ok: true, bots: botStatuses });
    m.loadBotPermissions.mockResolvedValue({ ok: true, permissions });
    render(<BotBridgeSettings nowMs={FIXTURE_NOW} />);
    expect(await screen.findByTestId("bot-card-anima-backend-data")).toBeTruthy();
    expect(screen.getByTestId("bot-permissions")).toBeTruthy();
    expect(screen.getByText("Bot message alerts")).toBeTruthy();
    expect(screen.getByText(/can't show notifications/)).toBeTruthy();
  });

  it("shows the server's message when bot status cannot load", async () => {
    m.loadBridgeConfig.mockResolvedValue(enabledConfig);
    m.loadBotStatuses.mockResolvedValue({ ok: false, message: "The bot bridge is not enabled on this server." });
    m.loadBotPermissions.mockResolvedValue({ ok: false, message: "x" });
    render(<BotBridgeSettings nowMs={FIXTURE_NOW} />);
    expect(await screen.findByText("The bot bridge is not enabled on this server.")).toBeTruthy();
  });
});

describe("BotAwarenessPanel", () => {
  it("shows name, work, open items and last active; marks >6h stale", () => {
    render(<BotAwarenessPanel bots={botStatuses} nowMs={FIXTURE_NOW} />);
    const fresh = screen.getByTestId("bot-card-anima-backend-data");
    expect(fresh.dataset.stale).toBe("false");
    expect(within(fresh).getByText("Anima Backend Data")).toBeTruthy();
    expect(within(fresh).getByText(/Reviewing the bridge data model/)).toBeTruthy();
    expect(within(fresh).getByText(/PR #745 recap fix — merged/)).toBeTruthy();
    expect(within(fresh).getByText("(github.com)")).toBeTruthy();
    expect(within(fresh).getByText("Last active 20 min ago")).toBeTruthy();
    expect(fresh.querySelector("a")).toBeNull();
    const stale = screen.getByTestId("bot-card-seco");
    expect(stale.dataset.stale).toBe("true");
    expect(within(stale).getByText("Stale")).toBeTruthy();
    expect(within(stale).getByText(/Last heard 14 h ago/)).toBeTruthy();
  });

  it("says when no bot has reported", () => {
    render(<BotAwarenessPanel bots={[]} nowMs={FIXTURE_NOW} />);
    expect(screen.getByText("No bot has reported yet.")).toBeTruthy();
  });
});

describe("BotDraftConfirmCard", () => {
  it("shows the exact text and sends only on Send", async () => {
    const decide = vi.fn(async () => ({ ok: true as const }));
    render(<BotDraftConfirmCard draft={draft} decide={decide} nowMs={FIXTURE_NOW} />);
    expect(screen.getByTestId("bot-draft-text").textContent).toBe(draft.text);
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("act_123", "send"));
    expect(await screen.findByText("Sent.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("cancels without sending", async () => {
    const decide = vi.fn(async () => ({ ok: true as const }));
    render(<BotDraftConfirmCard draft={draft} decide={decide} nowMs={FIXTURE_NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("act_123", "cancel"));
    expect(await screen.findByText(/Nothing was sent/)).toBeTruthy();
  });

  it("keeps the card and shows the error when the server refuses (mocked 503)", async () => {
    const decide = vi.fn(async () => ({ ok: false as const, message: "The bot bridge is not enabled on this server." }));
    render(<BotDraftConfirmCard draft={draft} decide={decide} nowMs={FIXTURE_NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(await screen.findByText("The bot bridge is not enabled on this server.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send/ })).toBeTruthy();
  });

  it("offers no buttons once expired", () => {
    render(<BotDraftConfirmCard draft={draft} decide={vi.fn()} nowMs={Date.parse("2026-11-16T00:00:00Z")} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/expired/)).toBeTruthy();
  });
});

describe("BotPermissionSettings", () => {
  it("defaults every companion × bot pair to Ask every time, with Allow disabled", () => {
    render(<BotPermissionSettings permissions={permissions} onChange={vi.fn()} />);
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects).toHaveLength(4);
    for (const select of selects) {
      expect(select.value).toBe("ask");
      const allow = within(select).getByRole("option", { name: "Allow without asking" }) as HTMLOptionElement;
      expect(allow.disabled).toBe(true);
    }
    expect(screen.getByText(/isn't available yet/)).toBeTruthy();
  });

  it("enables Allow only when the backend supports standing permission", () => {
    const onChange = vi.fn();
    render(<BotPermissionSettings permissions={permissions} standingPermissionAvailable onChange={onChange} />);
    const select = screen.getByLabelText("Seco", { selector: "#bot-perm-c_serenity-seco" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "allow" } });
    expect(onChange).toHaveBeenCalledWith("c_serenity", "seco", "allow");
  });
});

describe("BotMessageBubble", () => {
  it("renders bot text as plain outside content with Remember disabled", () => {
    render(<BotMessageBubble message={inboundMessage} />);
    const bubble = screen.getByTestId("bot-message-bubble");
    expect(bubble.getAttribute("aria-label")).toBe("Outside message from Seco");
    expect(within(bubble).getByText(/outside the app/)).toBeTruthy();
    expect(bubble.querySelector("b")).toBeNull();
    expect(bubble.querySelector("a")).toBeNull();
    expect(bubble.textContent).toContain("<b>bold?</b>");
    const remember = screen.getByRole("button", { name: "Remember this" }) as HTMLButtonElement;
    expect(remember.disabled).toBe(true);
  });

  it("enables Remember this once available", () => {
    const onRemember = vi.fn();
    render(<BotMessageBubble message={{ ...inboundMessage, flagged: true }} rememberAvailable onRemember={onRemember} />);
    expect(screen.getByText(/looked like instructions/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remember this" }));
    expect(onRemember).toHaveBeenCalledWith("msg_1");
  });
});
