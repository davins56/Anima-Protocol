import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PhotoMoments from "./PhotoMoments";

describe("PhotoMoments", () => {
  it("renders the album sections for the companion in the URL", async () => {
    const api = {
      listPhotos: vi.fn(async () => [
        { id: "p1", url: "/api/photo/images/p1/file", user_prompt: "beach", created_at: "2026-10-12T00:00:00Z" },
      ]),
      getTimelineEvents: vi.fn(async () => [{ id: "m1", eventType: "milestone", title: "Trust", occurredAt: "2026-10-10T00:00:00Z" }]),
    };
    render(
      <MemoryRouter initialEntries={["/moments/aeland-1"]}>
        <Routes>
          <Route path="/moments/:characterId" element={<PhotoMoments api={api} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Trust")).toBeTruthy();
    expect(api.listPhotos).toHaveBeenCalledWith({ characterId: "aeland-1", limit: 60 });
    expect(screen.getByAltText("beach").getAttribute("src")).toContain("/photo/images/p1/file");
  });
});
