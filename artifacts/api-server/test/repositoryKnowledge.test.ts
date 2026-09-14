import { afterEach, describe, expect, it } from "vitest";
import {
  looksLikeRepositoryTurn,
  shouldRetrieveRepositoryKnowledge,
} from "../src/lib/repositoryKnowledge";

describe("shouldRetrieveRepositoryKnowledge", () => {
  const previous = process.env.ANIMA_REPOSITORY_RAG;

  afterEach(() => {
    if (previous === undefined) delete process.env.ANIMA_REPOSITORY_RAG;
    else process.env.ANIMA_REPOSITORY_RAG = previous;
  });

  it("skips ordinary companion turns by default", () => {
    delete process.env.ANIMA_REPOSITORY_RAG;
    expect(shouldRetrieveRepositoryKnowledge("Hello, I missed you.")).toBe(false);
    expect(shouldRetrieveRepositoryKnowledge("What should we have for dinner?")).toBe(
      false,
    );
    expect(looksLikeRepositoryTurn("Tell me about your day")).toBe(false);
    expect(
      looksLikeRepositoryTurn("Jack into the hyperdrive and ride the Cloudflare worker."),
    ).toBe(false);
  });

  it("runs when the turn is actually about this repo", () => {
    delete process.env.ANIMA_REPOSITORY_RAG;
    expect(
      shouldRetrieveRepositoryKnowledge(
        "What does this repo's wrangler.jsonc set as the worker main?",
      ),
    ).toBe(true);
    expect(
      shouldRetrieveRepositoryKnowledge(
        "Look in artifacts/api-server for the chat route",
      ),
    ).toBe(true);
    expect(looksLikeRepositoryTurn("explain the source tree")).toBe(true);
  });

  it("runs when the client sets an explicit include flag", () => {
    delete process.env.ANIMA_REPOSITORY_RAG;
    expect(
      shouldRetrieveRepositoryKnowledge("Hello", { explicit: true }),
    ).toBe(true);
  });

  it("stays off when ANIMA_REPOSITORY_RAG=false even for repo turns", () => {
    process.env.ANIMA_REPOSITORY_RAG = "false";
    expect(
      shouldRetrieveRepositoryKnowledge("Read wrangler.jsonc in this repo", {
        explicit: true,
      }),
    ).toBe(false);
  });

  it("can force every non-empty turn with ANIMA_REPOSITORY_RAG=true", () => {
    process.env.ANIMA_REPOSITORY_RAG = "true";
    expect(shouldRetrieveRepositoryKnowledge("Hello")).toBe(true);
  });
});
