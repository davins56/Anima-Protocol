import { useCallback, useRef, useState } from "react";
import { generatePhoto, type GeneratePhotoInput, type PhotoEvent } from "@/lib/photo/photoApi";

export type PhotoGenState = {
  phase: "idle" | "queued" | "running" | "done" | "error";
  imageId?: string;
  url?: string;
  prompt?: string;
  strategy?: string;
  queuePosition?: number;
  log?: string;
  error?: string;
  errorCode?: string;
};

/** Drives one streamed generation at a time; cancel aborts the SSE request. */
export function usePhotoGeneration() {
  const [state, setState] = useState<PhotoGenState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const onEvent = useCallback((e: PhotoEvent) => {
    setState((prev) => {
      switch (e.type) {
        case "accepted":
          return { ...prev, phase: "queued", imageId: e.imageId, prompt: e.prompt, strategy: e.strategy };
        case "status":
          return {
            ...prev,
            phase: e.status === "IN_QUEUE" ? "queued" : "running",
            queuePosition: e.queuePosition,
            log: e.log || prev.log,
          };
        case "image":
          return { ...prev, phase: "done", url: e.url, imageId: e.imageId };
        case "error":
          return { ...prev, phase: "error", error: e.error, errorCode: e.code };
        default:
          return prev;
      }
    });
  }, []);

  const run = useCallback(
    async (input: GeneratePhotoInput) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: "queued" });
      try {
        return await generatePhoto(input, { onEvent, signal: controller.signal });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setState({ phase: "idle" });
          return null;
        }
        const e = err as Error & { code?: string };
        setState((prev) => ({ ...prev, phase: "error", error: e.message, errorCode: e.code }));
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [onEvent],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, run, cancel, reset };
}
