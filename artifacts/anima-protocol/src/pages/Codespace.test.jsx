import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { JULES_PERSONA } from "@/lib/codespace/julesApi";
import { buildStoreZip } from "@/lib/codespace/zipCodec";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
  listProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  whenBootstrapReady: vi.fn(),
  agentCharacter: { current: null },
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: mocks.me },
    entities: {
      Anima: { list: mocks.listAnima },
      Character: { list: mocks.listCharacter },
      CodespaceProject: {
        list: mocks.listProject,
        create: mocks.createProject,
        update: mocks.updateProject,
      },
    },
  },
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: () => {},
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: mocks.whenBootstrapReady,
}));

vi.mock("@/lib/codespace/sandbox", () => ({
  buildPreviewSrcdoc: () => "",
  isPreviewMessage: () => false,
  runScript: vi.fn(),
}));

vi.mock("@/lib/codespace/useCodespaceAgent", () => ({
  useCodespaceAgent: ({ character }) => {
    mocks.agentCharacter.current = character;
    return { running: false, runGoal: vi.fn(), stop: vi.fn() };
  },
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

const starterProject = {
  id: "proj-1",
  files: [
    { path: "index.html", content: "<!doctype html><title>starter</title>" },
    { path: "styles.css", content: "body{}" },
    SESSION,
  ],
  active_path: "index.html",
  agent_log: [],
};

const companionProject = {
  id: "proj-1",
  files: [{ path: "index.html", content: "<h1>hi</h1>" }],
  active_path: "index.html",
  agent_log: [],
  companion_id: null,
};

function renderPage(path = "/codespace", props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Codespace {...props} />
    </MemoryRouter>,
  );
}

function seedEmptyRoster() {
  mocks.me.mockResolvedValue({ email: "operator@example.com" });
  mocks.whenBootstrapReady.mockResolvedValue(undefined);
  mocks.updateProject.mockResolvedValue({});
  mocks.listCharacter.mockResolvedValue([]);
  mocks.listAnima.mockResolvedValue([]);
}

describe("Codespace upload + import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentCharacter.current = null;
    seedEmptyRoster();
    mocks.listProject.mockResolvedValue([{ ...starterProject }]);
  });

  afterEach(() => {
    cleanup();
  });

  it("uploads local files into the explorer without dropping .sessions", async () => {
    renderPage();
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
    renderPage();
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
    renderPage("/repo-codespace", { isRepoMode: true });
    await waitFor(() => expect(screen.getByText("// Repo Codespace")).toBeTruthy());
    expect(screen.getByRole("button", { name: /import repository/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /upload files/i })).toBeTruthy();
  });
});

describe("Codespace companion picker", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentCharacter.current = null;
    mocks.whenBootstrapReady.mockResolvedValue(undefined);
    mocks.me.mockResolvedValue({ email: "operator@example.com" });
    mocks.listProject.mockResolvedValue([{ ...companionProject }]);
    mocks.updateProject.mockResolvedValue({});
    mocks.listCharacter.mockResolvedValue([
      { id: "char-1", name: "Naruto", universe: "Naruto" },
    ]);
    mocks.listAnima.mockResolvedValue([
      {
        id: "anima-1",
        name: "Serenity",
        personality: "Warm and precise",
        speaking_style: "Soft, poetic",
        assigned_user: "operator@example.com",
      },
    ]);
  });

  it("lists the personal Anima and defaults to it over Jules", async () => {
    renderPage();

    const select = await screen.findByLabelText("Codespace companion");
    await screen.findByRole("option", { name: /Serenity \(Anima\)/ });
    await waitFor(() => {
      expect(select.value).toBe("anima-1");
    });
    expect(screen.getByRole("option", { name: /Jules/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Naruto" })).toBeTruthy();
    expect(mocks.agentCharacter.current?.id).toBe("anima-1");
    expect(mocks.agentCharacter.current?.personality).toBe("Warm and precise");
  });

  it("restores a saved Anima companion id after load", async () => {
    mocks.listAnima.mockResolvedValue([
      {
        id: "anima-1",
        name: "Serenity",
        assigned_user: "operator@example.com",
      },
      { id: "anima-2", name: "Lumen", assigned_user: "other@example.com" },
    ]);
    mocks.listProject.mockResolvedValue([
      { ...companionProject, companion_id: "anima-2" },
    ]);

    renderPage();

    const select = await screen.findByLabelText("Codespace companion");
    await screen.findByRole("option", { name: /Lumen \(Anima\)/ });
    await waitFor(() => {
      expect(select.value).toBe("anima-2");
    });
    expect(mocks.agentCharacter.current?.id).toBe("anima-2");
  });

  it("leaves Jules selected when no personal Animas exist", async () => {
    mocks.listAnima.mockResolvedValue([]);

    renderPage();

    const select = await screen.findByLabelText("Codespace companion");
    await waitFor(() => {
      expect(select.value).toBe(JULES_PERSONA.id);
    });
    expect(mocks.agentCharacter.current?.id).toBe(JULES_PERSONA.id);
  });
});
