/**
 * Full-duplex voice with a companion over the xAI Grok Voice realtime API.
 * - Ephemeral token + session payload from /api/voice/:id/session (key stays server-side)
 * - AudioWorklet mic capture (24 kHz PCM16, buffered until the socket is ready)
 * - Streamed playback; server VAD; barge-in = flush local playback + conversation.item.truncate
 *   (docs: in VAD mode the server cancels the response itself, so no response.cancel)
 * - Function tools → stacked modules; outputs sent, then response.create after playback drains
 * - Turns logged to memory_events; token prefetch + reconnect with session resumption
 * - Latency: end-of-speech → first audio byte / first audible frame
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { XaiRealtimeTransport, type RealtimeEvent, type VoiceTransport } from "@/lib/voice/transport";
import { MicCapture } from "@/lib/voice/micCapture";
import { StreamPlayer } from "@/lib/voice/playback";
import { loadWorklets } from "@/lib/voice/worklets";
import { base64ToBytes, bytesToBase64 } from "@/lib/voice/pcm";
import { LatencyTracker, type LatencyStats } from "@/lib/voice/latency";
import { logVoiceTurn, requestVoiceSession, type VoiceSessionGrant } from "@/lib/voice/voiceApi";
import { runVoiceTool, type ToolContext } from "@/lib/voice/tools";

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

const RATE = 24_000;
const MAX_EARLY_CHUNKS = 100; // ~10 s at 100 ms
const MAX_RECONNECTS = 5;

type Options = {
  characterId: string;
  characterName?: string;
  sessionId?: string | null;
  navigate: (to: string) => void;
  /** Inject a different transport (tests / future WebRTC adapter). */
  transportFactory?: () => VoiceTransport;
};

