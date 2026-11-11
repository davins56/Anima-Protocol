import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import WebSearchToggle from "@/components/chat/WebSearchToggle";
import { parseSearchCommand, prepareSearchTurn, searchStatusMessage } from "@/lib/webSearch";

describe("web search client", () => {
  it("parses /search and /web", () => {
    expect(parseSearchCommand("/search  tide times ")).toBe("tide times");
    expect(parseSearchCommand("/web lisbon trams")).toBe("lisbon trams");
    expect(parseSearchCommand("search tide")).toBeNull();
    expect(parseSearchCommand("/search ")).toBeNull();
  });

  it("prepares a turn carrying only the server audit id", async () => {
    const api = { search: { run: vi.fn().mockResolvedValue({ status: "ok", audit_id: "a1", results: [{ title: "T" }], remaining: 3 }) } };
    const out = await prepareSearchTurn({ text: "/search tides", characterId: "c1", saveAsMemory: true, api });
    expect(api.search.run).toHaveBeenCalledWith({ characterId: "c1", query: "tides", saveAsMemory: true });
    expect(out).toMatchObject({ text: "tides", webSearchAuditId: "a1", remaining: 3 });
  });

  it("rate limit / errors still send the words, without search context", async () => {
    const notify = vi.fn();
    const err = Object.assign(new Error("x"), { payload: { status: "rate_limited" } });
    const api = { search: { run: vi.fn().mockRejectedValue(err) } };
    const out = await prepareSearchTurn({ text: "/search tides", characterId: "c1", api, notify });
    expect(out).toEqual({ text: "tides", webSearchAuditId: null, results: [] });
    expect(notify).toHaveBeenCalledWith(searchStatusMessage({ status: "rate_limited" }));
  });

  it("icon renders only when the flag is on", () => {
    const { container, rerender } = render(<WebSearchToggle status={{ enabled: false }} />);
    expect(container.innerHTML).toBe("");
    const onSearch = vi.fn();
    rerender(<WebSearchToggle status={{ enabled: true, remaining: 7 }} onSearch={onSearch} />);
    expect(screen.getByText(/7 left/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Search the web"));
    fireEvent.change(screen.getByLabelText("Search query"), { target: { value: "tides" } });
    fireEvent.click(screen.getByLabelText("Run search"));
    expect(onSearch).toHaveBeenCalledWith("tides");
  });
});
