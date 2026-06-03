import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

// LoreArchivesDashboard's whole point is the FAST path: it lists ChatSession
// metadata-only ({ withMessages: false }) and derives XP/rank totals from a
// single server-side message COUNT (base44.messages.counts), instead of
// hydrating every session's full chat history on open. A regression — dropping
// the withMessages flag, or reverting totals to s.messages.length — would
// silently bring back the slow load.
//
// The real base44 client gates every request on a Clerk token getter that never
// resolves under vitest (it would hang), so we back it with an in-memory mock
// that RECORDS every call. That lets us prove, without a server:
//   - ChatSession.list is always asked for metadata only (withMessages:false)
//   - the listing path never hydrates per-session history (messages.list/
//     bySessions are not used to load the screen)
//   - XP/rank totals come from the counts map, with a legacy blob fallback for
//     not-yet-migrated sessions
//   - auto-crystal generation fetches message content ONLY for eligible
//     sessions (count >= 10), on demand, capped at 5
vi.mock("@/api/base44Client", () => {
  // Recorded calls + seedable backend state.
  const calls = {
    chatSessionList: [], // each list() opts
    messagesCounts: [], // each counts(ids) call
    messagesList: [], // each per-session list(id) call
    messagesBySessions: [], // batch hydrate (must stay empty on open)
    crystalCreate: [], // each MemoryCrystal.create(payload)
    profileCreate: [], // each ResonanceProfile.create(payload)
    profileUpdate: [], // each ResonanceProfile.update(id, payload)
  };

  let state = {
    me: { email: "seeker@anima.test" },
    sessions: [], // returned by ChatSession.list (metadata only)
    counts: {}, // returned by messages.counts
    sessionMessages: {}, // id -> full message rows, only via messages.list
    crystals: [], // existing MemoryCrystal rows
    profile: null, // existing ResonanceProfile (null => new user)
  };

  const entities = {
    ResonanceProfile: {
      filter: async () => (state.profile ? [state.profile] : []),
      create: async (payload) => {
        calls.profileCreate.push(payload);
        state.profile = { id: "profile-1", ...payload };
        return state.profile;
      },
      update: async (id, payload) => {
        calls.profileUpdate.push({ id, payload });
        state.profile = { ...(state.profile || {}), id, ...payload };
        return state.profile;
      },
    },
    MemoryCrystal: {
      filter: async () => state.crystals.map((c) => ({ ...c })),
      create: async (payload) => {
        calls.crystalCreate.push(payload);
        const rec = { id: `crystal-${calls.crystalCreate.length}`, ...payload };
        state.crystals.push(rec);
        return rec;
      },
    },
    ChatSession: {
      list: async (_sort, _limit, opts) => {
        calls.chatSessionList.push({ ...(opts || {}) });
        // Metadata-only list: never carries a hydrated messages array.
        return state.sessions.map((s) => ({ ...s }));
      },
    },
  };

  const messages = {
    counts: async (ids) => {
      calls.messagesCounts.push([...(ids || [])]);
      return { ...state.counts };
    },
    list: async (sessionId) => {
      calls.messagesList.push(sessionId);
      return (state.sessionMessages[sessionId] || []).map((m) => ({ ...m }));
    },
    bySessions: async (ids) => {
      calls.messagesBySessions.push([...(ids || [])]);
      return {};
    },
  };

  const base44 = { auth: { me: async () => state.me }, entities, messages };

  return {
    base44,
    default: base44,
    __setState: (next) => {
      state = {
        me: { email: "seeker@anima.test" },
        sessions: [],
        counts: {},
        sessionMessages: {},
        crystals: [],
        profile: null,
        ...next,
      };
    },
    __calls: calls,
    __reset: () => {
      for (const k of Object.keys(calls)) calls[k].length = 0;
    },
  };
});

import { __setState, __calls, __reset } from "@/api/base44Client";
import LoreArchivesDashboard from "@/pages/LoreArchivesDashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mount the page under a router (it renders <Link>), returning the container so
// tests can wait for the loading screen to clear before asserting.
function renderDashboard() {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(LoreArchivesDashboard),
      ),
    );
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

// init() awaits the entire load (including auto-crystal generation) before
// flipping loading off, so once the "Synchronizing Archive" screen is gone the
// page has fully settled. Flush async state inside act() until then.
async function waitForLoaded(container, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!container.textContent.includes("Synchronizing")) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  if (container.textContent.includes("Synchronizing")) {
    throw new Error("waitForLoaded: dashboard never finished loading");
  }
}

// XP/rank math mirrored from the page so the tests pin the PREVIOUS behavior
// rather than just re-deriving from whatever the component currently does.
function expectedXP(sessionCounts, crystals = []) {
  const sessionXP = sessionCounts.length * 40;
  const messageXP = sessionCounts.reduce(
    (sum, c) => sum + Math.min(c * 2, 200),
    0,
  );
  const crystalXP = crystals.reduce(
    (sum, c) => sum + (c.resonance_xp_awarded || 50),
    0,
  );
  return sessionXP + messageXP + crystalXP;
}

beforeEach(() => {
  __reset();
});

