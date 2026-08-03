import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Back base44 with a fixed-size in-memory table and record every list() call so
// the test can prove each page is fetched with a real SQL offset (one page at a
// time) rather than pulling the whole history into memory. The real client gates
// every request on a Clerk token getter that never resolves under vitest, so it
// would otherwise hang.
vi.mock("@/api/base44Client", () => {
  let rows = [];
  const calls = [];
  const entity = (name) => ({
    async list(sortField, limit, opts) {
      calls.push({ name, sortField, limit, opts: { ...(opts || {}) } });
      const offset = opts?.offset || 0;
      return rows.slice(offset, offset + limit);
    },
    // Grand total: mirrors the server's count endpoint (whole table, no
    // limit/offset). Recorded so a test can prove it's a single cheap query.
    async count(opts) {
      calls.push({ name, count: true, opts: { ...(opts || {}) } });
      return rows.length;
    },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(name) });
  return {
    base44: { entities },
    default: { entities },
    __setRowCount: (n) => {
      rows = Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    },
    __calls: calls,
    __resetCalls: () => {
      calls.length = 0;
    },
  };
});

import { base44, __setRowCount, __calls, __resetCalls } from "@/api/base44Client";
import { usePaginatedEntities } from "@/hooks/usePaginatedEntities";

// React needs this flag set for act() to flush effects without warnings.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Minimal renderHook: mount a component that simply calls the hook and exposes
// its latest return value. A QueryClientProvider supplies the react-query
// context the hook depends on.
function renderHook(callback) {
  const result = { current: null };
  function Probe() {
    result.current = callback();
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(Probe)
      )
    );
  });
  return {
    result,
    unmount: () => act(() => root.unmount()),
  };
}

// Poll until a condition holds, flushing pending react-query state inside act()
// so the asynchronous queryFn resolution is applied to the component.
async function waitFor(condition, timeout = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  if (!condition()) throw new Error("waitFor: condition never became true");
}

const PAGE_SIZE = 50;

beforeEach(() => {
  __resetCalls();
});

