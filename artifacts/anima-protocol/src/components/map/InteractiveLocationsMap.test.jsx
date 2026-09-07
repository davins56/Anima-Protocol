import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import InteractiveLocationsMap from "./InteractiveLocationsMap";
import { base44 } from "@/api/base44Client";

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      WorldState: {
        filter: vi.fn(),
      },
      Location: {
        list: vi.fn(),
      },
      ChatSession: {
        list: vi.fn(),
      },
    },
  },
}));

describe("InteractiveLocationsMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    base44.entities.ChatSession.list.mockResolvedValue([]);
  });

  it("renders default fallback location markers when DB records are empty", async () => {
    base44.entities.WorldState.filter.mockResolvedValue([]);
    base44.entities.Location.list.mockResolvedValue([]);

    render(<InteractiveLocationsMap sessionId={null} />);

    await waitFor(() => {
      expect(screen.getByText(/5 locations discovered/i)).toBeDefined();
    });
  });

  it("renders locations returned from WorldState and Location entities", async () => {
    base44.entities.WorldState.filter.mockResolvedValue([
      {
        id: "ws-1",
        subject: "The Air Temple",
        fact: "An ancient airbender sanctuary.",
        importance: "high",
        session_id: "s1",
      },
    ]);
    base44.entities.Location.list.mockResolvedValue([
      {
        id: "loc-1",
        name: "Stark Tower",
        description: "Headquarters for Stark Industries.",
        significance: "critical",
        x_coord: 40,
        y_coord: 50,
      },
    ]);

    render(<InteractiveLocationsMap sessionId={null} />);

    await waitFor(() => {
      expect(screen.getByText(/2 locations discovered/i)).toBeDefined();
    });
  });
});