describe("LoreArchivesDashboard fast load", () => {
  it("lists ChatSession metadata-only and never hydrates per-session history on open", async () => {
    // All sessions below the crystal threshold => no on-demand fetches at all,
    // so the ONLY message data touched is the single batch COUNT.
    __setState({
      sessions: [
        { id: "s1", messages: [] },
        { id: "s2", messages: [] },
        { id: "s3", messages: [] },
      ],
      counts: { s1: 4, s2: 2, s3: 0 },
      profile: {
        id: "profile-1",
        resonance_xp: 0,
        resonance_rank: "Initiate",
        unlocked_chapters: ["chapter_zero"],
      },
    });

    const { container, unmount } = renderDashboard();
    await waitForLoaded(container);

    // Every ChatSession.list call opted out of message hydration.
    expect(__calls.chatSessionList.length).toBeGreaterThan(0);
    expect(
      __calls.chatSessionList.every((opts) => opts.withMessages === false),
    ).toBe(true);

    // Totals came from ONE batch count over exactly the listed session ids...
    expect(__calls.messagesCounts).toHaveLength(1);
    expect(__calls.messagesCounts[0].sort()).toEqual(["s1", "s2", "s3"]);

    // ...and NO per-session history was pulled (no slow load).
    expect(__calls.messagesList).toEqual([]);
    expect(__calls.messagesBySessions).toEqual([]);

    unmount();
  });

  it("computes XP/rank totals from message_count, with a legacy blob fallback", async () => {
    // s1 + s3 are migrated (history lives in rows, counted server-side); s2 is a
    // legacy session that still carries its messages blob and must fall back to
    // the blob length. None reach the crystal threshold, isolating the math.
    const legacyBlob = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` }));
    __setState({
      sessions: [
        { id: "s1", messages: [] },
        { id: "s2", messages: legacyBlob },
        { id: "s3", messages: [] },
      ],
      counts: { s1: 6, s2: 0, s3: 3 }, // server has no rows for legacy s2
      profile: {
        id: "profile-1",
        resonance_xp: 0,
        resonance_rank: "Initiate",
        unlocked_chapters: ["chapter_zero"],
      },
    });

    const { container, unmount } = renderDashboard();
    await waitForLoaded(container);

    // Effective per-session counts: s1=6 (count), s2=8 (blob fallback), s3=3.
    const perSession = [6, 8, 3];
    const totalMessages = perSession.reduce((a, b) => a + b, 0); // 17
    const xp = expectedXP(perSession); // no existing crystals

    expect(__calls.profileUpdate).toHaveLength(1);
    const { payload } = __calls.profileUpdate[0];
    expect(payload.total_sessions).toBe(3);
    expect(payload.total_messages).toBe(totalMessages);
    expect(payload.resonance_xp).toBe(xp);
    expect(payload.resonance_rank).toBe("Initiate"); // xp < 300

    // The rendered Total XP reflects the count-derived value, not a blob length.
    expect(container.textContent).toContain(xp.toLocaleString());

    unmount();
  });

  it("bootstraps a new user's profile totals from message_count too", async () => {
    __setState({
      sessions: [
        { id: "s1", messages: [] },
        { id: "s2", messages: [] },
      ],
      counts: { s1: 5, s2: 1 },
      profile: null, // brand-new user => create() path
    });

    const { container, unmount } = renderDashboard();
    await waitForLoaded(container);

    expect(__calls.profileCreate).toHaveLength(1);
    expect(__calls.profileUpdate).toHaveLength(0);
    expect(__calls.profileCreate[0].total_sessions).toBe(2);
    expect(__calls.profileCreate[0].total_messages).toBe(6);
    // Still no full-history hydration for a new user.
    expect(__calls.messagesList).toEqual([]);

    unmount();
  });

  it("auto-generates crystals only for eligible sessions, fetching their content on demand and capped at 5", async () => {
    // 7 sessions reach the >=10 threshold, 1 already has a crystal, and 2 are
    // below threshold. Eligible-without-a-crystal = 6, but generation is capped
    // at 5, so exactly 5 sessions get their content fetched on demand.
    const sessions = [];
    const counts = {};
    const sessionMessages = {};
    for (let i = 1; i <= 7; i += 1) {
      const id = `big${i}`;
      sessions.push({ id, messages: [] });
      counts[id] = 12; // eligible
      sessionMessages[id] = [
        { role: "user", content: "hello there" },
        {
          role: "assistant",
          character_name: `Char${i}`,
          content: "a".repeat(60),
        },
      ];
    }
    // Below-threshold sessions: never eligible, never fetched.
    sessions.push({ id: "small1", messages: [] });
    sessions.push({ id: "small2", messages: [] });
    counts.small1 = 4;
    counts.small2 = 9;

    __setState({
      sessions,
      counts,
      sessionMessages,
      // big1 already has a crystal => skipped even though it's eligible.
      crystals: [
        { id: "c0", session_id: "big1", resonance_xp_awarded: 50 },
      ],
      profile: {
        id: "profile-1",
        resonance_xp: 0,
        resonance_rank: "Initiate",
        unlocked_chapters: ["chapter_zero"],
      },
    });

    const { container, unmount } = renderDashboard();
    await waitForLoaded(container);

    // Content fetched for exactly 5 sessions (the cap), all eligible & crystal-
    // less; never for big1 (already has one) or the below-threshold sessions.
    expect(__calls.messagesList).toHaveLength(5);
    const fetched = new Set(__calls.messagesList);
    expect(fetched.has("big1")).toBe(false);
    expect(fetched.has("small1")).toBe(false);
    expect(fetched.has("small2")).toBe(false);
    for (const id of __calls.messagesList) {
      expect(id.startsWith("big")).toBe(true);
    }

    // One crystal created per fetched session, no more.
    expect(__calls.crystalCreate).toHaveLength(5);
    expect(
      __calls.crystalCreate.every((c) => fetched.has(c.session_id)),
    ).toBe(true);

    // The screen still loaded via the metadata-only path + a single batch count.
    expect(
      __calls.chatSessionList.every((opts) => opts.withMessages === false),
    ).toBe(true);
    expect(__calls.messagesCounts).toHaveLength(1);
    expect(__calls.messagesBySessions).toEqual([]);

    unmount();
  });
});
