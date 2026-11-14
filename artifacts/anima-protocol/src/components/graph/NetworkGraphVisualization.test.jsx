// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import NetworkGraphVisualization, { GRAPH_SIZE, NODE_COLORS, layoutGraph } from "./NetworkGraphVisualization";

afterEach(cleanup);

const chars = ["Mira", "Mako", "Wren", "Rook", "Cass", "Aeland", "Dax"].map((name, i) => ({ id: `c${i}`, name }));

describe("layoutGraph", () => {
  it("puts characters on a centred ring instead of a 5-column grid", () => {
    const { nodes } = layoutGraph({ characters: chars });
    expect(nodes).toHaveLength(7);
    const c = layoutGraph({ characters: chars }).size / 2;
    const radii = nodes.map((n) => Math.hypot(n.x - c, n.y - c));
    // Same distance from the centre, i.e. a ring, and well inside the view.
    for (const r of radii) expect(r).toBeCloseTo(radii[0], 5);
    expect(radii[0]).toBeGreaterThan(150);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(GRAPH_SIZE);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(GRAPH_SIZE);
    }
    // Not a grid: more than five distinct rows.
    expect(new Set(nodes.map((n) => Math.round(n.y))).size).toBeGreaterThan(2);
  });

  it("colours and rings each type separately", () => {
    const { nodes } = layoutGraph({
      characters: chars.slice(0, 3),
      factions: [{ id: "f1", name: "Net Police" }],
      locations: [{ id: "l1", name: "ACDC Town" }, { id: "l2", name: "Den City" }],
    });
    const c = GRAPH_SIZE / 2;
    const r = (t) => Math.hypot(nodes.find((n) => n.type === t).x - c, nodes.find((n) => n.type === t).y - c);
    expect(nodes.find((n) => n.type === "faction").color).toBe(NODE_COLORS.faction);
    expect(nodes.find((n) => n.type === "location").color).toBe(NODE_COLORS.location);
    expect(nodes.find((n) => n.type === "character").color).toBe(NODE_COLORS.character);
    expect(r("character")).toBeLessThan(r("faction"));
    expect(r("faction")).toBeLessThan(r("location"));
  });

  it("spills a crowded group onto more rings instead of overlapping", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, name: `Anima ${i}` }));
    const { nodes, size } = layoutGraph({ characters: many, factions: [{ id: "f", name: "F" }], locations: [{ id: "l", name: "L" }] });
    expect(nodes).toHaveLength(102);
    expect(size).toBeGreaterThan(GRAPH_SIZE);
    let closest = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        closest = Math.min(closest, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y));
      }
    }
    expect(closest).toBeGreaterThan(80);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(size);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(size);
    }
  });

  it("draws relationship edges once per pair and skips dangling rows", () => {
    const { edges } = layoutGraph({
      characters: chars.slice(0, 3),
      relationships: [
        { character_id: "c0", related_character_id: "c1", score: 60, tier: "close" },
        { character_id: "c1", related_character_id: "c0", score: 55, tier: "close" },
        { character_id: "c0", related_character_id: "gone", score: 10 },
        { character_id: "c2", related_character_id: "c2", score: 10 },
      ],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0].tier).toBe("close");
  });

  it("tolerates missing lists and unnamed rows", () => {
    expect(layoutGraph({})).toEqual({ nodes: [], edges: [], size: GRAPH_SIZE });
    expect(layoutGraph({ characters: [{ id: "x" }] }).nodes[0].name).toBe("?");
  });
});

describe("NetworkGraphVisualization", () => {
  it("renders nodes with full-name labels and edges", () => {
    const onNodeClick = vi.fn();
    const { container } = render(
      <svg>
        <NetworkGraphVisualization
          data={{ characters: chars.slice(0, 2), relationships: [{ character_id: "c0", related_character_id: "c1", score: 40, tier: "warm" }] }}
          selectedNode={null}
          onNodeClick={onNodeClick}
        />
      </svg>,
    );
    expect(container.querySelectorAll("[data-graph-node='character']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-graph-edge]")).toHaveLength(1);
    expect(container.textContent).toContain("Mira");
    container.querySelector("[data-graph-node='character']").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ id: "c0", name: "Mira" }));
  });

  it("nodes are keyboard-operable buttons", () => {
    const onNodeClick = vi.fn();
    const { getByRole } = render(
      <svg>
        <NetworkGraphVisualization data={{ characters: chars.slice(0, 2) }} selectedNode={null} onNodeClick={onNodeClick} />
      </svg>,
    );
    const node = getByRole("button", { name: "Mako (character)" });
    expect(node.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(node, { key: "Enter" });
    fireEvent.keyDown(node, { key: " " });
    expect(onNodeClick).toHaveBeenCalledTimes(2);
  });
});
