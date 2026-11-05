import { describe, expect, it } from "vitest";
import {
  chooseOutreachMedia,
  outreachMediaConfig,
  outreachPhotoPrompt,
  preferredMedia,
  pushTitleFor,
  type OutreachMediaInput,
} from "../src/lib/media/outreachMediaCore";
import { cleanSpokenText, pickVoiceProvider, xaiTtsBody } from "../src/lib/media/voiceClipCore";

const cfg = outreachMediaConfig({});

function input(over: Partial<OutreachMediaInput> = {}): OutreachMediaInput {
  return {
    situation: "lull",
    intent: "check_in",
    usedToday: { photo: 0, voice: 0 },
    available: { photo: true, voice: true },
    roll: 0.1,
    pickRoll: 0.9,
    ...over,
  };
}

describe("outreach media: config", () => {
  it("is occasional and capped by default", () => {
    expect(cfg).toEqual({ chance: 0.35, photoCap: 2, voiceCap: 3 });
  });

  it("clamps env", () => {
    expect(outreachMediaConfig({ ANIMA_OUTREACH_MEDIA_CHANCE: "4", ANIMA_OUTREACH_PHOTO_DAILY_CAP: "-1" })).toEqual({
      chance: 1,
      photoCap: 0,
      voiceCap: 3,
    });
  });
});

describe("outreach media: choice", () => {
  it("sends text most of the time", () => {
    expect(chooseOutreachMedia(input({ roll: 0.5 }), cfg)).toBeNull();
  });

  it("prefers a photo for a warm check-in", () => {
    expect(chooseOutreachMedia(input(), cfg)).toBe("photo");
    expect(chooseOutreachMedia(input({ pickRoll: 0.1 }), cfg)).toBe("voice");
  });

  it("prefers a voice note for care or after a storm", () => {
    expect(preferredMedia("care_need", "check_in")).toEqual(["voice"]);
    expect(preferredMedia("storm", "check_in")).toEqual(["voice"]);
    expect(chooseOutreachMedia(input({ situation: "care_need" }), cfg)).toBe("voice");
  });

  it("prefers a voice note when following up a thread", () => {
    expect(chooseOutreachMedia(input({ situation: "thread_due", intent: "follow_up_thread" }), cfg)).toBe("voice");
  });

  it("respects daily caps", () => {
    expect(chooseOutreachMedia(input({ usedToday: { photo: 2, voice: 0 } }), cfg)).toBe("voice");
    expect(chooseOutreachMedia(input({ usedToday: { photo: 2, voice: 3 } }), cfg)).toBeNull();
    expect(chooseOutreachMedia(input({ situation: "care_need", usedToday: { photo: 0, voice: 3 } }), cfg)).toBeNull();
  });

  it("only uses what is configured", () => {
    expect(chooseOutreachMedia(input({ available: { photo: false, voice: true } }), cfg)).toBe("voice");
    expect(chooseOutreachMedia(input({ available: { photo: false, voice: false } }), cfg)).toBeNull();
  });
});

describe("outreach media: copy", () => {
  it("builds a safe, grounded photo prompt", () => {
    const p = outreachPhotoPrompt("Serenity", 'Thinking of you "tonight".');
    expect(p).toContain("selfie of Serenity");
    expect(p).toContain("Thinking of you 'tonight'.");
    expect(p).toContain("safe for a lock screen");
  });

  it("titles the push by medium", () => {
    expect(pushTitleFor("Serenity", "photo")).toBe("Serenity sent you a photo");
    expect(pushTitleFor("Serenity", "voice")).toBe("Serenity sent you a voice note");
    expect(pushTitleFor("Serenity", null)).toBe("Serenity sent you a message");
  });
});

describe("voice clips: spoken text", () => {
  it("drops tags, stage directions, markdown and links", () => {
    expect(cleanSpokenText("[EMOTION: tender] *smiles softly* Hey **you**. See https://x.y/z ok")).toBe(
      "Hey you. See ok",
    );
  });

  it("caps long text at a sentence boundary", () => {
    const long = "This is one sentence. ".repeat(40);
    const out = cleanSpokenText(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".")).toBe(true);
  });

  it("returns empty for nothing speakable", () => {
    expect(cleanSpokenText("[IMAGE: a cliff] *waves*")).toBe("");
    expect(cleanSpokenText(null)).toBe("");
  });
});

describe("voice clips: provider", () => {
  it("uses her saved voice on xAI, ElevenLabs as fallback", () => {
    expect(pickVoiceProvider({ xai: true, elevenlabs: true })).toBe("xai");
    expect(pickVoiceProvider({ xai: false, elevenlabs: true })).toBe("elevenlabs");
    expect(pickVoiceProvider({ xai: false, elevenlabs: false })).toBeNull();
  });

  it("sends her cloned voice and settings to xAI", () => {
    const body = xaiTtsBody(
      { voice_id: "vc_serenity", language: "en", settings: { speed: 0.9, replace: { Zanel: "Zah-nyel" } } },
      "Hello",
      "eve",
    );
    expect(body).toEqual({
      text: "Hello",
      voice_id: "vc_serenity",
      language: "en",
      output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 64000 },
      speed: 0.9,
      replace: { Zanel: "Zah-nyel" },
    });
  });

  it("falls back to the default voice when none is saved", () => {
    const body = xaiTtsBody(null, "Hi", "eve");
    expect(body.voice_id).toBe("eve");
    expect(body.language).toBe("auto");
    expect("speed" in body).toBe(false);
  });
});
