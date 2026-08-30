import { logger } from "./logger";

export const CURSOR_API_BASE = "https://api.cursor.com/v1";

export type CursorFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CursorAgent = {
  id: string;
  name?: string;
  status?: string;
  url?: string;
  latestRunId?: string | null;
};

export type CursorRun = {
  id: string;
  agentId?: string;
  status?: string;
  result?: string | null;
  git?: {
    branches?: Array<{
      repoUrl?: string;
      branch?: string;
      prUrl?: string;
    }>;
  };
};

export type CreateCursorAgentInput = {
  prompt: string;
  name?: string;
  repoUrl?: string;
  startingRef?: string;
  autoCreatePr?: boolean;
};

export type CreateCursorAgentResult = {
  agent: CursorAgent;
  run: CursorRun | null;
};

function trimOrNull(value: string | undefined | null): string | null {
  const text = String(value || "").trim();
  return text || null;
}

export function cursorApiKey(): string | null {
  return (
    trimOrNull(process.env.CURSOR_API_KEY) ||
    trimOrNull(process.env.CURSOR_CLOUD_API_KEY)
  );
}

export function cursorRepoUrl(): string {
  return (
    trimOrNull(process.env.CURSOR_CLOUD_REPO_URL) ||
    "https://github.com/davins56/Anima-Protocol"
  );
}

export function cursorStartingRef(): string {
  return trimOrNull(process.env.CURSOR_CLOUD_STARTING_REF) || "main";
}

export function cursorAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 400) };
  }
}

function asAgent(value: unknown): CursorAgent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  return {
    id,
    name: typeof record.name === "string" ? record.name : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    url:
      typeof record.url === "string"
        ? record.url
        : `https://cursor.com/agents/${id}`,
    latestRunId:
      typeof record.latestRunId === "string" ? record.latestRunId : null,
  };
}

function asRun(value: unknown): CursorRun | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  const git =
    record.git && typeof record.git === "object"
      ? (record.git as CursorRun["git"])
      : undefined;
  return {
    id,
    agentId: typeof record.agentId === "string" ? record.agentId : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    result: typeof record.result === "string" ? record.result : null,
    git,
  };
}

export class CursorCloudError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = "cursor_error") {
    super(message);
    this.name = "CursorCloudError";
    this.status = status;
    this.code = code;
  }
}

export async function createCloudAgent(
  input: CreateCursorAgentInput,
  fetchImpl: CursorFetch = fetch,
): Promise<CreateCursorAgentResult> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    throw new CursorCloudError(
      "CURSOR_API_KEY is not configured.",
      503,
      "cursor_unconfigured",
    );
  }

  const repoUrl = input.repoUrl || cursorRepoUrl();
  const startingRef = input.startingRef || cursorStartingRef();
  const res = await fetchImpl(`${CURSOR_API_BASE}/agents`, {
    method: "POST",
    headers: {
      Authorization: cursorAuthHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: { text: input.prompt },
      name: (input.name || "Serenity protocol upgrade").slice(0, 100),
      repos: [{ url: repoUrl, startingRef }],
      autoCreatePR: input.autoCreatePr !== false,
    }),
  });

  const body = await readJson(res);
  if (!res.ok) {
    const message =
      (typeof body.error === "string" && body.error) ||
      (typeof body.message === "string" && body.message) ||
      `Cursor agent create failed (${res.status})`;
    logger.warn({ status: res.status, message }, "Cursor create agent failed");
    throw new CursorCloudError(message, res.status >= 400 ? res.status : 502);
  }

  const agent = asAgent(body.agent) || asAgent(body);
  if (!agent) {
    throw new CursorCloudError("Cursor create agent returned no agent id.");
  }
  return { agent, run: asRun(body.run) };
}

export async function getCloudAgent(
  agentId: string,
  fetchImpl: CursorFetch = fetch,
): Promise<CursorAgent> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    throw new CursorCloudError(
      "CURSOR_API_KEY is not configured.",
      503,
      "cursor_unconfigured",
    );
  }
  const res = await fetchImpl(
    `${CURSOR_API_BASE}/agents/${encodeURIComponent(agentId)}`,
    { headers: { Authorization: cursorAuthHeader(apiKey) } },
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new CursorCloudError(
      (typeof body.error === "string" && body.error) ||
        `Cursor get agent failed (${res.status})`,
      res.status,
    );
  }
  const agent = asAgent(body);
  if (!agent) throw new CursorCloudError("Cursor get agent returned no id.");
  return agent;
}

export async function getCloudRun(
  agentId: string,
  runId: string,
  fetchImpl: CursorFetch = fetch,
): Promise<CursorRun> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    throw new CursorCloudError(
      "CURSOR_API_KEY is not configured.",
      503,
      "cursor_unconfigured",
    );
  }
  const res = await fetchImpl(
    `${CURSOR_API_BASE}/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    { headers: { Authorization: cursorAuthHeader(apiKey) } },
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new CursorCloudError(
      (typeof body.error === "string" && body.error) ||
        `Cursor get run failed (${res.status})`,
      res.status,
    );
  }
  const run = asRun(body);
  if (!run) throw new CursorCloudError("Cursor get run returned no id.");
  return run;
}

export function firstGitLinks(run: CursorRun | null | undefined): {
  prUrl: string | null;
  branch: string | null;
} {
  const branch = run?.git?.branches?.[0];
  return {
    prUrl: trimOrNull(branch?.prUrl),
    branch: trimOrNull(branch?.branch),
  };
}
