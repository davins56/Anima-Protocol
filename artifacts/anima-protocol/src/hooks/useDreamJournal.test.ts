import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DreamJournalError } from "@/lib/dreamJournal";

const fetchDreamJournal = vi.fn();
const updateDreamJournalSettings = vi.fn();
const markDreamRead = vi.fn();

vi.mock("@/lib/dreamJournal", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dreamJournal")>("@/lib/dreamJournal");
  return {
    ...actual,
    fetchDreamJournal: (...args: unknown[]) => fetchDreamJournal(...args),
    updateDreamJournalSettings: (...args: unknown[]) => updateDreamJournalSettings(...args),
    markDreamRead: (...args: unknown[]) => markDreamRead(...args),
  };
});

import { useDreamJournal } from "./useDreamJournal";

const page = {
  character_id: "c1",
  dreaming_enabled: true,
  unread_count: 1,
  is_dreaming: false,
  dreams: [
    {
      id: "d1",
      created_at: "2026-11-10T12:00:00.000Z",
      mood: "wistful",
      themes: ["lantern"],
      summary: "A hall of glass.",
      fragment: "I kept a lantern.",
      read: false,
    },
  ],
  next_cursor: "next",
};

describe("useDreamJournal", () => {
  afterEach(() => {
    fetchDreamJournal.mockReset();
    updateDreamJournalSettings.mockReset();
    markDreamRead.mockReset();
  });

  it("loads a page and can load more", async () => {
    fetchDreamJournal
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, dreams: [{ ...page.dreams[0], id: "d0" }], next_cursor: null, unread_count: 0 });
    const { result } = renderHook(() => useDreamJournal("c1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dreams).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.unavailable).toBe(false);
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.dreams.map((d) => d.id)).toEqual(["d1", "d0"]));
    expect(result.current.hasMore).toBe(false);
  });

  it("flags a missing route as not available yet", async () => {
    fetchDreamJournal.mockRejectedValue(new DreamJournalError("unavailable", 404));
    const { result } = renderHook(() => useDreamJournal("c1"));
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.dreams).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("rolls back Let her dream if the setting cannot be saved", async () => {
    fetchDreamJournal.mockResolvedValue(page);
    updateDreamJournalSettings.mockRejectedValue(new DreamJournalError("unavailable", 404));
    const { result } = renderHook(() => useDreamJournal("c1"));
    await waitFor(() => expect(result.current.dreamingEnabled).toBe(true));
    await act(async () => {
      await result.current.setLetHerDream(false);
    });
    expect(result.current.dreamingEnabled).toBe(true);
    expect(result.current.unavailable || result.current.error?.code === "unavailable").toBe(true);
  });
});
