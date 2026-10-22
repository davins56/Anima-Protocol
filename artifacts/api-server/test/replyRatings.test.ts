import { describe, expect, it } from "vitest";
import { pairsToPreferenceExport, pairsToTutorDpoJsonl, parseRatingInput, RatingInputError, ratingsToPairs, type RatingRow } from "../src/lib/replyRatings";

const ctx = [{ role: "user" as const, content: "I had a rough day." }];
const row = (o: Partial<RatingRow>): RatingRow => ({ id: "r", user_id: "u", session_id: "s", message_id: "m", turn_id: "t1", character_id: "c", character_name: "Aeland", rating: 1, reply: "I'm here.", better_reply: null, context: ctx, created_at: "2026-10-22T00:00:00Z", ...o });

describe("reply ratings", () => {
  it("validates input and only keeps a better version on thumbs down", () => {
    expect(() => parseRatingInput({ rating: 2, session_id: "s", message_id: "m", reply: "x" })).toThrow(RatingInputError);
    expect(() => parseRatingInput({ rating: 1, session_id: "s", message_id: "m", reply: "" })).toThrow(RatingInputError);
    expect(parseRatingInput({ rating: 1, session_id: "s", message_id: "m", reply: "x", better_reply: "y" }).better_reply).toBeNull();
    const down = parseRatingInput({ rating: -1, session_id: "s", message_id: "m", reply: "x", better_reply: "y", context: [{ role: "system", content: "no" }, ...ctx] });
    expect(down.better_reply).toBe("y");
    expect(down.context).toEqual(ctx);
  });
  it("builds chosen/rejected pairs", () => {
    const pairs = ratingsToPairs([
      row({ rating: -1, reply: "Cheer up!", better_reply: "That sounds heavy. Tell me." }),
      row({ message_id: "a", turn_id: "t2", rating: 1, reply: "A" }),
      row({ message_id: "b", turn_id: "t2", rating: -1, reply: "B" }),
      row({ message_id: "c", turn_id: "t3", rating: 1, reply: "solo up" }),
    ]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chosen: "That sounds heavy. Tell me.", rejected: "Cheer up!", source: "better_version" }),
        expect.objectContaining({ chosen: "A", rejected: "B", source: "thumbs_pair" }),
        expect.objectContaining({ chosen: "solo up", rejected: null, source: "thumbs_up" }),
      ]),
    );
  });
  it("exports llm PreferencePairExport and modelTutor DPO shapes", () => {
    const pairs = ratingsToPairs([row({ rating: -1, reply: "Cheer up!", better_reply: "Tell me." }), row({ turn_id: "t9", message_id: "z", reply: "up only" })]);
    const prefs = pairsToPreferenceExport(pairs);
    expect(prefs).toEqual([{ prompt: "user: I had a rough day.", chosen: "Tell me.", rejected: "Cheer up!", system: "You are Aeland." }]);
    const lines = pairsToTutorDpoJsonl(pairs).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines).toEqual([{ prompt_messages: [{ role: "user", content: "I had a rough day." }], chosen: "Tell me.", rejected: "Cheer up!" }]);
  });
});
