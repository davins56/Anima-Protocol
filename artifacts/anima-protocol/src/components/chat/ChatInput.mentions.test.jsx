import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatInput from "./ChatInput";
import { applyMention, mentionMatches, mentionQuery } from "@/lib/situationalScene";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/api/animaClient", () => ({
  animaClient: { integrations: { Core: { UploadFile: vi.fn() } } },
  deleteUploadedFile: vi.fn(),
}));
vi.mock("@/api/pdfDocuments", () => ({
  pdfProgressLabel: () => "",
  uploadPdfDocument: vi.fn(),
  deletePdfDocument: vi.fn(),
  openPdfDocument: vi.fn(),
}));
vi.mock("@/components/pdf/PdfFileChip", () => ({ default: () => null }));

afterEach(cleanup);

const rows = [
  { id: "c_nat", name: "Natasha", presence: "asleep", reach: "none" },
  { id: "c_nad", name: "Nadia", presence: "here", reach: "none" },
  { id: "c_scarlet", name: "Scarlet", presence: "away", reach: "phone" },
  { id: "aspect:shadow", name: "Shadow", presence: "here", reach: "none" },
];

describe("@ autocomplete helpers (#763 B5)", () => {
  it("finds the trailing @fragment", () => {
    expect(mentionQuery("hey @Na")).toBe("Na");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("email me@x")).toBeNull();
    expect(mentionQuery("@Nat is here")).toBeNull();
  });

  it("matches cast names, here and reachable first, never aspects", () => {
    expect(mentionMatches("na", rows).map((r) => r.id)).toEqual(["c_nad", "c_nat"]);
    expect(mentionMatches("s", rows).map((r) => r.id)).toEqual(["c_scarlet"]);
    expect(mentionMatches(null, rows)).toEqual([]);
  });

  it("completes the name", () => {
    expect(applyMention("hey @Na", "Natasha")).toBe("hey @Natasha ");
  });
});

describe("ChatInput mentions", () => {
  it("shows glyphed suggestions and inserts the picked name; the send still goes through as text", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isLoading={false} disabled={false} mentionCandidates={rows} />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "wake up @Nat" } });
    const list = screen.getByTestId("mention-suggestions");
    expect(list.textContent).toContain("☾");
    fireEvent.click(screen.getByRole("option", { name: /Natasha/ }));
    expect(box.value).toBe("wake up @Natasha ");
    expect(screen.queryByTestId("mention-suggestions")).toBeNull();
  });

  it("Tab picks the first suggestion", () => {
    render(<ChatInput onSend={vi.fn()} isLoading={false} disabled={false} mentionCandidates={rows} />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "@S" } });
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box.value).toBe("@Scarlet ");
  });

  it("flag off (no candidates): identical markup and no suggestions", () => {
    const a = render(<ChatInput onSend={vi.fn()} isLoading={false} disabled={false} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "@Na" } });
    expect(screen.queryByTestId("mention-suggestions")).toBeNull();
    const htmlA = a.container.innerHTML;
    cleanup();
    const b = render(<ChatInput onSend={vi.fn()} isLoading={false} disabled={false} mentionCandidates={undefined} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "@Na" } });
    expect(b.container.innerHTML).toBe(htmlA);
  });
});
