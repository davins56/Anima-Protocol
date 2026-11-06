import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/animaClient", () => {
  return {
    animaClient: {
      entities: {
        ChatSession: {
          create: vi.fn(),
        },
      },
    },
  };
});

import { animaClient } from "@/api/animaClient";
import { startTherapySession, pickDefaultAnima } from "./startTherapySession";

describe("pickDefaultAnima", () => {
  it("prefers the Anima assigned to the user", () => {
    const animas = [
      { id: "a1", name: "Nyx", assigned_user: "other@x.com" },
      { id: "a2", name: "Lumen", assigned_user: "me@x.com" },
    ];
    expect(pickDefaultAnima(animas, "me@x.com")?.id).toBe("a2");
  });

  it("falls back to the first Anima", () => {
    expect(pickDefaultAnima([{ id: "a1", name: "Nyx" }], "me@x.com")?.id).toBe("a1");
    expect(pickDefaultAnima([], "me@x.com")).toBeNull();
  });
});

describe("startTherapySession", () => {
  beforeEach(() => {
    animaClient.entities.ChatSession.create.mockReset();
    animaClient.entities.ChatSession.create.mockResolvedValue({ id: "sess-1" });
  });

  it("refuses to start without an Anima", async () => {
    await expect(startTherapySession({})).rejects.toThrow(/Choose your Anima/);
    expect(animaClient.entities.ChatSession.create).not.toHaveBeenCalled();
  });

  it("creates a solo therapy session with an opening from the Anima", async () => {
    const session = await startTherapySession({
      anima: { id: "anima-9", name: "Lumen" },
      userName: "Dav",
    });
    expect(session.id).toBe("sess-1");
    const payload = animaClient.entities.ChatSession.create.mock.calls[0][0];
    expect(payload.mode).toBe("solo");
    expect(payload.character_id).toBe("anima-9");
    expect(payload.therapy_mode).toBe(true);
    expect(payload.companion_mode).toBe("therapy");
    expect(payload.title).toBe("Therapy · Lumen");
    expect(payload.messages[0].role).toBe("assistant");
    expect(payload.messages[0].character_name).toBe("Lumen");
    expect(payload.messages[0].content).toMatch(/therapy mode/i);
    expect(payload.messages[0].content).toMatch(/988/);
    expect(payload.therapy_topic).toBeUndefined();
  });

  it("opens a topic-focused session when the user added a subject", async () => {
    await startTherapySession({
      anima: { id: "anima-9", name: "Lumen" },
      topic: "  Work burnout  ",
      topicId: "topic-3",
      topicNotes: "empty after 6pm",
    });
    const payload = animaClient.entities.ChatSession.create.mock.calls[0][0];
    expect(payload.title).toBe("Therapy · Work burnout");
    expect(payload.therapy_topic).toBe("Work burnout");
    expect(payload.therapy_topic_id).toBe("topic-3");
    expect(payload.therapy_topic_notes).toBe("empty after 6pm");
    expect(payload.messages[0].content).toContain("Work burnout");
    expect(payload.messages[0].content).toMatch(/go deeper/i);
  });
});
