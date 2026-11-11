import { describe, expect, it } from "vitest";
import {
  alignIpaToWords,
  GAP_SIL_MS,
  graphemeUnits,
  heardTextFor,
  ipaUnits,
  tailSilence,
  wordsToVisemeCues,
} from "../src/lib/voice/visemes";
import { parseKokoroLine, kokoroVoiceFor, localVoiceEnabled } from "../src/lib/voice/localVoiceClient";
import { sampleOffsetFor, unavailableBody, VISEMES } from "../src/lib/voice/localContract";

function assertMonotonic(cues: { startMs: number; endMs: number }[]) {
  for (let i = 0; i < cues.length; i++) {
    expect(cues[i].endMs).toBeGreaterThan(cues[i].startMs);
    if (i) expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
  }
}

describe("IPA → viseme units", () => {
  it("maps vowels to the five VRM visemes", () => {
    expect(ipaUnits("ɑ").map((u) => u.viseme)).toEqual(["aa"]);
    expect(ipaUnits("ɪ").map((u) => u.viseme)).toEqual(["ih"]);
    expect(ipaUnits("u").map((u) => u.viseme)).toEqual(["ou"]);
    expect(ipaUnits("ɛ").map((u) => u.viseme)).toEqual(["ee"]);
    expect(ipaUnits("ɔ").map((u) => u.viseme)).toEqual(["oh"]);
  });
  it("reads misaki diphthong capitals (kˈOkəɹO = Kokoro)", () => {
    expect(ipaUnits("kˈOkəɹO").map((u) => u.viseme)).toEqual(["ih", "oh", "ih", "aa", "ou", "oh"]);
    expect(ipaUnits("hˈA").map((u) => u.viseme)).toEqual(["ih", "ee"]);
  });
  it("closes the lips on p/b/m and ignores stress marks and punctuation", () => {
    expect(ipaUnits("mˈʌm,").map((u) => u.viseme)).toEqual(["sil", "aa", "sil"]);
  });
  it("only ever emits the six contract visemes", () => {
    const all = [...ipaUnits("ðə kwˈɪk bɹˈWn fˈɑks ʤˈʌmpt ˈOvəɹ ðə lˈAzi dˈɔɡ"), ...graphemeUnits("Quick brown fox!")];
    for (const u of all) expect(VISEMES).toContain(u.viseme);
  });
  it("falls back to spelling when no IPA is available", () => {
    expect(graphemeUnits("mama").map((u) => u.viseme)).toEqual(["sil", "aa", "sil", "aa"]);
  });
});

describe("word timings → cues", () => {
  const words = [
    { word: "Hey", startMs: 0, endMs: 200 },
    { word: "you.", startMs: 200, endMs: 420 },
    { word: "Missed", startMs: 700, endMs: 1000 },
    { word: "you", startMs: 1020, endMs: 1200 },
  ];
  it("is monotonic, integer and non-overlapping", () => {
    const cues = wordsToVisemeCues(words, null);
    assertMonotonic(cues);
    for (const c of cues) {
      expect(Number.isInteger(c.startMs)).toBe(true);
      expect(Number.isInteger(c.endMs)).toBe(true);
    }
  });
  it(`adds sil for word gaps over ${GAP_SIL_MS} ms but not shorter ones`, () => {
    const cues = wordsToVisemeCues(words, null);
    // The gap sil may merge with the closed lips of "Missed" (m → sil).
    expect(cues.some((c) => c.viseme === "sil" && c.startMs <= 420 && c.endMs >= 700)).toBe(true);
    expect(cues.find((c) => c.viseme === "sil" && c.startMs === 1000)).toBeUndefined();
  });
  it("omits weight when it is 1 (default) and on sil", () => {
    const cues = wordsToVisemeCues([{ word: "a", startMs: 0, endMs: 100 }], ["ɑ"]);
    expect(cues).toEqual([{ viseme: "aa", startMs: 0, endMs: 100 }]);
    const sil = wordsToVisemeCues([{ word: "m", startMs: 0, endMs: 100 }], ["m"]);
    expect(sil[0]).toEqual({ viseme: "sil", startMs: 0, endMs: 100 });
  });
  it("respects a floor so cues never go backwards across chunks", () => {
    const cues = wordsToVisemeCues([{ word: "so", startMs: 50, endMs: 300 }], null, 120);
    expect(cues[0].startMs).toBeGreaterThanOrEqual(120);
    assertMonotonic(cues);
  });
  it("skips broken timings instead of emitting negative spans", () => {
    expect(wordsToVisemeCues([{ word: "x", startMs: 300, endMs: 100 }], null)).toEqual([]);
  });
  it("closes the mouth at the end of the window", () => {
    expect(tailSilence(900, 1240)).toEqual({ viseme: "sil", startMs: 900, endMs: 1240 });
    expect(tailSilence(1240, 1240)).toBeNull();
  });
});