describe("usePaginatedEntities pagination", () => {
  it("requests exactly one page (offset 0, pageSize+1 rows) on the first page", async () => {
    // 120 rows => three pages of 50 (last page partial).
    __setRowCount(120);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE)
    );

    await waitFor(() => result.current.isLoading === false);

    expect(result.current.currentPage).toBe(0);
    expect(result.current.items).toHaveLength(PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    // Only one page worth of rows was requested: pageSize + 1 (the extra row is
    // the "is there a next page?" probe), at offset 0 — never the full history.
    const last = __calls[__calls.length - 1];
    expect(last.name).toBe("ChatSession");
    expect(last.limit).toBe(PAGE_SIZE + 1);
    expect(last.opts.offset).toBe(0);

    unmount();
  });

  it("advances the offset on Next and rewinds it on Prev", async () => {
    __setRowCount(120);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE)
    );

    await waitFor(() => result.current.isLoading === false);
    expect(result.current.currentPage).toBe(0);

    // Next -> page 1, fetched at offset 50.
    act(() => result.current.nextPage());
    await waitFor(
      () => result.current.currentPage === 1 && result.current.isLoading === false
    );
    expect(result.current.items).toHaveLength(PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);
    expect(__calls[__calls.length - 1].opts.offset).toBe(PAGE_SIZE);

    // Next -> page 2 (final, partial), fetched at offset 100.
    act(() => result.current.nextPage());
    await waitFor(
      () => result.current.currentPage === 2 && result.current.isLoading === false
    );
    expect(result.current.items).toHaveLength(20);
    // Last page: no extra row beyond the page, so there is no next page.
    expect(result.current.hasMore).toBe(false);
    expect(__calls[__calls.length - 1].opts.offset).toBe(PAGE_SIZE * 2);

    // Prev -> back to page 1, fetched again at offset 50.
    act(() => result.current.prevPage());
    await waitFor(
      () => result.current.currentPage === 1 && result.current.isLoading === false
    );
    expect(__calls[__calls.length - 1].opts.offset).toBe(PAGE_SIZE);

    // Every request only ever asked for one page worth of rows.
    expect(__calls.every((c) => c.limit === PAGE_SIZE + 1)).toBe(true);

    unmount();
  });

  it("disables Prev on page 0 (prevPage clamps and cannot go negative)", async () => {
    __setRowCount(120);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE)
    );

    await waitFor(() => result.current.isLoading === false);

    // On page 0 the Sidebar renders Prev as `disabled={currentPage === 0}`.
    expect(result.current.currentPage).toBe(0);

    // Tapping Prev anyway must not move below page 0 (no negative offset).
    act(() => result.current.prevPage());
    await waitFor(() => result.current.isLoading === false);
    expect(result.current.currentPage).toBe(0);
    expect(__calls.every((c) => c.opts.offset === 0)).toBe(true);

    unmount();
  });

  it("reports hasMore=false on the last page (Next becomes disabled)", async () => {
    // Exactly two full pages: page 1 (offset 50) has no extra row, so hasMore
    // is false and the Sidebar renders Next as `disabled={!hasMore}`.
    __setRowCount(PAGE_SIZE * 2);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE)
    );

    await waitFor(() => result.current.isLoading === false);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.nextPage());
    await waitFor(
      () => result.current.currentPage === 1 && result.current.isLoading === false
    );
    expect(result.current.items).toHaveLength(PAGE_SIZE);
    expect(result.current.hasMore).toBe(false);

    unmount();
  });

  it("exposes a grand total + pageCount and jumps straight to any page when countTotal is on", async () => {
    // 120 rows / 50 per page => 3 pages, total 120.
    __setRowCount(120);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE, "-updated_date", undefined, {
        countTotal: true,
      })
    );

    await waitFor(
      () => result.current.isLoading === false && result.current.total === 120
    );
    expect(result.current.pageCount).toBe(3);

    // Jump straight to the LAST page in one call (no stepping). It fetches that
    // page's rows at the matching offset, not every preceding page.
    act(() => result.current.goToPage(result.current.pageCount - 1));
    await waitFor(
      () => result.current.currentPage === 2 && result.current.isLoading === false
    );
    expect(result.current.items).toHaveLength(20);
    const last = __calls.filter((c) => !c.count).pop();
    expect(last.opts.offset).toBe(PAGE_SIZE * 2);

    // The total came from exactly one count() call (not re-counted per page).
    expect(__calls.filter((c) => c.count).length).toBe(1);

    unmount();
  });

  it("clamps an out-of-range jump to the last page", async () => {
    __setRowCount(70); // 2 pages (50 + 20)
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE, "-updated_date", undefined, {
        countTotal: true,
      })
    );

    await waitFor(
      () => result.current.isLoading === false && result.current.pageCount === 2
    );

    // Asking for a wildly-out-of-range page snaps to the last valid page.
    act(() => result.current.goToPage(999));
    await waitFor(
      () => result.current.currentPage === 1 && result.current.isLoading === false
    );
    expect(result.current.currentPage).toBe(1);

    unmount();
  });

  it("does not count when countTotal is off (prev/next-only callers pay nothing)", async () => {
    __setRowCount(120);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE)
    );

    await waitFor(() => result.current.isLoading === false);
    expect(result.current.total).toBeNull();
    expect(result.current.pageCount).toBeNull();
    expect(__calls.some((c) => c.count)).toBe(false);

    unmount();
  });

  it("passes extra list options through on every page request", async () => {
    __setRowCount(120);
    const { result, unmount } = renderHook(() =>
      usePaginatedEntities("ChatSession", PAGE_SIZE, "-created_date", {
        withMessages: false,
      })
    );

    await waitFor(() => result.current.isLoading === false);
    act(() => result.current.nextPage());
    await waitFor(
      () => result.current.currentPage === 1 && result.current.isLoading === false
    );

    // The metadata-only flag rides along with the hook-managed offset on every
    // request (and the caller can never clobber offset).
    expect(__calls.every((c) => c.opts.withMessages === false)).toBe(true);
    expect(__calls.some((c) => c.opts.offset === PAGE_SIZE)).toBe(true);

    unmount();
  });
});
