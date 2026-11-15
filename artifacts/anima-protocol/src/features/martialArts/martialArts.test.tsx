import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createBattle, tickBattle } from "@/lib/netBattle";
import { battleModsFor, SEED_LIBRARY } from "@workspace/martial-core";
import { ensureFirstBattleProfile, resetMartialArtsStatus } from "./api";
import { fromSessionStyle, latestNarration } from "./battleStyle";
import BattleStyleFlavor from "./BattleStyleFlavor";
import EncounterStance from "./EncounterStance";
import StylePanel from "./StylePanel";
import { jsonResponse, PROFILE, VIEW_NO_PROFILE, VIEW_WITH_PROFILE } from "./fixtures";

vi.mock("@/api/authBridge", () => ({ authHeaders: async (extra?: Record<string, string>) => ({ ...(extra || {}) }) }));

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
let route: Route;
const calls: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  resetMartialArtsStatus();
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return route(String(url), init);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const off: Route = () => jsonResponse(404, { error: "not_found" });

describe("flag off / server route missing (404)", () => {
  it("StylePanel renders nothing", async () => {
    route = off;
    const { container } = render(<StylePanel characterId="char-a" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("first battle makes no pick and NetBattle stays byte-identical", async () => {
    route = off;
    expect(await ensureFirstBattleProfile("char-a")).toBeNull();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    const a = createBattle({ anima: { name: "A" }, seed: 42 });
    const b = createBattle({ anima: { name: "A" }, seed: 42, style: null });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a).not.toHaveProperty("style");
  });

  it("encounter view shows no stance line", async () => {
    route = off;
    const { container } = render(<EncounterStance characterId="char-a" name="Mira" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(container.innerHTML).toBe("");
  });
});

describe("StylePanel (agreed contract fixtures)", () => {
  it("shows her suggestion and top five before her first battle, and lets her choose now (expected_rev 0)", async () => {
    let view = VIEW_NO_PROFILE;
    route = (url) => {
      if (url.endsWith("/pick")) {
        view = VIEW_WITH_PROFILE;
        return jsonResponse(200, { profile: PROFILE });
      }
      if (url.includes("/characters/")) return jsonResponse(200, view);
      return jsonResponse(200, { enabled: true, library_version: "seed@1.1" });
    };
    render(<StylePanel characterId="char-a" name="Mira" />);
    expect((await screen.findByTestId("martial-primary")).textContent).toContain("Iaido");
    expect(screen.getByText(/will choose for herself at her first battle/)).toBeTruthy();
    expect(screen.getByTestId("martial-ranking").querySelectorAll("li")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Let her choose now" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "auto", expected_rev: 0 }));
    expect(await screen.findByText("She chose this")).toBeTruthy();
    expect(screen.getByTestId("martial-explanation").textContent).toContain(PROFILE.explanation);
  });

  it("re-rolls with the stored rev and recovers from 409 stale_rev by reloading", async () => {
    route = (url) => (url.endsWith("/pick") ? jsonResponse(409, { code: "stale_rev", profile: PROFILE }) : jsonResponse(200, VIEW_WITH_PROFILE));
    render(<StylePanel characterId="char-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask her again" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "reroll", expected_rev: 1 }));
    expect((await screen.findByRole("status")).textContent).toContain("changed somewhere else");
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2));
  });

  it("overrides with ids only, via keyboard-usable native controls", async () => {
    route = (url) => (url.endsWith("/pick") ? jsonResponse(200, { profile: PROFILE }) : jsonResponse(200, VIEW_WITH_PROFILE));
    render(<StylePanel characterId="char-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose for her" }));
    const [styleSel, , ] = screen.getAllByRole("combobox");
    fireEvent.change(styleSel, { target: { value: "judo" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "ne_waza" } });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "kendo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save her style" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        action: "override",
        primary: { style_id: "judo", variant_id: "ne_waza" },
        secondary: { style_id: "kendo", variant_id: null },
        expected_rev: 1,
      }),
    );
  });

  it("shows the stale notice and the 422 / 429 messages", async () => {
    route = (url) => (url.endsWith("/pick") ? jsonResponse(429, { code: "rate_limited" }) : jsonResponse(200, { ...VIEW_WITH_PROFILE, stale: true }));
    render(<StylePanel characterId="char-a" />);
    expect(await screen.findByTestId("martial-stale")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask her again" }));
    expect((await screen.findByRole("status")).textContent).toContain("Too many changes");
  });

  it("renders server text as plain text, never HTML", async () => {
    route = () => jsonResponse(200, { ...VIEW_WITH_PROFILE, profile: { ...PROFILE, explanation: "<img src=x onerror=alert(1)>" } });
    const { container } = render(<StylePanel characterId="char-a" />);
    await screen.findByTestId("martial-explanation");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("first battle (D3)", () => {
  it("asks the server for one auto pick, and converges on 409 by re-reading", async () => {
    let reads = 0;
    route = (url) => {
      if (url.endsWith("/status")) return jsonResponse(200, { enabled: true, library_version: "seed@1.1" });
      if (url.endsWith("/pick")) return jsonResponse(409, { code: "stale_rev" });
      reads++;
      return jsonResponse(200, reads === 1 ? VIEW_NO_PROFILE : VIEW_WITH_PROFILE);
    };
    const p = await ensureFirstBattleProfile("char-a");
    expect(p?.primary).toEqual(PROFILE.primary);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "auto", expected_rev: 0 });
  });

  it("an existing profile is used without writing", async () => {
    route = (url) => (url.endsWith("/status") ? jsonResponse(200, { enabled: true }) : jsonResponse(200, VIEW_WITH_PROFILE));
    expect((await ensureFirstBattleProfile("char-a"))?.rev).toBe(1);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("NetBattle style tilt (client-only, non-authoritative)", () => {
  it("tilts attack, incoming damage and speed within ±15% and narrates", () => {
    const base = createBattle({ anima: { name: "A" }, seed: 7 });
    const styled = createBattle({ anima: { name: "A" }, seed: 7, style: { pick: { style_id: "muay_thai", variant_id: "muay_khao" } } });
    const mods = battleModsFor(SEED_LIBRARY, { style_id: "muay_thai" }, "composed");
    expect(styled.stats.attack / base.stats.attack).toBeCloseTo(mods.strike, 6);
    expect(base.stats.defense / styled.stats.defense).toBeCloseTo(mods.guard, 6);
    expect(styled.stats.speed / base.stats.speed).toBeCloseTo(mods.speed, 6);
    for (const r of [styled.stats.attack / base.stats.attack, base.stats.defense / styled.stats.defense, styled.stats.speed / base.stats.speed]) {
      expect(r).toBeGreaterThanOrEqual(0.85);
      expect(r).toBeLessThanOrEqual(1.15);
    }
    expect(styled.log.at(-1)).toMatch(/settles into/);
    let s = styled;
    for (let i = 0; i < 5; i++) s = tickBattle(s);
    expect(s.style.mods).toEqual(mods);
  });

  it("an unknown style id is ignored", () => {
    const a = createBattle({ anima: { name: "A" }, seed: 7 });
    const b = createBattle({ anima: { name: "A" }, seed: 7, style: { pick: { style_id: "jeet_kune_do" } } });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("battle and encounter flavor", () => {
  it("uses the server-frozen session style and its tone; malformed → null", () => {
    expect(fromSessionStyle({ styleId: "wing_chun", variantId: "yip_man_lineage", secondaryId: null, tone: "guarded" })).toEqual({
      pick: { style_id: "wing_chun", variant_id: "yip_man_lineage" },
      tone: "guarded",
    });
    expect(fromSessionStyle({ styleId: "wing_chun", tone: "furious" })?.tone).toBe("composed");
    expect(fromSessionStyle({ styleId: "nope" })).toBeNull();
    expect(fromSessionStyle(null)).toBeNull();
  });

  it("narrates the latest navi event in SimArena's HUD", () => {
    const style = { pick: { style_id: "wing_chun", variant_id: null }, tone: "composed" as const };
    const events = [
      { type: "hit", sourceId: "navi", seq: 3 },
      { type: "hit", sourceId: "mettaur-1", seq: 4 },
    ];
    const line = latestNarration(events, style);
    expect(line).toBeTruthy();
    render(<BattleStyleFlavor style={style} events={events} />);
    expect((screen.getByTestId("battle-style-flavor")).textContent).toContain("Wing Chun");
    expect((screen.getByTestId("battle-style-flavor")).textContent).toContain(line!);
  });

  it("shows one stance line from the quest view's style without any fetch", async () => {
    route = off;
    render(<EncounterStance characterId="char-a" name="Mira" viewStyle={{ style_id: "silat", variant_id: "harimau" }} />);
    expect((screen.getByTestId("encounter-stance")).textContent).toContain("Mira settles into a low silat stance. Silat, Harimau.");
    expect(calls).toHaveLength(0);
  });

  it("falls back to her stored profile", async () => {
    route = (url) => (url.endsWith("/status") ? jsonResponse(200, { enabled: true }) : jsonResponse(200, VIEW_WITH_PROFILE));
    render(<EncounterStance characterId="char-a" name="Mira" />);
    expect((await screen.findByTestId("encounter-stance")).textContent).toContain("Mira settles into");
  });
});
