import { describe, it, expect } from "vitest";
import {
  THERAPY_TOPIC_TITLE_MAX,
  THERAPY_TOPIC_NOTES_MAX,
  normalizeTherapyTopic,
  therapySessionTitle,
  buildTherapyTopicFocus,
  therapyFocusHaystack,
} from "./therapyTopics";

describe("normalizeTherapyTopic", () => {
  it("trims and collapses whitespace", () => {
    expect(
      normalizeTherapyTopic({ title: "  work   burnout  ", notes: "empty\n\nafter  six" }),
    ).toEqual({ title: "work burnout", notes: "empty after six" });
  });

  it("caps title and notes length", () => {
    const long = "x".repeat(THERAPY_TOPIC_TITLE_MAX + 40);
    const notes = "y".repeat(THERAPY_TOPIC_NOTES_MAX + 20);
    const out = normalizeTherapyTopic({ title: long, notes });
    expect(out.title).toHaveLength(THERAPY_TOPIC_TITLE_MAX);
    expect(out.notes).toHaveLength(THERAPY_TOPIC_NOTES_MAX);
  });

  it("returns empty strings when nothing is provided", () => {
    expect(normalizeTherapyTopic()).toEqual({ title: "", notes: "" });
  });
});

describe("therapySessionTitle", () => {
  it("prefers the topic when present", () => {
    expect(therapySessionTitle({ animaName: "Lumen", topicTitle: "Grief" })).toBe(
      "Therapy · Grief",
    );
  });

  it("falls back to the Anima name", () => {
    expect(therapySessionTitle({ animaName: "Lumen" })).toBe("Therapy · Lumen");
    expect(therapySessionTitle({})).toBe("Therapy · Anima");
  });
});

describe("buildTherapyTopicFocus", () => {
  it("returns empty when there is no topic", () => {
    expect(buildTherapyTopicFocus({})).toBe("");
  });

  it("asks the Anima to stay with the named subject", () => {
    const block = buildTherapyTopicFocus({
      topic: "Work burnout",
      notes: "empty after 6pm",
    });
    expect(block).toMatch(/DEPTH FOCUS/);
    expect(block).toContain("Work burnout");
    expect(block).toContain("empty after 6pm");
    expect(block).toMatch(/Prefer depth over breadth/);
  });
});

describe("therapyFocusHaystack", () => {
  it("joins topic, notes, and the latest user message", () => {
    expect(
      therapyFocusHaystack({
        topic: "Anxiety",
        notes: "meetings",
        userMessage: "it spiked today",
      }),
    ).toBe("Anxiety\nmeetings\nit spiked today");
  });
});
