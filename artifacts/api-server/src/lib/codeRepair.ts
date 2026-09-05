import { OPENROUTER_FREE_MODEL } from "./openaiClient";

export type CodeRepairCategory =
  | "openrouter_quota"
  | "openrouter_key"
  | "clerk_auth"
  | "database"
  | "env_secret"
  | "generic";

export type CodeRepairInput = {
  issue: string;
  context?: Record<string, unknown>;
  diagnostics?: {
    openrouterConfigured?: boolean;
    openrouterEnv?: string | null;
    openrouterModel?: string | null;
    openrouterIsFreeTier?: boolean;
    localConfigured?: boolean;
    localHost?: string | null;
    customOnly?: boolean;
  };
};

export type CodeRepairStep = {
  title: string;
  detail: string;
  command?: string;
  files?: string[];
};

export type CodeRepairAnalysis = {
  category: CodeRepairCategory;
  confidence: "high" | "medium" | "low";
  summary: string;
  likelyCause: string;
  canAutoApply: false;
  repairSteps: CodeRepairStep[];
  verificationSteps: CodeRepairStep[];
  guardrails: string[];
};

const MAX_TEXT = 8_000;

function compactText(value: unknown, max = MAX_TEXT): string {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function haystack(input: CodeRepairInput): string {
  return `${input.issue}\n${JSON.stringify(input.context ?? {})}`.toLowerCase();
}

function classify(input: CodeRepairInput): CodeRepairCategory {
  const text = haystack(input);
  if (
    text.includes("openrouter") &&
    (text.includes("free-models-per-day") ||
      text.includes("rate limit") ||
      text.includes("429") ||
      text.includes("402") ||
      text.includes("credits") ||
      text.includes("venice"))
  ) {
    return "openrouter_quota";
  }
  if (text.includes("openrouter") || text.includes("sk-or-") || text.includes("anima_openrouter")) {
    return "openrouter_key";
  }
  if (text.includes("clerk") || text.includes("session not recognized") || text.includes("unauthorized") || text.includes("401")) {
    return "clerk_auth";
  }
  if (text.includes("database_url") || text.includes("postgres") || text.includes("drizzle") || text.includes("db push")) {
    return "database";
  }
  if (text.includes(".env") || text.includes("secret") || text.includes("api_key") || text.includes("sk_")) {
    return "env_secret";
  }
  return "generic";
}

function openRouterQuotaRepair(input: CodeRepairInput): CodeRepairAnalysis {
  const env = input.diagnostics?.openrouterEnv || "OPENROUTER_API_KEY";
  const model = input.diagnostics?.openrouterModel || OPENROUTER_FREE_MODEL;
  const localConfigured = Boolean(input.diagnostics?.localConfigured);
  const localHost = input.diagnostics?.localHost || null;
  const customOnly = Boolean(input.diagnostics?.customOnly);
  return {
    category: "openrouter_quota",
    confidence: "high",
    summary: localConfigured
      ? "OpenRouter is rejecting chat, but a custom Anima LLM is also configured — do not keep burning the free OpenRouter quota."
      : "Chat used OpenRouter because the self-hosted custom Anima LLM is not configured, and that OpenRouter account has hit its free daily cap.",
    likelyCause: localConfigured
      ? `A custom LLM host (${localHost ?? "configured"}) is set, but this turn still reached OpenRouter and hit a quota/rate-limit response. Prefer the custom LLM: leave ANIMA_OPENROUTER_FALLBACK unset unless you explicitly want OpenRouter after a connection failure.`
      : input.diagnostics?.openrouterIsFreeTier
        ? "ANIMA_LOCAL_LLM_BASE_URL is unset on this deployment, so chat skipped the custom LLM and used OpenRouter's free-tier models. A provider 429/5xx or the account-wide free daily cap cannot be fixed by changing ANIMA_OPENROUTER_FREE — chat is already on :free models."
        : "ANIMA_LOCAL_LLM_BASE_URL is unset on this deployment, so chat skipped the custom LLM and used OpenRouter. Setting ANIMA_OPENROUTER_FREE=true cannot bypass OpenRouter's free-models-per-day limit.",
    canAutoApply: false,
    repairSteps: [
      {
        title: customOnly
          ? "Finish custom LLM wiring"
          : "Point chat at the custom Anima LLM",
        detail:
          "Set ANIMA_LOCAL_LLM_BASE_URL to a public HTTPS OpenAI-compatible URL (Ollama/vLLM) and ANIMA_OLLAMA_MODEL_STANDARD to the model that host serves. Set ANIMA_LLM_PROVIDER=custom so OpenRouter cannot take over. Redeploy without build cache.",
        command:
          "ANIMA_LLM_PROVIDER=custom\nANIMA_LOCAL_LLM_BASE_URL=https://<your-ollama-or-vllm-host>/v1\nANIMA_OLLAMA_MODEL_STANDARD=anima-chat",
        files: ["Vercel Project Settings > Environment Variables", "docs/custom-llm.md"],
      },
      {
        title: "Confirm the winning OpenRouter key (only if you still want it as backup)",
        detail: `The server is configured to use ${env} / ${model}. If an older ${env} value points at an exhausted OpenRouter account, replace that value instead of adding more aliases.`,
        files: ["Vercel Project Settings > Environment Variables", ".env"],
      },
      {
        title: "Resolve the OpenRouter quota only as a last resort",
        detail:
          "Add credits at https://openrouter.ai/settings/credits or wait until midnight UTC. This does not fix a missing custom LLM.",
      },
    ],
    verificationSteps: [
      {
        title: "Check routing status",
        detail:
          "Verify the deployed API prefers the local/custom LLM (`preferred: \"local\"`, `chain` includes `local`). OpenRouter should not be primary when a custom LLM is configured.",
        command: "curl https://www.anima-protocol.com/api/healthz/llm",
      },
      {
        title: "Probe the custom LLM",
        detail: "Run a live provider probe after redeploying to confirm the self-hosted endpoint answers.",
        command: "curl https://www.anima-protocol.com/api/healthz/llm?probe=1",
      },
    ],
    guardrails: [
      "Do not commit real API keys to the repository.",
      "Do not set ANIMA_OPENROUTER_FALLBACK=true just to silence this error — that skips the custom LLM again.",
      "This console provides repair instructions; it does not mutate production settings or repository files.",
    ],
  };
}

function openRouterKeyRepair(): CodeRepairAnalysis {
  return {
    category: "openrouter_key",
    confidence: "medium",
    summary: "OpenRouter configuration needs cleanup.",
    likelyCause:
      "The application reads the first non-empty key in this order: OPENROUTER_API_KEY, ANIMA_OPENROUTER_API_KEY, OPEN_ROUTER_API_KEY.",
    canAutoApply: false,
    repairSteps: [
      {
        title: "Use one canonical key",
        detail: "Prefer OPENROUTER_API_KEY and remove stale alias values so the server cannot pick the wrong account.",
        files: ["Vercel Project Settings > Environment Variables", ".env"],
      },
      {
        title: "Enable free-tier routing when needed",
        detail: "Set ANIMA_OPENROUTER_FREE=true alongside the key to skip Venice by default.",
        command: "OPENROUTER_API_KEY=sk-or-...\nANIMA_OPENROUTER_FREE=true",
      },
    ],
    verificationSteps: [
      {
        title: "Verify selected key source",
        detail: "The LLM health endpoint reports the secret-free env name that supplied the key.",
        command: "curl https://www.anima-protocol.com/api/healthz/llm",
      },
    ],
    guardrails: [
      "Never paste secret values into chat transcripts or tracked files.",
      "Redeploy after changing Vercel environment variables.",
    ],
  };
}

function clerkRepair(): CodeRepairAnalysis {
  return {
    category: "clerk_auth",
    confidence: "medium",
    summary: "Clerk authentication settings appear inconsistent.",
    likelyCause:
      "A frontend publishable key and backend secret/publishable key mismatch can produce 401s and session recognition failures.",
    canAutoApply: false,
    repairSteps: [
      {
        title: "Use matching Clerk keys",
        detail: "Set VITE_CLERK_PUBLISHABLE_KEY, CLERK_PUBLISHABLE_KEY, and CLERK_SECRET_KEY from the same Clerk instance.",
        files: ["Vercel Project Settings > Environment Variables", ".env"],
      },
      {
        title: "Check proxy mode",
        detail: "Leave VITE_CLERK_PROXY_URL empty for the production custom Clerk domain unless intentionally testing proxy mode.",
      },
    ],
    verificationSteps: [
      {
        title: "Check API health",
        detail: "Confirm the API responds before signing in.",
        command: "curl https://www.anima-protocol.com/api/healthz",
      },
    ],
    guardrails: ["Never put CLERK_SECRET_KEY in any VITE_ variable.", "Redeploy after changing Clerk env vars."],
  };
}

function databaseRepair(): CodeRepairAnalysis {
  return {
    category: "database",
    confidence: "medium",
    summary: "Database configuration or schema setup needs attention.",
    likelyCause:
      "The API depends on DATABASE_URL and the shared Drizzle schema. A missing URL, blocked Postgres connection, or unapplied schema can break persistence.",
    canAutoApply: false,
    repairSteps: [
      {
        title: "Set DATABASE_URL",
        detail: "Configure DATABASE_URL in the target runtime environment. Local dev can use the provided Postgres database.",
        command: "DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev",
      },
      {
        title: "Apply schema locally",
        detail: "Push the shared database schema after DATABASE_URL is set.",
        command: "pnpm --filter @workspace/db run push",
      },
    ],
    verificationSteps: [
      {
        title: "Check health endpoint",
        detail: "Use the public API health check to confirm the server can start.",
        command: "curl http://127.0.0.1:8080/api/healthz",
      },
    ],
    guardrails: ["Do not point preview deployments at production data unless that is intentional."],
  };
}

function envSecretRepair(): CodeRepairAnalysis {
  return {
    category: "env_secret",
    confidence: "medium",
    summary: "A secret or environment value should be kept out of tracked source.",
    likelyCause:
      "Secrets belong in Vercel environment variables or gitignored local env files, not in committed code.",
    canAutoApply: false,
    repairSteps: [
      {
        title: "Move the value to runtime env",
        detail: "Put local-only values in the root .env file and deployed values in Vercel Project Settings.",
        files: [".env", "Vercel Project Settings > Environment Variables"],
      },
      {
        title: "Remove tracked copies",
        detail: "If a secret was committed, remove it from git and rotate the secret with the provider.",
        command: "git rm --cached <file-with-secret>",
      },
    ],
    verificationSteps: [
      {
        title: "Check git status",
        detail: "Make sure .env is not staged or tracked.",
        command: "git status --short",
      },
    ],
    guardrails: ["Rotate any secret that was committed or shared in a screenshot.", "Keep .env.example as placeholders only."],
  };
}

function genericRepair(issue: string): CodeRepairAnalysis {
  return {
    category: "generic",
    confidence: "low",
    summary: "Anima needs more structured debugging context to produce a precise fix.",
    likelyCause:
      "The supplied issue does not match a known repair recipe yet. Capture the exact error, recent change, affected page, and expected behavior.",
    canAutoApply: false,
    repairSteps: [
      {
        title: "Capture the failing path",
        detail: "Describe the page, action, current result, and expected result in one short reproduction.",
      },
      {
        title: "Collect the exact error",
        detail: compactText(issue, 500) || "Paste the browser console, server log, or API response that appears when the issue happens.",
      },
    ],
    verificationSteps: [
      {
        title: "Re-run the smallest reproduction",
        detail: "After applying a fix, repeat the exact failing action and record whether behavior changed.",
      },
    ],
    guardrails: [
      "This console does not run arbitrary code or write repository files.",
      "Use Cursor or a reviewed PR to apply patches.",
    ],
  };
}

export function analyzeCodeRepairInput(input: CodeRepairInput): CodeRepairAnalysis {
  const issue = compactText(input.issue);
  const safeInput = { ...input, issue };
  switch (classify(safeInput)) {
    case "openrouter_quota":
      return openRouterQuotaRepair(safeInput);
    case "openrouter_key":
      return openRouterKeyRepair();
    case "clerk_auth":
      return clerkRepair();
    case "database":
      return databaseRepair();
    case "env_secret":
      return envSecretRepair();
    default:
      return genericRepair(issue);
  }
}
