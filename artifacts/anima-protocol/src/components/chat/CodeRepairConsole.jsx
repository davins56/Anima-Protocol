import { useMemo, useState } from "react";
import { AlertTriangle, Clipboard, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import { animaApi } from "@/api/animaApi";

const OPENROUTER_PRESET =
  "OpenRouter credits/rate limit exhausted: HTTP 429 - 429 Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day.";

function formatSteps(steps = []) {
  return steps
    .map((step, index) => {
      const parts = [`${index + 1}. ${step.title}`, step.detail];
      if (step.command) parts.push(`Command/value:\n${step.command}`);
      if (step.files?.length) parts.push(`Where:\n${step.files.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

function formatPlan(result) {
  if (!result) return "";
  return [
    `Summary: ${result.summary}`,
    `Likely cause: ${result.likelyCause}`,
    "",
    "Repair steps:",
    formatSteps(result.repairSteps),
    "",
    "Verification:",
    formatSteps(result.verificationSteps),
    "",
    "Guardrails:",
    (result.guardrails || []).map((item) => `- ${item}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function StepList({ title, steps }) {
  if (!steps?.length) return null;
  return (
    <section className="space-y-2">
      <h4 className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary/45">{title}</h4>
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={`${title}-${index}`} className="border border-primary/10 bg-black/35 p-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/80">
              {index + 1}. {step.title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-primary/60">{step.detail}</p>
            {step.command && (
              <pre className="mt-2 overflow-x-auto border border-primary/10 bg-black/50 p-2 font-mono text-[10px] text-primary/70">
                {step.command}
              </pre>
            )}
            {step.files?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {step.files.map((file) => (
                  <span key={file} className="border border-primary/10 px-2 py-0.5 font-mono text-[9px] text-primary/45">
                    {file}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function CodeRepairConsole({ sessionId, onClose }) {
  const [issue, setIssue] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyText = useMemo(() => formatPlan(result), [result]);

  const analyze = async () => {
    const trimmed = issue.trim();
    if (!trimmed) {
      setError("Paste an error message or describe the broken behavior first.");
      return;
    }
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const analysis = await animaApi.codeRepair.analyze({
        issue: trimmed,
        context: {
          surface: "chat_repair_console",
          session_id: sessionId,
        },
      });
      setResult(analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to analyze this issue.");
    } finally {
      setLoading(false);
    }
  };

  const copyPlan = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
    } catch {
      setError("Copy failed. Select the repair plan text manually.");
    }
  };

  return (
    <div className="border-t border-primary/10 bg-black/45 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary/70" />
            <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary/80">
              Anima Repair Console
            </h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-primary/45">
            Paste an app error and Anima will produce a guarded repair protocol. It diagnoses and drafts fixes,
            but it never writes repository files or changes production settings directly.
          </p>
        </div>
        <button onClick={onClose} className="text-primary/30 transition-colors hover:text-primary/70" aria-label="Close repair console">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          <textarea
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            placeholder="Paste the error, console log, failed endpoint response, or describe what broke..."
            className="h-44 w-full resize-none border border-primary/15 bg-black/60 p-3 font-mono text-xs leading-relaxed text-primary/80 outline-none placeholder:text-primary/25 focus:border-primary/40"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={analyze}
              disabled={loading}
              className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary transition-colors hover:bg-primary/15 disabled:cursor-wait disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {loading ? "Analyzing" : "Ask Anima to Fix"}
            </button>
            <button
              type="button"
              onClick={() => setIssue(OPENROUTER_PRESET)}
              className="border border-primary/15 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary/55 transition-colors hover:text-primary"
            >
              Load OpenRouter Example
            </button>
            {copyText && (
              <button
                type="button"
                onClick={copyPlan}
                className="inline-flex items-center gap-2 border border-primary/15 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary/55 transition-colors hover:text-primary"
              >
                <Clipboard className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy Plan"}
              </button>
            )}
          </div>
          {error && (
            <div className="flex gap-2 border border-red-400/20 bg-red-950/20 p-2 text-xs text-red-200/80">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="min-h-44 space-y-3 border border-primary/10 bg-black/30 p-3">
          {result ? (
            <>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary/35">
                  {result.category} / {result.confidence} confidence
                </div>
                <h4 className="mt-1 text-sm font-semibold text-primary/85">{result.summary}</h4>
                <p className="mt-1 text-xs leading-relaxed text-primary/55">{result.likelyCause}</p>
              </div>

              {result.diagnostics?.openrouter && (
                <div className="grid gap-1 border border-primary/10 bg-black/35 p-2 font-mono text-[10px] text-primary/45 sm:grid-cols-2">
                  <span>OpenRouter env: {result.diagnostics.openrouter.env || "unset"}</span>
                  <span>Model: {result.diagnostics.openrouter.model || "unknown"}</span>
                  <span>Configured: {String(result.diagnostics.openrouter.configured)}</span>
                  <span>Free tier: {String(result.diagnostics.openrouter.isFreeTier)}</span>
                </div>
              )}

              <StepList title="Repair steps" steps={result.repairSteps} />
              <StepList title="Verify" steps={result.verificationSteps} />

              {result.guardrails?.length > 0 && (
                <section className="space-y-2">
                  <h4 className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.25em] text-primary/45">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Guardrails
                  </h4>
                  <ul className="space-y-1 text-xs leading-relaxed text-primary/50">
                    {result.guardrails.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="flex h-full min-h-40 items-center justify-center text-center">
              <p className="max-w-sm font-mono text-[10px] uppercase leading-relaxed tracking-[0.2em] text-primary/30">
                Awaiting an error signal. Paste the breakage and Anima will return the safest repair path.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
