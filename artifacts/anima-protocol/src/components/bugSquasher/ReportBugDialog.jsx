import { useEffect, useState } from "react";
import { Bug, Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  captureScreenshot as defaultCaptureScreenshot,
  submitManualReport as defaultSubmit,
} from "@/lib/bugSquasher/api";
import { buildDiagnosticContext } from "@/lib/bugSquasher/capture";

/**
 * "Report a bug" panel. Diagnostic context (route, app version, browser,
 * recent activity and captured errors) is attached by default and can be
 * previewed; a screenshot of the screen behind the panel is optional.
 *
 * `api` lets tests swap the network and screenshot calls.
 */
export default function ReportBugDialog({ open, onOpenChange, initialDescription = "", extraContext = null, api }) {
  const submit = api?.submitManualReport || defaultSubmit;
  const capture = api?.captureScreenshot || defaultCaptureScreenshot;
  const [description, setDescription] = useState(initialDescription);
  const [includeContext, setIncludeContext] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [screenshot, setScreenshot] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDescription(initialDescription || "");
    setScreenshot(null);
    setError("");
    setShowContext(false);
    setIncludeContext(true);
  }, [open, initialDescription]);

  const takeScreenshot = async () => {
    setCapturing(true);
    setError("");
    try {
      const shot = await capture();
      if (shot) setScreenshot(shot);
      else setError("Couldn't capture this screen. You can still send the report.");
    } finally {
      setCapturing(false);
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (description.trim().length < 3) {
      setError("Tell us a little about what went wrong.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const report = await submit({
        description,
        includeContext,
        screenshot,
        extraContext: extraContext || undefined,
      });
      toast.success("Bug report sent. Thank you!", {
        description: report?.count > 1 ? "We already had this one — your report was added to it." : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || "Couldn't send the report. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const contextPreview = showContext
    ? JSON.stringify({ ...buildDiagnosticContext(), ...(extraContext || {}) }, null, 2)
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-bug-squasher-ui=""
        className="max-w-lg rounded-none border-primary/30 bg-[#090912] font-mono text-primary/90"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-primary">
            <Bug className="h-4 w-4" aria-hidden="true" />
            Report a bug
          </DialogTitle>
          <DialogDescription className="text-xs text-primary/50">
            What happened, and what did you expect? Your messages and memories are never attached.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-primary/60">Description</span>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={5}
              autoFocus
              placeholder="e.g. I sent Asami a message and the reply never appeared."
              className="rounded-none border-primary/30 bg-black/40 text-sm text-primary/90"
            />
          </label>

          <div className="space-y-2 border border-primary/15 p-3">
            <label className="flex items-start gap-2 text-xs text-primary/80">
              <Checkbox
                checked={includeContext}
                onCheckedChange={(v) => setIncludeContext(v === true)}
                aria-label="Attach diagnostic info"
              />
              <span>
                Attach diagnostic info
                <span className="block text-[10px] text-primary/40">
                  Screen, app version, browser, recent activity and errors. Tokens and emails are removed.
                </span>
              </span>
            </label>
            {includeContext && (
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                className="text-[10px] uppercase tracking-[0.2em] text-primary/50 underline hover:text-primary"
              >
                {showContext ? "Hide details" : "See what's attached"}
              </button>
            )}
            {showContext && (
              <pre
                data-testid="bug-context-preview"
                className="max-h-40 overflow-auto whitespace-pre-wrap break-all bg-black/50 p-2 text-[10px] text-primary/60"
              >
                {contextPreview}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {screenshot ? (
              <div className="relative">
                <img src={screenshot} alt="Screenshot to attach" className="h-20 border border-primary/30" />
                <button
                  type="button"
                  onClick={() => setScreenshot(null)}
                  className="absolute -right-2 -top-2 rounded-full border border-primary/40 bg-black p-0.5 text-primary/70"
                  aria-label="Remove screenshot"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={takeScreenshot}
                disabled={capturing}
                className="flex items-center gap-2 border border-primary/30 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-primary/70 hover:border-primary/60 disabled:opacity-50"
              >
                {capturing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                Attach screenshot
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-primary/50 hover:text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex items-center gap-2 border border-primary/40 bg-primary/15 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-primary hover:bg-primary/25 disabled:opacity-50"
            >
              {sending && <Loader2 className="h-3 w-3 animate-spin" />}
              Send report
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
