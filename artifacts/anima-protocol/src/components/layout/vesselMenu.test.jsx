import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/api/animaClient", () => ({
  animaClient: { entities: { ChatSession: { list: vi.fn(async () => []) } } },
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("@/hooks/useModelTutor", () => ({ useModelTutor: () => ({ isSteward: false }) }));

import BottomTabBar from "./BottomTabBar";
import HomeFloorSheets from "@/components/home/HomeFloorSheets";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

describe("Vessel Studio menu entry", () => {
  it("Explore menu lists Vessel Studio and opens /vessel", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <BottomTabBar />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Explore"));
    fireEvent.click(screen.getByText("Vessel Studio"));
    expect(screen.getByTestId("where").textContent).toBe("/vessel");
  });

  it("Home People sheet lists Vessel studio", () => {
    const onNavigate = vi.fn();
    render(<HomeFloorSheets panel="people" onClose={() => {}} sessions={[]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("Vessel studio"));
    expect(onNavigate).toHaveBeenCalledWith("/vessel");
  });
});
