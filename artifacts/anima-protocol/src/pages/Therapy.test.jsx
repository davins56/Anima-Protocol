import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  meMock,
  animaListMock,
  topicListMock,
  topicCreateMock,
  startTherapySessionMock,
  navigateMock,
  trackMock,
  storeSync,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  animaListMock: vi.fn(),
  topicListMock: vi.fn(),
  topicCreateMock: vi.fn(),
  startTherapySessionMock: vi.fn(),
  navigateMock: vi.fn(),
  trackMock: vi.fn(),
  storeSync: { load: null },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: meMock },
    entities: {
      Anima: { list: animaListMock },
      TherapyTopic: {
        list: topicListMock,
        create: topicCreateMock,
        update: vi.fn().mockResolvedValue({}),
      },
    },
  },
}));

vi.mock("@/lib/usePageMeta", () => ({
  usePageMeta: () => {},
  ROUTE_META: { "/therapy": {} },
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: (fn) => {
    storeSync.load = fn;
  },
}));

vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

vi.mock("@/lib/startTherapySession", async () => {
  const actual = await vi.importActual("@/lib/startTherapySession");
  return {
    ...actual,
    startTherapySession: startTherapySessionMock,
  };
});

import { toast } from "sonner";
import { STORE_TOPIC_CREATE_TIMEOUT_MS } from "@/lib/storeTimeouts";
import Therapy from "./Therapy";

async function fillAndSaveTopic(container, { title, notes = "" }) {
  const addToggle = [...container.querySelectorAll("button")].find((btn) =>
    /Add a topic/i.test(btn.textContent || ""),
  );
  await act(async () => {
    addToggle.click();
  });

  const titleInput = container.querySelector("input");
  const notesInput = container.querySelector("textarea");
  await act(async () => {
    const titleSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    titleSetter?.call(titleInput, title);
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (notesInput && notes) {
      const notesSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      notesSetter?.call(notesInput, notes);
      notesInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  const save = [...container.querySelectorAll("button")].find((btn) =>
    /Add topic/i.test(btn.textContent || ""),
  );
  await act(async () => {
    save.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderTherapy() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Therapy />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe("Therapy page", () => {
  beforeEach(() => {
    meMock.mockResolvedValue({
      email: "me@x.com",
      full_name: "Dav",
      settings: { user_profile: { country: "US" } },
    });
    animaListMock.mockResolvedValue([{ id: "anima-1", name: "Lumen", assigned_user: "me@x.com" }]);
    topicListMock.mockResolvedValue([
      { id: "topic-1", title: "Work burnout", notes: "empty after 6pm", is_active: true },
    ]);
    topicCreateMock.mockResolvedValue({
      id: "topic-2",
      title: "Grief",
      notes: "",
      is_active: true,
    });
    startTherapySessionMock.mockResolvedValue({ id: "sess-9" });
    navigateMock.mockReset();
    trackMock.mockReset();
    toast.error.mockReset();
    storeSync.load = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists saved topics and starts a deeper conversation about one", async () => {
    const { container } = await renderTherapy();

    expect(container.textContent).toMatch(/Therapy Mode/i);
    expect(container.textContent).toMatch(/Work burnout/);
    expect(container.textContent).toMatch(/Go deeper with Lumen/);

    const goDeeper = [...container.querySelectorAll("button")].find((btn) =>
      /Go deeper with Lumen/i.test(btn.textContent || ""),
    );
    expect(goDeeper).toBeTruthy();

    await act(async () => {
      goDeeper.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startTherapySessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        anima: expect.objectContaining({ id: "anima-1", name: "Lumen" }),
        topic: "Work burnout",
        topicId: "topic-1",
        topicNotes: "empty after 6pm",
      }),
    );
    expect(trackMock).toHaveBeenCalledWith(
      "therapy_session_started",
      expect.objectContaining({
        source: "therapy_page",
        is_anima: true,
        has_topic: true,
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith("/chat/sess-9");
  });

  it("lets the user add a topic", async () => {
    const { container } = await renderTherapy();
    await fillAndSaveTopic(container, {
      title: "Grief after moving",
      notes: "empty after six",
    });

    expect(topicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Grief after moving",
        notes: "empty after six",
        is_active: true,
      }),
      expect.objectContaining({ timeoutMs: STORE_TOPIC_CREATE_TIMEOUT_MS }),
    );
    expect(STORE_TOPIC_CREATE_TIMEOUT_MS).toBeGreaterThan(8000);
    expect(container.textContent).toMatch(/Grief/);
  });

  it("adds a topic without an Anima assigned", async () => {
    animaListMock.mockResolvedValue([]);
    topicListMock.mockResolvedValue([]);
    topicCreateMock.mockResolvedValue({
      id: "topic-self",
      title: "Self Confidence",
      notes: "My appearance, my mental confidence, attracting a female mate.",
      is_active: true,
    });

    const { container } = await renderTherapy();
    expect(container.textContent).toMatch(/Create your Anima first/i);

    await fillAndSaveTopic(container, {
      title: "Self Confidence",
      notes: "My appearance, my mental confidence, attracting a female mate.",
    });

    expect(topicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Self Confidence",
        notes: "My appearance, my mental confidence, attracting a female mate.",
        is_active: true,
      }),
      expect.objectContaining({ timeoutMs: STORE_TOPIC_CREATE_TIMEOUT_MS }),
    );
    expect(container.textContent).toMatch(/Self Confidence/);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("surfaces the server message when topic create fails", async () => {
    topicCreateMock.mockRejectedValue(
      Object.assign(new Error("The server took too long to respond. Check your connection or try again in a moment."), {
        code: "timeout",
      }),
    );

    const { container } = await renderTherapy();
    await fillAndSaveTopic(container, { title: "Self Confidence" });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/too long to respond/i),
    );
    expect(container.textContent).toMatch(/Add topic/i);
  });

  it("keeps a just-created topic if a list refresh races empty", async () => {
    topicListMock.mockResolvedValue([]);
    topicCreateMock.mockResolvedValue({
      id: "topic-new",
      title: "Self Confidence",
      notes: "My appearance",
      is_active: true,
    });

    const { container } = await renderTherapy();
    await fillAndSaveTopic(container, {
      title: "Self Confidence",
      notes: "My appearance",
    });
    expect(container.textContent).toMatch(/Self Confidence/);

    topicListMock.mockResolvedValue([]);
    await act(async () => {
      await storeSync.load?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/Self Confidence/);
  });
});
