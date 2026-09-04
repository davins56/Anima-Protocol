import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStoreZip } from "@/lib/codespace/zipCodec";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  listCharacters: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      CodespaceProject: {
        list: mocks.listProjects,
        create: mocks.createProject,
        update: mocks.updateProject,
      },
      Character: { list: mocks.listCharacters },
    },
  },
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: () => {},
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: () => Promise.resolve(),
}));

vi.mock("@/lib/codespace/useCodespaceAgent", () => ({
  useCodespaceAgent: () => ({ running: false, runGoal: vi.fn(), stop: vi.fn() }),
}));

vi.mock("@/lib/codespace/julesApi", () => ({
  JULES_PERSONA: { id: "jules-ai-engineer", name: "Jules" },
  debugAndTroubleshoot: vi.fn(),
}));

vi.mock("@/components/codespace/ConsolePane", () => ({
  default: () => <div data-testid="console-pane" />,
}));

vi.mock("@/components/codespace/PreviewPane", () => ({
  default: () => <div data-testid="preview-pane" />,
}));

import Codespace from "./Codespace";

const SESSION = {
  path: ".sessions/keep.session.json",
  content: JSON.stringify({ kind: "anima-codespace-session", version: 1, files: [], agent_log: [] }),
};

function seedProject() {
  mocks.listProjects.mockResolvedValue([
    {
      id: "proj-1",
      files: [
        { path: "index.html", content: "<!doctype html><title>starter</title>" },
        { path: "styles.css", content: "body{}" },
        SESSION,
      ],
      active_path: "index.html",
      agent_log: [],
    },
  ]);
  mocks.listCharacters.mockResolvedValue([]);
  mocks.updateProject.mockResolvedValue({});
}

describe("Codespace upload + import", () => {
  beforeEach(() => {
    seedProject();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uploads local files into the explorer without dropping .sessions", async () => {
    render(<Codespace />);
    await waitFor(() => expect(screen.getAllByText("index.html").length).toBeGreaterThan(0));
    expect(screen.getByText("keep.session.json")).toBeTruthy();

    const input = document.querySelector('[data-testid="codespace-upload-files"]');
    expect(input).toBeTruthy();
    const file = new File(["console.log('woven')"], "hello.js", { type: "text/javascript" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getAllByText("hello.js").length).toBeGreaterThan(0));
    expect(screen.getAllByText("index.html").length).toBeGreaterThan(0);
    expect(screen.getByText("keep.session.json")).toBeTruthy();
  });

  it("imports a zip as the workspace while keeping session snapshots", async () => {
    render(<Codespace />);
    await waitFor(() => expect(screen.getAllByText("index.html").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /import repository/i }));
    expect(screen.getByText(/Import Repository/i)).toBeTruthy();

    const zip = buildStoreZip([
      { path: "demo-main/main.py", content: "print('hi')" },
      { path: "demo-main/lib/util.py", content: "x = 1" },
    ]);
    const zipFile = new File([zip], "demo.zip", { type: "application/zip" });
    const zipInput = document.querySelector('input[accept*=".zip"]');
    expect(zipInput).toBeTruthy();
    fireEvent.change(zipInput, { target: { files: [zipFile] } });

    await waitFor(() => expect(screen.getAllByText("main.py").length).toBeGreaterThan(0));
    expect(screen.getByText("lib/util.py")).toBeTruthy();
    expect(screen.queryByText("index.html")).toBeNull();
    expect(screen.getByText("keep.session.json")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy();
  });

  it("keeps the same import controls in repo mode", async () => {
    render(<Codespace isRepoMode />);
    await waitFor(() => expect(screen.getByText("// Repo Codespace")).toBeTruthy());
    expect(screen.getByRole("button", { name: /import repository/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /upload files/i })).toBeTruthy();
  });
});
