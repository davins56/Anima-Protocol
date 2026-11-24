import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LocalVoiceBar from "./LocalVoiceBar";

function voice(over: Record<string, unknown> = {}) {
  return {
    uiState: "online",
    status: { state: "online" },
    offlineText: null,
    notice: null,
    speaking: false,
    recording: false,
    transcribing: false,
    refresh: vi.fn(async () => null),
    speak: vi.fn(),
    stop: vi.fn(),
    startTalking: vi.fn(async () => {}),
    finishTalking: vi.fn(async () => "hello"),
    cancelTalking: vi.fn(async () => {}),
    ...over,
  } as never;
}

describe("LocalVoiceBar", () => {
  it("shows a clear offline, text-only state and disables push-to-talk", () => {
    const v = voice({
      uiState: "offline",
      status: { state: "offline", reason: "box_unreachable" },
      offlineText: "Her voice is offline. Your home voice server isn't reachable.",
    });
    render(<LocalVoiceBar voice={v} characterId="c1" onTranscript={vi.fn()} />);
    expect(screen.getByTestId("local-voice-offline").textContent).toContain("No cloud voice is used");
    expect((screen.getByTestId("local-voice-ptt") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Check the voice server again"));
    expect((v as unknown as { refresh: ReturnType<typeof vi.fn> }).refresh).toHaveBeenCalledWith(true);
  });

  it("hold to talk records, release sends the transcript", async () => {
    const onTranscript = vi.fn();
    const v = voice();
    render(<LocalVoiceBar voice={v} characterId="c1" onTranscript={onTranscript} />);
    const btn = screen.getByTestId("local-voice-ptt");
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hello"));
    const hooks = v as unknown as { startTalking: ReturnType<typeof vi.fn>; finishTalking: ReturnType<typeof vi.fn> };
    expect(hooks.startTalking).toHaveBeenCalled();
    expect(hooks.finishTalking).toHaveBeenCalledWith("c1");
  });

  it("offers Stop while she speaks", () => {
    const v = voice({ speaking: true });
    render(<LocalVoiceBar voice={v} characterId="c1" onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByTestId("local-voice-stop"));
    expect((v as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalledWith("user_stop");
  });
});
