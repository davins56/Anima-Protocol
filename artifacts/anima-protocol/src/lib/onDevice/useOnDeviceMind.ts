/**
 * Chat upgrade 3: React state for the on-device mind.
 * Nothing downloads until the user presses the button: the weights are
 * gigabytes. Loading is local-only and fails closed (no cloud fallback).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadOnDeviceEngine, removeOnDeviceModel, type ChatTurn, type LoadProgress, type OnDeviceEngine } from "./engine";
import { probeDevice, pickOnDeviceModel, type DeviceProfile, type ModelPick } from "./profile";
import { modelById } from "./models";

export type OnDevicePhase = "probing" | "idle" | "loading" | "ready" | "unavailable" | "generating";

const STORAGE_KEY = "anima.onDeviceMind.v1";

interface Stored {
  modelId?: string | null;
}

function readStored(): Stored {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(next: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

export function useOnDeviceMind() {
  const [phase, setPhase] = useState<OnDevicePhase>("probing");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [pick, setPick] = useState<ModelPick | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [failures, setFailures] = useState<{ model: string; message: string }[]>([]);
  const [modelOverride, setModelOverride] = useState<string | null>(() => readStored().modelId ?? null);
  const engineRef = useRef<OnDeviceEngine | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const genAbort = useRef<AbortController | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void probeDevice().then((p) => {
      if (!live) return;
      setProfile(p);
      const chosen = pickOnDeviceModel(p, modelOverride);
      setPick(chosen);
      setPhase(chosen.model ? "idle" : "unavailable");
    });
    return () => {
      live = false;
    };
  }, [modelOverride]);

  useEffect(
    () => () => {
      loadAbort.current?.abort();
      genAbort.current?.abort();
      void engineRef.current?.unload().catch(() => {});
      engineRef.current = null;
    },
    [],
  );

  const chooseModel = useCallback((id: string | null) => {
    setModelOverride(id);
    writeStored({ modelId: id });
  }, []);

  const load = useCallback(async () => {
    if (!pick?.candidates.length || phase === "loading") return;
    loadAbort.current?.abort();
    const ctrl = new AbortController();
    loadAbort.current = ctrl;
    setPhase("loading");
    setFailures([]);
    const result = await loadOnDeviceEngine(pick.candidates, { onProgress: setProgress, signal: ctrl.signal });
    if (ctrl.signal.aborted) {
      setPhase("idle");
      return;
    }
    setFailures(result.failures.map((f) => ({ model: f.model.label, message: f.message })));
    if (result.engine) {
      engineRef.current = result.engine;
      setLoadedId(result.engine.model.id);
      setPhase("ready");
    } else {
      setPhase("unavailable");
    }
  }, [pick, phase]);

  const cancelLoad = useCallback(() => {
    loadAbort.current?.abort();
  }, []);

  const generate = useCallback(
    async (messages: ChatTurn[], onToken?: (delta: string, full: string) => void) => {
      const engine = engineRef.current;
      if (!engine) throw new Error("No on-device model is loaded.");
      genAbort.current?.abort();
      const ctrl = new AbortController();
      genAbort.current = ctrl;
      setPhase("generating");
      try {
        return await engine.generate(messages, { signal: ctrl.signal, onToken });
      } finally {
        setPhase(engineRef.current ? "ready" : "idle");
      }
    },
    [],
  );

  const stop = useCallback(() => {
    genAbort.current?.abort();
  }, []);

  const unload = useCallback(async () => {
    genAbort.current?.abort();
    const engine = engineRef.current;
    engineRef.current = null;
    setLoadedId(null);
    if (engine) await engine.unload().catch(() => {});
    setPhase(pick?.model ? "idle" : "unavailable");
  }, [pick]);

  const removeFromDevice = useCallback(async () => {
    await unload();
    const targets = new Set([...(pick?.candidates || [])].map((m) => m.id));
    for (const id of targets) {
      const model = modelById(id);
      if (model) await removeOnDeviceModel(model).catch(() => {});
    }
  }, [pick, unload]);

  return {
    phase,
    profile,
    pick,
    progress,
    failures,
    loadedModel: modelById(loadedId),
    modelOverride,
    chooseModel,
    load,
    cancelLoad,
    generate,
    stop,
    unload,
    removeFromDevice,
  };
}
