import { describe, expect, it, vi } from "vitest";
import { STORE_TOPIC_CREATE_TIMEOUT_MS } from "./storeTimeouts";
import {
  PENDING_THERAPY_TOPIC_MS,
  THERAPY_TOPIC_SAVE_FALLBACK,
  createTherapyTopic,
  isRetryableTopicCreateError,
  mergePreservedTherapyTopics,
  therapyTopicSaveErrorMessage,
} from "./createTherapyTopic";

describe("createTherapyTopic", () => {
  it("creates with title, notes, is_active and the extended budget", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "topic-1",
      title: "Self Confidence",
      notes: "My appearance",
      is_active: true,
    });

    const created = await createTherapyTopic(
      {
        title: "Self Confidence",
        notes: "My appearance",
        is_active: true,
      },
      { create },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      {
        title: "Self Confidence",
        notes: "My appearance",
        is_active: true,
      },
      { timeoutMs: STORE_TOPIC_CREATE_TIMEOUT_MS },
    );
    expect(STORE_TOPIC_CREATE_TIMEOUT_MS).toBe(20000);
    expect(created.id).toBe("topic-1");
  });

  it("retries once on timeout then succeeds", async () => {
    const timeout = Object.assign(new Error("The server took too long to respond."), {
      code: "timeout",
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ id: "topic-2", title: "Grief", is_active: true });

    const created = await createTherapyTopic(
      { title: "Grief", notes: "", is_active: true },
      { create },
    );

    expect(created.id).toBe("topic-2");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: "Grief" }),
      { timeoutMs: STORE_TOPIC_CREATE_TIMEOUT_MS },
    );
  });

  it("retries once on a 503 connection reset", async () => {
    const reset = Object.assign(new Error("Database connection reset"), {
      status: 503,
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce({ id: "topic-3", title: "Sleep", is_active: true });

    const created = await createTherapyTopic(
      { title: "Sleep", notes: "", is_active: true },
      { create },
    );

    expect(created.id).toBe("topic-3");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401 auth failure", async () => {
    const auth = Object.assign(
      new Error(
        "Not signed in — your session may have expired. Sign out and sign in again, then retry.",
      ),
      { status: 401 },
    );
    const create = vi.fn().mockRejectedValue(auth);

    await expect(
      createTherapyTopic({ title: "X", notes: "", is_active: true }, { create }),
    ).rejects.toThrow(/Not signed in/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("therapyTopicSaveErrorMessage", () => {
  it("surfaces the server message and keeps a short fallback", () => {
    expect(therapyTopicSaveErrorMessage({ message: "Database connection reset" })).toBe(
      "Database connection reset",
    );
    expect(therapyTopicSaveErrorMessage({})).toBe(THERAPY_TOPIC_SAVE_FALLBACK);
  });
});

describe("isRetryableTopicCreateError", () => {
  it("retries timeout and 503 reset only", () => {
    expect(isRetryableTopicCreateError({ code: "timeout" })).toBe(true);
    expect(isRetryableTopicCreateError({ name: "AbortError" })).toBe(true);
    expect(isRetryableTopicCreateError({ status: 503 })).toBe(true);
    expect(
      isRetryableTopicCreateError({ message: "Database connection reset" }),
    ).toBe(true);
    expect(isRetryableTopicCreateError({ status: 401, message: "Not signed in" })).toBe(
      false,
    );
  });
});

describe("mergePreservedTherapyTopics", () => {
  it("keeps just-created ids when the list refresh races empty", () => {
    const pending = new Set(["topic-new"]);
    const previous = [{ id: "topic-new", title: "Self Confidence", is_active: true }];
    expect(mergePreservedTherapyTopics([], previous, pending)).toEqual(previous);
    expect(PENDING_THERAPY_TOPIC_MS).toBe(20000);
  });

  it("does not duplicate once the list includes the created id", () => {
    const pending = new Set(["topic-new"]);
    const listed = [{ id: "topic-new", title: "Self Confidence", is_active: true }];
    expect(
      mergePreservedTherapyTopics(listed, listed, pending),
    ).toEqual(listed);
  });
});
