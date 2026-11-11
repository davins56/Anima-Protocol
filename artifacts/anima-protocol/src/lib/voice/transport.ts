/**
 * Realtime transport adapter. `XaiRealtimeTransport` uses only documented
 * docs.x.ai behaviour (verified 2026-10-22):
 *   - wss://api.x.ai/v1/realtime?model=… with subprotocol `xai-client-secret.<token>`
 *   - client: session.update, input_audio_buffer.append, conversation.item.create,
 *     conversation.item.truncate, response.create, response.cancel
 *   - server: session.created/updated, conversation.created, input_audio_buffer.speech_started/stopped,
 *     conversation.item.input_audio_transcription.completed, response.created,
 *     response.output_item.added, response.output_audio.delta, response.output_audio_transcript.delta/done,
 *     response.function_call_arguments.done, response.done, error
 *   - session resumption via ?conversation_id= + session.resumption.enabled
 * Anything undocumented (e.g. WebRTC transport, server-pushed token refresh)
 * must be added as another adapter — TODO(voice-webrtc) — never guessed here.
 */
export type RealtimeEvent = { type: string; [k: string]: any };

export interface VoiceTransport {
  connect(opts: { url: string; token: string; conversationId?: string | null }): Promise<void>;
  send(event: RealtimeEvent): void;
  close(code?: number): void;
  readonly open: boolean;
  onEvent?: (e: RealtimeEvent) => void;
  onClose?: (info: { code: number; reason: string; clean: boolean }) => void;
}

export class XaiRealtimeTransport implements VoiceTransport {
  private ws: WebSocket | null = null;
  onEvent?: (e: RealtimeEvent) => void;
  onClose?: (info: { code: number; reason: string; clean: boolean }) => void;
  private closingOnPurpose = false;

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect({ url, token, conversationId }: { url: string; token: string; conversationId?: string | null }): Promise<void> {
    const u = new URL(url);
    if (u.protocol !== "wss:" || u.hostname !== "api.x.ai" || u.pathname !== "/v1/realtime") {
      return Promise.reject(new Error("Refusing non-xAI realtime URL"));
    }
    if (conversationId) u.searchParams.set("conversation_id", conversationId);
    this.closingOnPurpose = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(u.toString(), [`xai-client-secret.${token}`]);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") return; // json transport only
        try {
          this.onEvent?.(JSON.parse(m.data));
        } catch {
          /* ignore malformed */
        }
      };
      ws.onerror = () => {
        if (!opened) reject(new Error("Voice connection failed"));
      };
      ws.onclose = (e) => {
        this.ws = null;
        if (!opened) reject(new Error(`Voice connection closed (${e.code})`));
        this.onClose?.({ code: e.code, reason: e.reason, clean: this.closingOnPurpose });
      };
    });
  }

  send(event: RealtimeEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  close(code = 1000) {
    this.closingOnPurpose = true;
    this.ws?.close(code);
    this.ws = null;
  }
}
