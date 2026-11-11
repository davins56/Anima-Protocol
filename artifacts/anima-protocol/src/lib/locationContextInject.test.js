import { describe, expect, it, vi } from "vitest";
import { scheduleLocationContextInject } from "./locationContextInject";

describe("scheduleLocationContextInject", () => {
  it("chat send does not wait on injectLocationContext", async () => {
    const invoke = vi.fn(() => new Promise(() => {}));
    const args = {
      messageCount: 5,
      sessionId: "sess-1",
      character: { id: "char-1", name: "Serenity" },
    };

    const send = async () => {
      // Same order as Chat.jsx: schedule location flavor, then request the reply.
      // Awaiting the scheduler must not observe the in-flight invoke.
      await scheduleLocationContextInject(invoke, args);
      return "companion-reply";
    };

    const reply = await Promise.race([
      send(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("send waited on location context")),
          500,
        );
      }),
    ]);

    expect(reply).toBe("companion-reply");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("injectLocationContext", {
      session_id: "sess-1",
      character_id: "char-1",
      character_name: "Serenity",
    });
  });

  it("does not invoke location context off the fifth-message cadence", () => {
    const invoke = vi.fn();
    scheduleLocationContextInject(invoke, {
      messageCount: 4,
      sessionId: "sess-1",
      character: { id: "char-1", name: "Serenity" },
    });
    scheduleLocationContextInject(invoke, {
      messageCount: 5,
      sessionId: "sess-1",
      character: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
