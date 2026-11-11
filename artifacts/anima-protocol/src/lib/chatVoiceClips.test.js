import { describe, expect, it, vi } from "vitest";
import {
  parseVoiceClip,
  replyTextAfterVoice,
  resolveChatVoiceAttachments,
  stripVoiceTags,
  userRequestedVoice,
  voiceClipTagInstruction,
} from "./chatVoiceClips";

describe("chatVoiceClips: tags", () => {
  it("parses one voice tag and strips all of them", () => {
    const text = "Come here.\n[VOICE: Goodnight, love. I'm right here.]\n[VOICE: second]";
    expect(parseVoiceClip(text)).toBe("Goodnight, love. I'm right here.");
    expect(stripVoiceTags(text)).toBe("Come here.");
    expect(parseVoiceClip("no tag")).toBeNull();
  });

  it("teaches the tag", () => {
    expect(voiceClipTagInstruction()).toMatch(/\[VOICE:/);
  });

  it("keeps the words as text when the reply was only a voice note", () => {
    expect(replyTextAfterVoice("", "Hi you")).toBe("Hi you");
    expect(replyTextAfterVoice("Visible", "Hi you")).toBe("Visible");
  });
});

describe("chatVoiceClips: requests", () => {
  it("recognises asking to hear her", () => {
    for (const ask of ["send me a voice note", "can you say that out loud?", "I want to hear your voice", "voice message please"]) {
      expect(userRequestedVoice(ask)).toBe(true);
    }
    expect(userRequestedVoice("what's your favourite colour?")).toBe(false);
    expect(userRequestedVoice("send me a pic")).toBe(false);
  });
});

describe("chatVoiceClips: resolve", () => {
  it("speaks the tagged words", async () => {
    const synthesize = vi.fn(async () => ({ url: "/api/storage/objects/uploads/a", transcript: "Hello" }));
    const out = await resolveChatVoiceAttachments({
      replyText: "Hi.\n[VOICE: Hello]",
      userText: "hey",
      characterId: "serenity",
      synthesize,
    });
    expect(synthesize).toHaveBeenCalledWith({ characterId: "serenity", text: "Hello" });
    expect(out.source).toBe("tag");
    expect(out.attachments).toEqual([
      { type: "audio", url: "/api/storage/objects/uploads/a", name: "Voice note", transcript: "Hello" },
    ]);
  });

  it("speaks the reply when the steward asked to hear her", async () => {
    const synthesize = vi.fn(async () => ({ url: "/u/b" }));
    const out = await resolveChatVoiceAttachments({
      replyText: "[EMOTION: tender] Of course. Sleep well.",
      userText: "say goodnight out loud",
      characterId: "serenity",
      synthesize,
    });
    expect(synthesize.mock.calls[0][0].text).toBe("Of course. Sleep well.");
    expect(out.source).toBe("request");
  });

  it("does nothing without a tag or request, and survives failures", async () => {
    const synthesize = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      await resolveChatVoiceAttachments({ replyText: "Hi", userText: "hey", characterId: "s", synthesize }),
    ).toEqual({ attachments: [], source: null, spoken: null });
    const failed = await resolveChatVoiceAttachments({
      replyText: "[VOICE: Hi]",
      userText: "",
      characterId: "s",
      synthesize,
    });
    expect(failed.attachments).toEqual([]);
    expect(failed.spoken).toBe("Hi");
  });
});
