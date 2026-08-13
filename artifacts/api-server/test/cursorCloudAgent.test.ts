import { afterEach, describe, expect, it } from "vitest";
import {
  createCloudAgent,
  cursorAuthHeader,
  firstGitLinks,
  getCloudAgent,
  getCloudRun,
} from "../src/lib/cursorCloudAgent";

const originalKey = process.env.CURSOR_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalKey;
});

describe("cursorCloudAgent", () => {
  it("encodes Cursor Basic auth with an empty password", () => {
    expect(cursorAuthHeader("crsr_test")).toBe(
      `Basic ${Buffer.from("crsr_test:").toString("base64")}`,
    );
  });

  it("creates a cloud agent against the Anima Protocol repo", async () => {
    process.env.CURSOR_API_KEY = "crsr_test";
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.cursor.com/v1/agents");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.repos[0].url).toContain("Anima-Protocol");
      expect(body.autoCreatePR).toBe(true);
      expect(body.prompt.text).toContain("darker theme");
      return new Response(
        JSON.stringify({
          agent: {
            id: "bc-test",
            name: "Serenity interface upgrade",
            status: "ACTIVE",
            url: "https://cursor.com/agents/bc-test",
            latestRunId: "run-test",
          },
          run: { id: "run-test", status: "CREATING" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await createCloudAgent(
      { prompt: "Add a darker theme", name: "Serenity interface upgrade" },
      fetchImpl,
    );
    expect(result.agent.id).toBe("bc-test");
    expect(result.run?.id).toBe("run-test");
  });

  it("reads PR links from a finished run", async () => {
    process.env.CURSOR_API_KEY = "crsr_test";
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "run-test",
          agentId: "bc-test",
          status: "FINISHED",
          result: "Opened a PR.",
          git: {
            branches: [
              {
                repoUrl: "github.com/davins56/Anima-Protocol",
                branch: "cursor/darker-theme",
                prUrl: "https://github.com/davins56/Anima-Protocol/pull/12",
              },
            ],
          },
        }),
        { status: 200 },
      );

    const run = await getCloudRun("bc-test", "run-test", fetchImpl);
    expect(firstGitLinks(run)).toEqual({
      prUrl: "https://github.com/davins56/Anima-Protocol/pull/12",
      branch: "cursor/darker-theme",
    });
  });

  it("surfaces a missing API key as unconfigured", async () => {
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_CLOUD_API_KEY;
    await expect(getCloudAgent("bc-test")).rejects.toMatchObject({
      code: "cursor_unconfigured",
      status: 503,
    });
  });
});
