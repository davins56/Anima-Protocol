import { describe, expect, it, beforeEach } from "vitest";
import {
  ChatTurnFlightElsewhere,
  isChatTurnFlightElsewhere,
  reserveChatTurnFlight,
  resetChatTurnFlightsForTests,
} from "../src/lib/chatTurnFlight";

describe("reserveChatTurnFlight", () => {
  beforeEach(() => {
    resetChatTurnFlightsForTests();
  });

  it("joins the same promise so a second start does not run the work", async () => {
    let runs = 0;
    const owner = reserveChatTurnFlight("turn_join", "Hello");
    const work = (async () => {
      runs += 1;
      return { content: "once", done: { done: true } };
    })();
    const joiner = reserveChatTurnFlight("turn_join", "Hello");
    expect(joiner.joined).toBe(true);
    expect(owner.joined).toBe(false);
    owner.resolve(await work);
    await expect(joiner.result).resolves.toMatchObject({ content: "once" });
    expect(runs).toBe(1);
  });

  it("does not join a different user line", () => {
    reserveChatTurnFlight("turn_mismatch", "Hello");
    const other = reserveChatTurnFlight("turn_mismatch", "Different");
    expect(other.joined).toBe(false);
    expect(other.mismatched).toBe(true);
  });

  it("abandon rejects joiners with turn_in_flight", async () => {
    const owner = reserveChatTurnFlight("turn_abandon", "Hello");
    const joiner = reserveChatTurnFlight("turn_abandon", "Hello");
    owner.abandon();
    const err = await joiner.result.then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(ChatTurnFlightElsewhere);
    expect(isChatTurnFlightElsewhere(err)).toBe(true);
  });
});