export function useSerenityVoice({ characterId, characterName, sessionId, navigate, transportFactory }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [captions, setCaptions] = useState<{ user: string; assistant: string }>({ user: "", assistant: "" });
  const [latency, setLatency] = useState<LatencyStats>({ count: 0, p50: null, p95: null, last: null });
  const [toolActivity, setToolActivity] = useState<string | null>(null);

  const r = useRef({
    ctx: null as AudioContext | null,
    mic: null as MicCapture | null,
    player: null as StreamPlayer | null,
    transport: null as VoiceTransport | null,
    grant: null as VoiceSessionGrant | null,
    nextGrant: null as Promise<VoiceSessionGrant> | null,
    refreshTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    ready: false,
    early: [] as Int16Array[],
    conversationId: null as string | null,
    assistantItemId: null as string | null,
    responseId: null as string | null,
    userText: "",
    assistantText: "",
    interrupted: false,
    pendingCalls: [] as Array<{ call_id: string; name: string; arguments: string }>,
    reconnects: 0,
    stopping: false,
    latency: new LatencyTracker(),
    lastLatency: null as number | null,
  });
  const ctxRef = useRef<ToolContext>({ characterId, characterName, sessionId, navigate });
  ctxRef.current = { characterId, characterName, sessionId, navigate };

  const send = (e: RealtimeEvent) => r.current.transport?.send(e);

  const sendAudio = (pcm: Int16Array) => {
    const s = r.current;
    if (s.transport?.open && s.ready) {
      send({ type: "input_audio_buffer.append", audio: bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) });
    } else {
      s.early.push(pcm);
      if (s.early.length > MAX_EARLY_CHUNKS) s.early.shift();
    }
  };

  const scheduleTokenPrefetch = (grant: VoiceSessionGrant) => {
    const s = r.current;
    clearTimeout(s.refreshTimer);
    const msLeft = grant.expires_at * 1000 - Date.now();
    // Tokens only authenticate the connect; prefetch so a reconnect never waits on the Worker.
    s.refreshTimer = setTimeout(() => {
      s.nextGrant = requestVoiceSession(characterId, sessionId).catch(() => null as unknown as VoiceSessionGrant);
    }, Math.max(5_000, msLeft - 30_000));
  };

  const freshGrant = async (): Promise<VoiceSessionGrant> => {
    const s = r.current;
    const pre = s.nextGrant ? await s.nextGrant : null;
    s.nextGrant = null;
    if (pre && pre.expires_at * 1000 - Date.now() > 10_000) return pre;
    return requestVoiceSession(characterId, sessionId);
  };

  const logTurn = () => {
    const s = r.current;
    const user = s.userText.trim();
    const assistant = s.assistantText.trim();
    if (!s.responseId || (!user && !assistant)) return;
    void logVoiceTurn(characterId, {
      session_id: sessionId || null,
      turn_id: `${s.conversationId || "conv"}:${s.responseId}`,
      user_text: user,
      assistant_text: assistant,
      interrupted: s.interrupted,
      latency_ms: s.lastLatency,
    }).catch(() => {});
    s.userText = "";
  };

  const runPendingTools = async () => {
    const s = r.current;
    const calls = s.pendingCalls.splice(0);
    if (!calls.length) return false;
    setStatus("thinking");
    setToolActivity(calls.map((c) => c.name).join(", "));
    const outputs = await Promise.all(calls.map((c) => runVoiceTool(c.name, c.arguments, ctxRef.current)));
    calls.forEach((c, i) =>
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: outputs[i] } }),
    );
    // Docs: wait for current playback before response.create to avoid overlapping audio.
    await s.player?.waitForDrain();
    send({ type: "response.create" });
    setToolActivity(null);
    return true;
  };

  const onEvent = (e: RealtimeEvent) => {
    const s = r.current;
    switch (e.type) {
      case "conversation.created":
        s.conversationId = e.conversation?.id || s.conversationId;
        break;
      case "session.updated": {
        s.ready = true;
        for (const chunk of s.early.splice(0)) sendAudio(chunk);
        setStatus("listening");
        break;
      }
      case "input_audio_buffer.speech_started": {
        if (s.player?.playing && s.assistantItemId) {
          const heard = s.player.playedMsForItem();
          s.player.flush();
          send({ type: "conversation.item.truncate", item_id: s.assistantItemId, content_index: 0, audio_end_ms: heard });
          s.interrupted = true;
        }
        setStatus("user-speaking");
        setCaptions((c) => ({ ...c, user: "" }));
        break;
      }
      case "input_audio_buffer.speech_stopped":
        s.latency.markEndOfSpeech();
        setStatus("thinking");
        break;
      case "conversation.item.input_audio_transcription.completed":
        s.userText = String(e.transcript || "");
        setCaptions((c) => ({ ...c, user: s.userText }));
        break;
      case "response.created":
        s.responseId = e.response?.id || e.response_id || `${Date.now()}`;
        s.assistantText = "";
        s.interrupted = false;
        break;
      case "response.output_item.added":
        if (e.item?.type === "message") {
          s.assistantItemId = e.item.id;
          s.player?.beginItem();
        }
        break;
      case "response.output_audio.delta":
        if (typeof e.delta === "string") {
          s.latency.markFirstByte();
          const bytes = base64ToBytes(e.delta);
          s.player?.push(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1));
          setStatus("speaking");
        }
        break;
      case "response.output_audio_transcript.delta":
        s.assistantText += String(e.delta || "");
        setCaptions((c) => ({ ...c, assistant: s.assistantText }));
        break;
      case "response.function_call_arguments.done":
        s.pendingCalls.push({ call_id: e.call_id, name: e.name, arguments: e.arguments || "{}" });
        break;
      case "response.done":
        logTurn();
        void runPendingTools().then((ran) => {
          if (!ran) void s.player?.waitForDrain().then(() => setStatus((st) => (st === "speaking" || st === "thinking" ? "listening" : st)));
        });
        break;
      case "error":
        // Most realtime errors are recoverable; surface without tearing down.
        setError(String(e.error?.message || e.message || "Voice error"));
        break;
    }
  };

  const connect = async (grant: VoiceSessionGrant) => {
    const s = r.current;
    s.ready = false;
    const t = transportFactory ? transportFactory() : new XaiRealtimeTransport();
    s.transport = t;
    t.onEvent = onEvent;
    t.onClose = ({ clean }) => {
      if (clean || s.stopping) return;
      void reconnect();
    };
    await t.connect({ url: grant.url, token: grant.token, conversationId: s.conversationId });
    send({ type: "session.update", session: { ...grant.session, resumption: { enabled: true } } });
    s.grant = grant;
    s.reconnects = 0;
    scheduleTokenPrefetch(grant);
  };

  const reconnect = async () => {
    const s = r.current;
    if (s.stopping) return;
    if (s.reconnects >= MAX_RECONNECTS) {
      setStatus("error");
      setError("Voice connection lost.");
      return;
    }
    setStatus("reconnecting");
    const wait = Math.min(8000, 500 * 2 ** s.reconnects++);
    await new Promise((res) => setTimeout(res, wait));
    try {
      await connect(await freshGrant());
    } catch {
      void reconnect();
    }
  };

  const start = useCallback(async () => {
    const s = r.current;
    if (s.transport) return;
    s.stopping = false;
    setError(null);
    setStatus("connecting");
    // Create the AudioContext synchronously inside the user gesture (iOS/iPadOS).
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: "interactive" });
    s.ctx = ctx;
    try {
      const grantP = requestVoiceSession(characterId, sessionId);
      await loadWorklets(ctx);
      await ctx.resume();
      s.player = new StreamPlayer(ctx, RATE);
      s.player.onFirstAudible = () => s.latency.markFirstAudible();
      s.latency.onSample = (sample, stats) => {
        s.lastLatency = Math.round(sample.toFirstAudible ?? sample.toFirstByte);
        setLatency(stats);
      };
      s.mic = new MicCapture(ctx, RATE, sendAudio);
      // Mic and socket in parallel (docs best practice); early audio is buffered.
      await Promise.all([s.mic.start(), grantP.then((g) => connect(g))]);
    } catch (e) {
      setError((e as { code?: string; message?: string }).code === "voice_disabled" ? "Voice is not enabled on this server." : (e as Error).message);
      setStatus("error");
      stopInternal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, sessionId]);

  const stopInternal = () => {
    const s = r.current;
    s.stopping = true;
    clearTimeout(s.refreshTimer);
    s.transport?.close();
    s.transport = null;
    s.mic?.stop();
    s.mic = null;
    s.player?.close();
    s.player = null;
    void s.ctx?.close().catch(() => {});
    s.ctx = null;
    s.ready = false;
    s.early = [];
    s.pendingCalls = [];
  };

  const stop = useCallback(() => {
    stopInternal();
    setStatus("idle");
  }, []);

  const setMuted = useCallback((m: boolean) => {
    if (r.current.mic) r.current.mic.muted = m;
    setMutedState(m);
  }, []);

  /** Manual interrupt button (same as barge-in). */
  const interrupt = useCallback(() => {
    const s = r.current;
    if (s.player?.playing && s.assistantItemId) {
      const heard = s.player.playedMsForItem();
      s.player.flush();
      send({ type: "conversation.item.truncate", item_id: s.assistantItemId, content_index: 0, audio_end_ms: heard });
      s.interrupted = true;
    }
  }, []);

  useEffect(() => () => stopInternal(), []);

  return { status, error, muted, setMuted, start, stop, interrupt, captions, latency, toolActivity, micLevel: () => r.current.mic?.level ?? 0 };
}
