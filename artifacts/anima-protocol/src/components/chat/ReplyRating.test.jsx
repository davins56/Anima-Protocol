import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReplyRating from "./ReplyRating";
import { buildRatingPayload } from "@/lib/replyRatings";

afterEach(cleanup);

describe("ReplyRating", () => {
  it("thumbs up sends 1 and toggles off with 0", async () => {
    const onRate = vi.fn().mockResolvedValue({});
    render(<ReplyRating onRate={onRate} />);
    fireEvent.click(screen.getByRole("button", { name: "Good reply" }));
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(1, undefined));
    fireEvent.click(screen.getByRole("button", { name: "Good reply" }));
    await waitFor(() => expect(onRate).toHaveBeenLastCalledWith(0, undefined));
  });
  it("thumbs down offers an optional better version", async () => {
    const onRate = vi.fn().mockResolvedValue({});
    render(<ReplyRating onRate={onRate} />);
    fireEvent.click(screen.getByRole("button", { name: "Not quite right" }));
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(-1, undefined));
    fireEvent.change(screen.getByLabelText("A better version (optional)"), { target: { value: "Tell me more." } });
    fireEvent.click(screen.getByRole("button", { name: "Save better version" }));
    await waitFor(() => expect(onRate).toHaveBeenLastCalledWith(-1, "Tell me more."));
  });
  it("reverts the pressed state when saving fails", async () => {
    const onRate = vi.fn().mockRejectedValue(new Error("offline"));
    render(<ReplyRating onRate={onRate} />);
    fireEvent.click(screen.getByRole("button", { name: "Good reply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Good reply" }).getAttribute("aria-pressed")).toBe("false"));
  });
});

describe("buildRatingPayload", () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "system", type: "ai_notice", content: "notice" },
    { role: "assistant", content: "Hello.", id: "m2", turn_id: "t1", character_name: "Scarlet" },
  ];
  it("captures reply, context and better version (thumbs down only)", () => {
    const p = buildRatingPayload({ session: { id: "s1" }, messages, index: 2, rating: -1, betterReply: "Hey you." });
    expect(p).toMatchObject({ session_id: "s1", message_id: "m2", turn_id: "t1", rating: -1, reply: "Hello.", better_reply: "Hey you.", character_name: "Scarlet" });
    expect(p.context).toEqual([{ role: "user", content: "hi" }]);
    expect(buildRatingPayload({ session: { id: "s1" }, messages, index: 2, rating: 1, betterReply: "x" }).better_reply).toBeUndefined();
    expect(buildRatingPayload({ session: { id: "s1" }, messages, index: 0, rating: 1 })).toBeNull();
  });
});