describe("heard text and IPA alignment", () => {
  const words = [
    { word: "I", startMs: 0, endMs: 100 },
    { word: "missed", startMs: 100, endMs: 500 },
    { word: "you", startMs: 500, endMs: 800 },
    { word: ".", startMs: 800, endMs: 820 },
  ];
  it("counts a word once its midpoint was heard", () => {
    expect(heardTextFor(words, 299)).toBe("I");
    expect(heardTextFor(words, 300)).toBe("I missed");
    expect(heardTextFor(words, 5000)).toBe("I missed you.");
    expect(heardTextFor(words, 0)).toBe("");
  });
  it("aligns IPA words by spoken-word count", () => {
    expect(alignIpaToWords("ˈI mˈɪst jˈu", words)).toEqual(["ˈI", "mˈɪst", "jˈu", ""]);
    expect(alignIpaToWords("ˈI mˈɪst", words)).toBeNull();
  });
});

describe("home-box client helpers", () => {
  it("parses a Kokoro captioned line (seconds → ms)", () => {
    const pcm = Buffer.from([1, 0, 2, 0]).toString("base64");
    const c = parseKokoroLine(JSON.stringify({ audio: pcm, audio_format: "pcm", timestamps: [{ word: "Hi", start_time: 0.05, end_time: 0.3 }] }));
    expect(c?.pcm.length).toBe(4);
    expect(c?.words).toEqual([{ word: "Hi", startMs: 50, endMs: 300 }]);
    expect(parseKokoroLine("not json")).toBeNull();
  });
  it("uses the companion's saved Kokoro voice, else the default", () => {
    expect(kokoroVoiceFor({ kokoro_voice_id: "am_michael" }, {} as any)).toBe("am_michael");
    expect(kokoroVoiceFor({ kokoro_voice_id: "af_bella+af_sky" }, {} as any)).toBe("af_heart");
    expect(kokoroVoiceFor(null, { ANIMA_LOCAL_VOICE_DEFAULT: "bf_emma" } as any)).toBe("bf_emma");
  });
  it("is off without a box URL or when switched off", () => {
    expect(localVoiceEnabled({} as any)).toBe(false);
    expect(localVoiceEnabled({ ANIMA_LOCAL_VOICE_BASE_URL: "http://box" } as any)).toBe(true);
    expect(localVoiceEnabled({ ANIMA_LOCAL_VOICE_BASE_URL: "http://box", ANIMA_LOCAL_VOICE: "off" } as any)).toBe(false);
  });
  it("maps ms to 24 kHz samples and never offers a cloud fallback", () => {
    expect(sampleOffsetFor(1000)).toBe(24000);
    expect(sampleOffsetFor(12.5)).toBe(300);
    for (const r of ["box_unreachable", "model_loading", "disabled_by_user", "busy"] as const) {
      expect(unavailableBody(r)).toMatchObject({ reason: r, cloudFallback: false });
    }
  });
});
