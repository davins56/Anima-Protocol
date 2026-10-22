import { describe, expect, it } from "vitest";
import { isVoiceAgentEnabled, voiceModel, wavDurationSeconds } from "../src/lib/voice/xaiVoiceClient";
import { composeVoiceInstructions, VOICE_TOOLS } from "../src/lib/voice/sessionConfig";
import { sanitizeVoiceSettings } from "../src/lib/voice/voiceStore";

function wav(seconds: number, rate = 24000): Uint8Array {
  const dataLen = seconds * rate * 2;
  const b = new Uint8Array(44 + 16);
  const dv = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, dataLen, true);
  return b;
}

describe("voice agent", () => {
  it("is opt-in: needs both XAI_API_KEY and ANIMA_VOICE_AGENT=xai", () => {
    expect(isVoiceAgentEnabled({ XAI_API_KEY: "k" } as any)).toBe(false);
    expect(isVoiceAgentEnabled({ ANIMA_VOICE_AGENT: "xai" } as any)).toBe(false);
    expect(isVoiceAgentEnabled({ XAI_API_KEY: "k", ANIMA_VOICE_AGENT: "xai" } as any)).toBe(true);
  });
  it("pins documented models only", () => {
    expect(voiceModel({} as any)).toBe("grok-voice-latest");
    expect(voiceModel({ ANIMA_VOICE_MODEL: "grok-voice-3.0" } as any)).toBe("grok-voice-3.0");
    expect(voiceModel({ ANIMA_VOICE_MODEL: "evil model" } as any)).toBe("grok-voice-latest");
  });
  it("reads WAV duration for the 120 s clone limit", () => {
    expect(wavDurationSeconds(wav(90))).toBeCloseTo(90);
    expect(wavDurationSeconds(new Uint8Array(10))).toBeNull();
  });
  it("builds spoken-style instructions with memory and the four tools", () => {
    const s = composeVoiceInstructions({ name: "Serenity", personality: "warm" }, "- we met at the lake");
    expect(s).toContain("You are Serenity");
    expect(s).toContain("we met at the lake");
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual(["recall_memories", "open_resonance_node", "generate_photo", "show_vessel_view"]);
  });
  it("clamps voice settings", () => {
    expect(sanitizeVoiceSettings({ speed: 3, reasoning_effort: "max", replace: { Aelindra: "Ay-lin-dra", "<x>": "y" } })).toEqual({
      speed: 1.5,
      replace: { Aelindra: "Ay-lin-dra" },
    });
  });
});
