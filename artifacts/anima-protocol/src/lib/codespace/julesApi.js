// Jules API module for Anima Protocol Codespaces
// Provides direct integration for coding, automated debugging, and troubleshooting
// directly within the codespace environment.

import { base44 } from "@/api/base44Client";
import { scanCode } from "./codeScanner";
import { summarizeRunErrors, buildRepairGoal } from "./repair";

export const JULES_PERSONA = {
  id: "jules-ai-engineer",
  name: "Jules (AI Engineer)",
  universe: "Anima Protocol Engine",
  personality:
    "An extremely skilled software engineer and debugging specialist. Resourceful, precise, and systematic in diagnosing errors, refactoring code, and building features.",
  speaking_style:
    "Direct, analytical, efficient, and clear. Explains root causes concisely.",
};

/**
 * Creates a Jules task configuration for tracking and execution.
 */
export function createJulesTask(goal, files = [], options = {}) {
  return {
    id: `jules-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    goal: String(goal || "").trim(),
    files: Array.isArray(files) ? files : [],
    mode: options.mode || "debug",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Executes a single agent step with Jules persona fallback if the backend function
 * is unavailable.
 */
export async function executeAgentStep(messages, files = [], options = {}) {
  const filePaths = (files || []).map((f) => (typeof f === "string" ? f : f.path));

  // Primary path: invoke server-side codespaceAgentStep function
  const res = await base44.functions.codespaceAgentStep.invoke({
    messages,
    character: JULES_PERSONA,
    files: filePaths,
  });

  if (res && res.message) {
    return res.message;
  }

  // Fallback path if custom server function returns null/empty
  const promptText = (messages || [])
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const systemPrompt = `You are Jules, an expert software engineer inside Anima Protocol Codespace.
Files in project: ${filePaths.join(", ") || "none"}
Analyze the project state and assist the user by generating clean code or fixing bugs directly.
Answer in JSON: { "content": "explanation and narration", "tool_calls": [] }`;

  const fallback = await base44.integrations.Core.InvokeLLM({
    prompt: promptText,
    systemPrompt,
    response_json_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        tool_calls: { type: "array" },
      },
      required: ["content"],
    },
  });

  return {
    role: "assistant",
    content: fallback?.content || "Jules completed the diagnostic turn.",
    tool_calls: fallback?.tool_calls || [],
  };
}

/**
 * Runs automated debugging and troubleshooting across project files and execution logs.
 * Returns a diagnostic breakdown and recommended repair goal.
 */
export async function debugAndTroubleshoot({ files = [], lastRun = null, targetPath = "" } = {}) {
  const fileList = Array.isArray(files) ? files : [];

  // 1. Scan code security/syntax threats
  const scans = fileList.map((f) => scanCode(f.content || "", f.path || ""));
  const securityThreats = scans.flatMap((s) => s.findings || []);

  // 2. Extract execution errors from last run
  const runSummary = lastRun
    ? { ok: lastRun.ok, errors: lastRun.errors || [] }
    : summarizeRunErrors([], false);

  const hasErrors = !runSummary.ok || securityThreats.length > 0;

  // 3. Build diagnostic repair goal
  const pathToRepair = targetPath || lastRun?.path || (fileList[0] ? fileList[0].path : "index.html");
  const combinedErrors = [
    ...runSummary.errors,
    ...securityThreats.map((t) => `[Threat ${t.severity}] ${t.label} at line ${t.line}`),
  ];

  const repairGoal = buildRepairGoal({
    path: pathToRepair,
    mode: lastRun?.mode || "web",
    errors: combinedErrors,
  });

  return {
    ok: !hasErrors,
    targetPath: pathToRepair,
    securityThreats,
    runErrors: runSummary.errors,
    combinedErrors,
    repairGoal,
    summary: hasErrors
      ? `Jules detected ${combinedErrors.length} issue(s) in ${pathToRepair}.`
      : `Jules verified ${pathToRepair} — no syntax or runtime errors detected.`,
  };
}

export const julesApi = {
  JULES_PERSONA,
  createJulesTask,
  executeAgentStep,
  debugAndTroubleshoot,
};

export default julesApi;
