import { describe, expect, it } from "vitest";
import { LlmStreamTimeoutError } from "../src/lib/consumeLlmStream.js";
import { streamErrorMessage } from "../src/lib/chatStreamError";
import {
  LOCAL_LLM_SUBREQUEST_HINT,
  OPENROUTER_FREE_PROVIDER_HINT,
} from "../src/lib/llmFailover";
import { WorkerApiTimeoutError } from "../src/lib/workerApiGuard";

const NATASHA_FAILED_QUERY = `Failed query: select "id", "user_id", "character_id", "summary", "facts", "emotional_state", "resonance_notes", "created_at", "updated_at" from "companion_memories" where ("companion_memories"."user_id" = $1 and "companion_memories"."character_id" in ($2)) order by "companion_memories"."updated_at" desc params: user_3EndjEBjft9MWRhD4dYFiX63sDU,seed_marvel-cinematic-universe-natasha-romanoff`;

describe("streamErrorMessage companion_memories", () => {
  it("does not leak the production Natasha Failed query SQL into the HUD", () => {
    const message = streamErrorMessage(new Error(NATASHA_FAILED_QUERY));
    expect(message).toBe("Couldn't load companion memory. Please try again.");
    expect(message).not.toMatch(/Failed query/i);
    expect(message).not.toMatch(/companion_memories/);
    expect(message).not.toMatch(/select "/i);
    expect(message).not.toMatch(/user_3Endj/);
    expect(message).not.toMatch(/natasha-romanoff/);
  });

  it("maps a schema-missing cause under a drizzle wrapper", () => {
    const wrapped = new Error(NATASHA_FAILED_QUERY);
    (wrapped as Error & { cause?: unknown }).cause = Object.assign(
      new Error('relation "companion_memories" does not exist'),
      { code: "42P01", name: "PostgresError" },
    );
    expect(streamErrorMessage(wrapped)).toBe(
      "Couldn't load companion memory — the database schema is missing or out of date.",
    );
    expect(streamErrorMessage(wrapped)).not.toMatch(/Failed query|select "/i);
  });

  it("maps a Hyperdrive / connection timeout cause under a drizzle wrapper", () => {
    const wrapped = new Error(NATASHA_FAILED_QUERY);
    (wrapped as Error & { cause?: unknown }).cause = Object.assign(
      new Error("write CONNECT_TIMEOUT"),
      { code: "CONNECT_TIMEOUT" },
    );
    expect(streamErrorMessage(wrapped)).toBe(
      "Couldn't load companion memory — the database timed out. Please try again.",
    );
    expect(streamErrorMessage(wrapped)).not.toMatch(/Failed query|CONNECT_TIMEOUT/i);
  });

  it("maps a generic Failed query without companion_memories to a safe DB message", () => {
    expect(streamErrorMessage(new Error("Failed query: select 1\nparams:"))).toBe(
      "Couldn't load this conversation. Please try again.",
    );
  });

  it("maps a Worker cross-request I/O failure to conversation copy, not Database unavailable", () => {
    const message = streamErrorMessage(
      new Error(
        "Cannot perform I/O on behalf of a different request. I/O objects created in the context of one request handler cannot be accessed from a different request's handler.",
      ),
    );
    expect(message).toBe("Couldn't load this conversation. Please try again.");
    expect(message).not.toMatch(/Database unavailable/i);
    expect(message).not.toMatch(/different request/i);
  });

  it("still names companion memory when the table is two cause levels down", () => {
    const pg = Object.assign(
      new Error('relation "companion_memories" does not exist'),
      { code: "42P01", name: "PostgresError" },
    );
    const driver = new Error("query failed");
    (driver as Error & { cause?: unknown }).cause = pg;
    const wrapped = new Error("Failed query: select 1\nparams:");
    (wrapped as Error & { cause?: unknown }).cause = driver;
    expect(streamErrorMessage(wrapped)).toBe(
      "Couldn't load companion memory — the database schema is missing or out of date.",
    );
    expect(streamErrorMessage(wrapped)).not.toMatch(/Failed query|select 1/i);
  });
});

describe("streamErrorMessage does not regress LLM / Worker timeouts", () => {
  it("keeps LLM stream timeouts as reply-timeout copy, not SQL", () => {
    const message = streamErrorMessage(
      new LlmStreamTimeoutError(
        "The companion took too long to reply. Please try again.",
      ),
    );
    expect(message).toMatch(/took too long to reply/i);
    expect(message).not.toMatch(/Failed query/i);
    expect(message).not.toMatch(/database/i);
  });

  it("does not call a WorkerApiTimeoutError a database failure", () => {
    const message = streamErrorMessage(new WorkerApiTimeoutError(20_000));
    expect(message).toMatch(/took too long to reply/i);
    expect(message).not.toMatch(/database/i);
    expect(message).not.toMatch(/Failed query/i);
  });

  it("does not leak SQL when a drizzle wrapper's cause is the Worker wall timeout", () => {
    const wrapped = new Error("Failed query: select 1\nparams:");
    wrapped.name = "DrizzleQueryError";
    (wrapped as Error & { cause?: unknown }).cause = new WorkerApiTimeoutError(
      20_000,
    );
    const message = streamErrorMessage(wrapped);
    expect(message).toMatch(/took too long to reply/i);
    expect(message).not.toMatch(/Failed query|select 1/i);
    expect(message).not.toMatch(/database/i);
  });
});

describe("streamErrorMessage OpenRouter hop leftovers", () => {
  it("remaps bare HTTP 429 / request-failed status to the free-tier hint", () => {
    expect(
      streamErrorMessage(
        Object.assign(new Error("Request failed with status code 429"), {
          status: 429,
        }),
      ),
    ).toBe(OPENROUTER_FREE_PROVIDER_HINT);
    expect(streamErrorMessage(new Error("API error: 502"))).toBe(
      OPENROUTER_FREE_PROVIDER_HINT,
    );
    expect(streamErrorMessage(new Error("HTTP 503"))).not.toMatch(
      /companion service encountered an issue/i,
    );
  });
});

describe("streamErrorMessage Worker subrequest limit", () => {
  it("does not leak the Cloudflare subrequest string or tunnel/home-box copy", () => {
    const productionToast = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
      cause: new Error("Too many subrequests by single Worker invocation."),
    });
    const message = streamErrorMessage(productionToast);
    expect(message).toBe(LOCAL_LLM_SUBREQUEST_HINT);
    expect(message).not.toMatch(/Too many subrequests/i);
    expect(message).not.toMatch(/home box|Cloudflare Tunnel|public-v1/i);
  });
});
