import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("./MessageBubble", () => ({
  default: ({ message }) => <div data-testid="bubble">{message.content}</div>,
}));
vi.mock("./SystemDisclosure", () => ({ default: () => null }));

import MessageList from "./MessageList";
import { SITUATIONAL_SCENE_OFF, SituationalSceneContext } from "./SituationalSceneContext";
import { chatHistoryForLlm, messagesForModel } from "@/lib/aiCompanionNotice";
import { sceneFixtures } from "@/lib/situationalScene.fixtures";

const F = sceneFixtures();
const names = { c_nat: "Natasha", c_ser: "Serenity", c_scarlet: "Scarlet" };
const ON = { enabled: true, narrator: false, nameOf: (id) => names[id] || "Someone" };
const session = { id: "s_group", mode: "group", group_character_ids: ["c_nat", "c_ser", "c_scarlet"] };

function list(messages, value) {
  const tree = <MessageList messages={messages} session={session} characters={[]} />;
  return render(value ? <SituationalSceneContext.Provider value={value}>{tree}</SituationalSceneContext.Provider> : tree).container;
}

describe("scene event rows (#763 B3/B4)", () => {
  it("render as scene lines, not bubbles, with no actions", () => {
    const c = list([F.rows.user_heard_by_two, F.rows.event_exit], ON);
    const evt = c.querySelector('[data-testid="scene-event"]');
    expect(evt.textContent).toContain("Scarlet slips away toward the archive.");
    expect(evt.dataset.sceneKind).toBe("exit");
    expect(evt.querySelector("button")).toBeNull();
    expect([...c.querySelectorAll('[data-testid="bubble"]')].map((b) => b.textContent)).toEqual(["Is anyone still up?"]);
  });

  it("narration uses the narrator style; enter/exit do too when the scene narrator is on", () => {
    const off = list([F.rows.event_narration, F.rows.event_enter], ON);
    const kinds = [...off.querySelectorAll('[data-testid="scene-event"]')].map((e) => e.getAttribute("aria-label"));
    expect(kinds).toEqual(["Scene narration", "Scene change"]);
    const on = list([F.rows.event_enter], { ...ON, narrator: true });
    expect(on.querySelector('[data-testid="scene-event"]').getAttribute("aria-label")).toBe("Scene narration");
  });
});

describe("heard_by captions come only from the server stamp", () => {
  it("shows the stamp; legacy rows show nothing; [] says no one", () => {
    const c = list([F.rows.assistant_legacy, F.rows.user_heard_by_two, F.rows.user_heard_by_nobody], ON);
    expect([...c.querySelectorAll('[data-testid="heard-by"]')].map((n) => n.textContent)).toEqual([
      "Heard by Natasha, Serenity",
      "Heard by no one",
    ]);
  });
});

describe("flag-off parity", () => {
  it("MessageList renders identically with no provider and with the off value", () => {
    const rows = [F.rows.assistant_legacy, F.rows.user_heard_by_two, F.rows.user_heard_by_nobody];
    expect(list(rows, SITUATIONAL_SCENE_OFF).innerHTML).toBe(list(rows).innerHTML);
    expect(list(rows).querySelector('[data-testid="heard-by"]')).toBeNull();
  });

  it("model history is byte-identical when there are no event rows", () => {
    const rows = [
      { role: "user", content: "hi" },
      { role: "assistant", character_name: "Natasha", content: "hey" },
      { role: "system", content: "notice" },
    ];
    const legacy = messagesForModel(rows)
      .slice(-14)
      .map((m) => `${m.role === "user" ? "You" : m.character_name || "Character"}: ${m.content}`)
      .join("\n");
    expect(chatHistoryForLlm(rows)).toBe(legacy);
  });

  it("event rows become short stage directions and never a speaker line", () => {
    const text = chatHistoryForLlm([F.rows.user_heard_by_two, F.rows.event_exit]);
    expect(text).toBe("You: Is anyone still up?\n[Scene: Scarlet slips away toward the archive.]");
    expect(messagesForModel([F.rows.event_exit])).toEqual([]);
  });
});
