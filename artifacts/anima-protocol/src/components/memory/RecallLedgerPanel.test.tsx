import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RecallLedgerPanel from "./RecallLedgerPanel";

vi.mock("@/lib/apiOrigin", () => ({ apiUrl: (p: string) => `https://api.test/api${p}` }));
vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ Authorization: "Bearer t" }) }));

const example = {
  character_id: "char_aeland_01",
  batches: [
    {
      batch_id: "batch-1",
      recalled_at: "2026-11-10T22:14:03.123456Z",
      session_id: "sess_9f2",
      turn_id: null,
      recalls: [
        {
          recall_id: "6c1e4c2a-6f0e-4f53-9d3f-0b8f0c1d2e3f",
          rank: 1,
          score: 0.7132,
          similarity: 0.8211,
          recency: 0.12,
          emotional_weight: 0.9,
          memory_age_s: 19353600,
          memory: {
            event_id: "0d4b1a7e-2c4f-4b8e-9a51-3f7e2d9c8b10",
            event_type: "turn",
            content_preview:
              "User: I finally called my dad back.\nMe: I'm proud of you. You said it felt like carrying a stone.",
            occurred_at: "2026-04-01T10:00:00.000000Z",
            conversation_id: "sess_41a",
            source_turn_id: "turn_41a_0007",
            corrupted: false,
          },
        },
        {
          recall_id: "corrupted-1",
          rank: 2,
          score: 0.4,
          similarity: null,
          recency: 0.2,
          emotional_weight: 0.5,
          memory_age_s: 86400,
          memory: {
            event_id: "evt-corrupt",
            event_type: "note",
            content_preview: "A faded fragment of a private moment.",
            occurred_at: "2026-11-09T22:00:00.000000Z",
            conversation_id: "sess_9f2",
            source_turn_id: null,
            corrupted: true,
          },
        },
      ],
      withheld: { retracted: 1, unattributable: 0 },
    },
  ],
  next_cursor: "cursor-2",
  meta: { limit: 10, max_limit: 25, turn_linkage: "none", grouping: "session_id+recalled_at" },
};

const pageTwo = {
  ...example,
  batches: [
    {
      ...example.batches[0],
      batch_id: "batch-2",
      recalled_at: "2026-11-09T12:00:00.000000Z",
      recalls: [
        {
          ...example.batches[0].recalls[0],
          recall_id: "older-1",
          memory: {
            ...example.batches[0].recalls[0].memory,
            event_id: "evt-older",
            content_preview: "An earlier recalled memory.",
            source_turn_id: null,
          },
        },
      ],
      withheld: { retracted: 0, unattributable: 0 },
    },
  ],
  next_cursor: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderPanel(props: { sessionId?: string | null } = {}) {
  return render(
    <MemoryRouter>
      <RecallLedgerPanel
        characterId="char_aeland_01"
        characterName="Aeland"
        sessionId={props.sessionId ?? "sess_9f2"}
        returnTo="/chat/sess_9f2"
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RecallLedgerPanel", () => {
  it("shows a loading state, then recall moments with scores, a corrupted badge, and a quiet withheld note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(example)));
    renderPanel();
    expect(screen.getByTestId("recall-ledger-loading").textContent).toMatch(/Looking up what she recalled/);
    expect(await screen.findByText(/I finally called my dad back/)).toBeTruthy();
    expect(screen.getByText("Conversation")).toBeTruthy();
    expect(screen.getByText("Score 71% · Match 82% · Recency 12% · Feeling 90%")).toBeTruthy();
    expect(screen.getByText(/candidate/i)).toBeTruthy();
    expect(screen.getByText("1 forgotten memory isn't shown.")).toBeTruthy();
    expect(screen.getByTestId("recall-corrupted-badge").textContent).toBe("Corrupted");
    expect(screen.getByText(/From the conversation that created this memory/)).toBeTruthy();
    expect(screen.queryByText(/turn_41a_0007/)).toBeNull();
    expect(screen.queryByRole("heading", { name: /\bturns?\b/i })).toBeNull();
    const forget = screen.getAllByRole("link", { name: "Forget this" })[0] as HTMLAnchorElement;
    expect(forget.getAttribute("href")).toContain("/what-she-remembers/char_aeland_01");
    expect(forget.getAttribute("href")).toContain("memory=0d4b1a7e-2c4f-4b8e-9a51-3f7e2d9c8b10");
  });

  it("loads earlier moments with loadMore", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("cursor=cursor-2")) return jsonResponse(pageTwo);
      return jsonResponse(example);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await screen.findByText(/I finally called my dad back/);
    fireEvent.click(screen.getByTestId("recall-ledger-load-more"));
    expect(await screen.findByText("An earlier recalled memory.")).toBeTruthy();
    expect(screen.queryByTestId("recall-ledger-load-more")).toBeNull();
  });

  it("filters to the current session", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("session_id=sess_9f2")) return jsonResponse(example);
      return jsonResponse(example);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await screen.findByText(/I finally called my dad back/);
    fireEvent.click(screen.getByTestId("recall-ledger-session-filter"));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("session_id=sess_9f2"))).toBe(true);
    });
  });

  it("shows an empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...example, batches: [], next_cursor: null })));
    renderPanel();
    expect(await screen.findByTestId("recall-ledger-empty")).toBeTruthy();
  });

  it("shows companion_not_found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Companion not found", code: "companion_not_found" }, 404)),
    );
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This companion could not be found.");
  });

  it("shows memory not set up yet on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Memory core is not migrated yet.", code: "memory_schema_missing" }, 503)),
    );
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Memory not set up yet.");
  });

  it("shows a generic error with a retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Recall ledger request failed.", code: "server_error" }, 500)));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The memory ledger could not be loaded.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
