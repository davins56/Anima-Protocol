import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CompanionGenerator from "./CompanionGenerator";

const { invoke, create, navigate } = vi.hoisted(() => ({ invoke: vi.fn(), create: vi.fn(), navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/animaClient", () => ({ animaClient: { functions: { invoke } }, uploadDataUrl: vi.fn() }));
vi.mock("@/lib/createCompanion", () => ({ createCompanionRecord: create, companionCreateErrorMessage: (e) => e.message }));
vi.mock("@/lib/seedCharacters", () => ({ autoAssignCharacterPhoto: vi.fn(), shouldAutoAssignCharacterPhoto: () => false }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/createInitSession", () => ({ startSoloCompanionChatSession: vi.fn().mockResolvedValue(null), isUsableSessionId: () => false }));
vi.mock("@/components/anima/AvatarUploadField", () => ({ default: () => null }));

const research = { status: "sources_found", version: "original novels", sources: [{ title: "Holmes source", url: "https://example.org/holmes", snippet: "A consulting detective." }] };
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ success: true, companion: { name: "Sherlock Holmes", personality: "Analytical", research } });
  create.mockResolvedValue({ id: "c1", name: "Sherlock Holmes" });
});
afterEach(cleanup);

describe("character setup research", () => {
  it("researches the requested adaptation, shows sources, and saves the evidence with the profile", async () => {
    render(<CompanionGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Name a real character/), { target: { value: "Sherlock Holmes" } });
    fireEvent.change(screen.getByLabelText(/Version or adaptation/), { target: { value: "original novels" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Companion" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("generateCompanionFromPrompt", { prompt: "Sherlock Holmes", research_online: true, canon_version: "original novels" }));
    expect((await screen.findByRole("link", { name: "Holmes source" })).getAttribute("href")).toBe("https://example.org/holmes");
    fireEvent.click(screen.getByRole("button", { name: /Add to Companions/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Character", expect.objectContaining({ canon_research: research, personality: "Analytical" })));
  });

  it("lets original characters skip research and labels the draft accordingly", async () => {
    invoke.mockResolvedValue({ success: true, companion: { name: "Nova", research: { status: "skipped", sources: [] } } });
    render(<CompanionGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Name a real character/), { target: { value: "Nova" } });
    fireEvent.click(screen.getByLabelText("Research character portrayal online"));
    fireEvent.click(screen.getByRole("button", { name: "Generate Companion" }));
    expect(await screen.findByText("Online research off. Created from your description.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("generateCompanionFromPrompt", expect.objectContaining({ research_online: false }));
  });

  it("shows an unverified-draft message when the search fails", async () => {
    invoke.mockResolvedValue({ success: true, companion: { name: "Holmes", research: { status: "unavailable", sources: [] } } });
    render(<CompanionGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Name a real character/), { target: { value: "Holmes" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Companion" }));
    expect(await screen.findByText(/This is an unverified draft/)).toBeTruthy();
    expect(screen.queryByText(/Sources found/)).toBeNull();
  });
});
