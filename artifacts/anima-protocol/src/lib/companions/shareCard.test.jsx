import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { companionShareCard, shareCardSvg, shareCardText } from "./shareCard";
import ShareCompanionCard from "@/components/companions/ShareCompanionCard";

const aelindra = {
  name: "Aelindra",
  archetype: "Wayfinder",
  universe: "Anima",
  personality: "Steady and curious. Keeps a map of every promise. Secretly afraid of the dark.",
  backstory: "PRIVATE BACKSTORY",
  memories: [{ text: "user's address is 12 Elm" }],
  intimacy: { kinks: ["x"] },
  avatar_url: "https://storage.example/private/abc.png",
};

describe("identity-only share card", () => {
  it("uses the canonical name and whitelisted fields only", () => {
    const card = companionShareCard(aelindra);
    expect(card.name).toBe("Aeland");
    expect(card.tagline).toBe("Steady and curious.");
    const all = JSON.stringify(card) + shareCardText(card) + shareCardSvg(card);
    for (const secret of ["PRIVATE BACKSTORY", "12 Elm", "kinks", "storage.example", "afraid of the dark"]) {
      expect(all).not.toContain(secret);
    }
  });
  it("escapes markup in the SVG and has no scripts or external refs", () => {
    const svg = shareCardSvg(companionShareCard({ name: "<script>alert(1)</script>", personality: "Hi & <b>bye</b>." }));
    expect(svg).not.toMatch(/<script|href=|xlink|https?:\/\/(?!www\.w3\.org)/);
    expect(svg).toContain("&lt;SCRIPT&gt;");
  });
  it("Scarlet gets her flame palette", () => {
    expect(companionShareCard({ name: "Scarlet" }).aura).toBe("flame");
  });
  it("renders the preview with local actions", () => {
    render(<ShareCompanionCard character={aelindra} />);
    expect(screen.getByTestId("share-companion-card").innerHTML).toContain("AELAND");
    expect(screen.getByText("Download")).toBeTruthy();
  });
});
