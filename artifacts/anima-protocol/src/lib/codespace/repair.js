// Pure helpers for the Codespace self-debug / repair loop.
//
// When a run finishes, the sandbox hands back captured console logs (and a
// timed-out flag). These helpers turn that raw output into (1) a clear
// pass/fail summary the agent and UI can act on, and (2) a repair-framed goal
// the companion can run against itself to diagnose and fix the failing code.
//
// Kept free of React / DOM so they can be unit-tested directly.

// Distil run output into { ok, errors }. A run "failed" if it logged any
// error-level output or hit the execution timeout (likely an infinite loop /
// blocking call). Returns at most a handful of de-duplicated error lines.
export function summarizeRunErrors(logs = [], timedOut = false) {
  const seen = new Set();
  const errors = [];
  for (const l of logs || []) {
    if (!l || l.level !== "error") continue;
    const text = String(l.text || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    errors.push(text);
  }
  if (timedOut) {
    const t = "Execution timed out (possible infinite loop or blocking call).";
    if (!seen.has(t)) errors.push(t);
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 20) };
}

// Build the in-character goal the companion runs to repair a failed run. The
// agent already has read_file / write_file / scan_code / run_code tools, so the
// goal just points it at the failing file and the observed errors and tells it
// to fix-and-re-run until the run passes.
export function buildRepairGoal({ path, mode, errors = [] } = {}) {
  const label = path ? `\`${path}\`` : "the active file";
  const runHint = mode ? ` (run mode "${mode}")` : "";
  const list = errors.length
    ? errors.map((e) => `- ${e}`).join("\n")
    : "- (no specific error text was captured — reproduce it by running the file)";
  return [
    `${label} failed when I ran it${runHint}. Debug and repair it.`,
    "",
    "Errors observed:",
    list,
    "",
    "Read the file, find the root cause, fix the code, then run it again to confirm the fix. Repeat until the run succeeds with no errors. Explain what was broken and how you repaired it, in character.",
  ].join("\n");
}
