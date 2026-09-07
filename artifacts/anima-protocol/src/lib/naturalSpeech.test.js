import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SACRED_SPACE_SPEECH,
  CHAT_SPEECH,
  chunkSpeechText,
  inferCompanionVoiceGender,
  resolveSpeechSettings,
  scoreSpeechVoice,
  selectNaturalVoice,
  speakNaturally,
  stripSpeechMarkup,
} from "./naturalSpeech";

function voice(name, lang, extras = {}) {
  return { name, lang, localService: true, default: false, ...extras };
}

describe("stripSpeechMarkup", () => {
  it("drops stage directions and markdown so they are not spoken", () => {
    expect(stripSpeechMarkup("*wings unfurl* Breathe with me.")).toBe("Breathe with me.");
    expect(stripSpeechMarkup("**Stay.** I am here.")).toBe("Stay. I am here.");
    expect(stripSpeechMarkup("See [this](https://x.test) now.")).toBe("See this now.");
  });
});

describe("chunkSpeechText", () => {
  it("splits companion replies on sentence boundaries", () => {
    expect(
      chunkSpeechText("Welcome. Breathe with me. Feel the space settle."),
    ).toEqual(["Welcome.", "Breathe with me.", "Feel the space settle."]);
  });

  it("breaks a long sentence on a clause so one utterance is not a wall of text", () => {
    const long =
      "Come sit with me in this quiet room, and let the day fall away from your shoulders as we breathe together in the low light.";
    const chunks = chunkSpeechText(long, { maxLen: 80 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
    expect(chunks.join(" ")).toContain("Come sit with me");
  });

  it("returns an empty list for blank or markup-only text", () => {
    expect(chunkSpeechText("   ")).toEqual([]);
    expect(chunkSpeechText("*only a gesture*")).toEqual([]);
  });
});

describe("inferCompanionVoiceGender", () => {
  it("uses an explicit gender field when present", () => {
    expect(inferCompanionVoiceGender({ gender: "male" })).toBe("masculine");
    expect(inferCompanionVoiceGender({ voice_gender: "feminine" })).toBe("feminine");
  });

  it("reads pronouns from personality when no gender field exists", () => {
    expect(
      inferCompanionVoiceGender({
        name: "Korra",
        personality: "She leads with her heart. Her courage is loud.",
      }),
    ).toBe("feminine");
    expect(
      inferCompanionVoiceGender({
        name: "Mako",
        personality: "He is guarded. His voice stays low.",
      }),
    ).toBe("masculine");
  });

  it("defaults to feminine for Anima / unknown companions", () => {
    expect(inferCompanionVoiceGender(null)).toBe("feminine");
    expect(inferCompanionVoiceGender({ name: "Serenity" })).toBe("feminine");
  });
});

describe("selectNaturalVoice", () => {
  const voices = [
    voice("eSpeak Compact", "en-US"),
    voice("Microsoft David Desktop", "en-US"),
    voice("Google UK English Male", "en-GB"),
    voice("Microsoft Aria Online (Natural)", "en-US", { localService: false }),
    voice("Microsoft Guy Online (Natural)", "en-US", { localService: false }),
    voice("Samantha", "en-US"),
    voice("Zarvox", "en-US"),
    voice("Google Deutsch", "de-DE"),
  ];

  it("prefers a neural / premium English voice over compact or novelty voices", () => {
    const picked = selectNaturalVoice(voices, { gender: "feminine" });
    expect(picked?.name).toBe("Microsoft Aria Online (Natural)");
  });

  it("matches masculine timbre when the companion is male", () => {
    const picked = selectNaturalVoice(voices, {
      companion: { gender: "male", name: "Mako" },
    });
    expect(picked?.name).toBe("Microsoft Guy Online (Natural)");
  });

  it("scores compact / novelty voices below natural English voices", () => {
    const aria = scoreSpeechVoice(voice("Microsoft Aria Online (Natural)", "en-US", { localService: false }), {
      gender: "feminine",
    });
    const compact = scoreSpeechVoice(voice("eSpeak Compact", "en-US"), { gender: "feminine" });
    const novelty = scoreSpeechVoice(voice("Zarvox", "en-US"), { gender: "feminine" });
    expect(aria).toBeGreaterThan(compact);
    expect(aria).toBeGreaterThan(novelty);
  });

  it("returns null when no voices are available", () => {
    expect(selectNaturalVoice([])).toBeNull();
  });
});

describe("resolveSpeechSettings", () => {
  it("uses calm meditation defaults slower than chat TTS", () => {
    const settings = resolveSpeechSettings({ gender: "feminine" });
    expect(settings.rate).toBe(SACRED_SPACE_SPEECH.rate);
    expect(settings.rate).toBeLessThan(CHAT_SPEECH.rate);
    expect(settings.rate).toBeGreaterThanOrEqual(0.7);
    expect(settings.rate).toBeLessThanOrEqual(1.15);
    expect(settings.pitch).toBeGreaterThanOrEqual(0.85);
    expect(settings.pitch).toBeLessThanOrEqual(1.15);
    expect(settings.volume).toBe(SACRED_SPACE_SPEECH.volume);
    expect(settings.pauseMs).toBe(SACRED_SPACE_SPEECH.pauseMs);
  });

  it("lowers pitch slightly for masculine companions without cartoon extremes", () => {
    const fem = resolveSpeechSettings({ gender: "feminine" });
    const masc = resolveSpeechSettings({ gender: "masculine" });
    expect(masc.pitch).toBeLessThan(fem.pitch);
    expect(masc.pitch).toBeGreaterThanOrEqual(0.85);
  });
});

describe("speakNaturally", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues one utterance per sentence with meditation rate and the chosen voice", () => {
    vi.useFakeTimers();
    const spoken = [];
    const synth = {
      cancel: vi.fn(),
      speak: vi.fn((utterance) => {
        spoken.push(utterance);
      }),
      getVoices: () => [
        voice("eSpeak Compact", "en-US"),
        voice("Microsoft Aria Online (Natural)", "en-US", { localService: false }),
      ],
    };
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.voice = null;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.lang = "";
        this.onend = null;
        this.onerror = null;
      }
    }

    const onStart = vi.fn();
    const onEnd = vi.fn();
    const result = speakNaturally("Welcome. Breathe with me.", {
      synth,
      Utterance: FakeUtterance,
      companion: { name: "Serenity", gender: "female" },
      onStart,
      onEnd,
    });

    expect(result.chunks).toEqual(["Welcome.", "Breathe with me."]);
    expect(result.voice?.name).toBe("Microsoft Aria Online (Natural)");
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Welcome.");
    expect(spoken[0].rate).toBe(SACRED_SPACE_SPEECH.rate);
    expect(spoken[0].volume).toBe(SACRED_SPACE_SPEECH.volume);
    expect(spoken[0].voice.name).toBe("Microsoft Aria Online (Natural)");
    expect(onStart).toHaveBeenCalledTimes(1);

    spoken[0].onend();
    expect(spoken).toHaveLength(1);
    vi.advanceTimersByTime(SACRED_SPACE_SPEECH.pauseMs);
    expect(spoken).toHaveLength(2);
    expect(spoken[1].text).toBe("Breathe with me.");
    spoken[1].onend();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("cancel stops the queue and does not speak remaining chunks", () => {
    const synth = {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: () => [voice("Samantha", "en-US")],
    };
    class FakeUtterance {
      constructor(text) {
        this.text = text;
      }
    }
    const ctrl = speakNaturally("One. Two. Three.", {
      synth,
      Utterance: FakeUtterance,
    });
    ctrl.cancel();
    expect(synth.cancel).toHaveBeenCalled();
  });
});
