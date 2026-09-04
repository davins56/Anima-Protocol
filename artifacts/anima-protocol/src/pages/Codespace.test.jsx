import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { JULES_PERSONA } from "@/lib/codespace/julesApi";

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

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: mocks.whenBootstrapReady,
}));

vi.mock("@/lib/codespace/sandbox", () => ({
  buildPreviewSrcdoc: () => "",
  isPreviewMessage: () => false,
  runScript: vi.fn(),
}));

vi.mock("@/components/codespace/ConsolePane", () => ({
  default: () => <div>console</div>,
}));

vi.mock("@/components/codespace/PreviewPane", () => ({
  default: () => <div>preview</div>,
}));

vi.mock("@/components/codespace/CodeEditor", () => ({
  default: () => <div>editor</div>,
}));

vi.mock("@/lib/codespace/useCodespaceAgent", () => ({
  useCodespaceAgent: ({ character }) => {
    mocks.agentCharacter.current = character;
    return { running: false, runGoal: vi.fn(), stop: vi.fn() };
  },
}));

import Codespace from "./Codespace";

const project = {
  id: "proj-1",
  files: [{ path: "index.html", content: "<h1>hi</h1>" }],
  active_path: "index.html",
  agent_log: [],
  companion_id: null,
};

function renderPage(path = "/codespace") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Codespace />
    </MemoryRouter>,
  );
}

describe("Codespace companion picker", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mocks.agentCharacter.current = null;
    mocks.whenBootstrapReady.mockResolvedValue(undefined);
    mocks.me.mockResolvedValue({ email: "operator@example.com" });
    mocks.listProject.mockResolvedValue([{ ...project }]);
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
    await waitFor(() => {
      expect(select.value).toBe("anima-1");
    });
    expect(screen.getByRole("option", { name: /Serenity \(Anima\)/ })).toBeTruthy();
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
      { ...project, companion_id: "anima-2" },
    ]);

    renderPage();

    const select = await screen.findByLabelText("Codespace companion");
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
