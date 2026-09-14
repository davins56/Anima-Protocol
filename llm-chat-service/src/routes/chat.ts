import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.js";
import { errorMessage } from "../middleware/errorHandler.js";
import { requestLlm } from "../services/llmService.js";
import { normalizeMessages } from "../services/promptService.js";
import type { ChatMessage, ChatRequest, FeedbackRequest } from "../types/index.js";

const conversations = new Map<string, ChatMessage[]>();
const feedback: FeedbackRequest[] = [];
let requestCount = 0;
let totalLatencyMs = 0;

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (body.length > 1_000_000) throw new Error("Request body is too large");
  return body ? JSON.parse(body) : {};
}

function authorized(request: IncomingMessage): boolean {
  return !config.apiKey || request.headers.authorization === `Bearer ${config.apiKey}`;
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!authorized(request)) { json(response, 401, { error: "Unauthorized" }); return; }
  if (request.method === "GET" && request.url === "/healthz") { json(response, 200, { status: "ok", model: config.llmModel }); return; }
  if (request.method === "GET" && request.url === "/metrics") {
    json(response, 200, { requests: requestCount, average_latency_ms: requestCount ? Math.round(totalLatencyMs / requestCount) : 0, conversations: conversations.size, feedback: feedback.length });
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/history")) {
    const id = new URL(request.url, "http://localhost").searchParams.get("conversation_id");
    json(response, 200, { conversation_id: id, messages: id ? conversations.get(id) ?? [] : [] });
    return;
  }
  if (request.method === "POST" && request.url === "/api/feedback") {
    const body = await readBody(request) as Partial<FeedbackRequest>;
    if (!body.conversation_id || (body.rating !== "up" && body.rating !== "down")) { json(response, 400, { error: "conversation_id and rating are required" }); return; }
    feedback.push({ conversation_id: body.conversation_id, message_id: body.message_id, rating: body.rating, comment: body.comment?.slice(0, 1_000) });
    json(response, 202, { accepted: true });
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/chat") { json(response, 404, { error: "Not found" }); return; }

  try {
    const body = await readBody(request) as ChatRequest;
    const conversationId = body.conversation_id || randomUUID();
    const previous = conversations.get(conversationId) ?? [];
    const supplied = body.messages ?? (body.message ? [{ role: "user", content: body.message }] : []);
    const messages = normalizeMessages([...previous, ...supplied], config.maxContextMessages, config.maxMessageChars);
    if (!messages.some((message) => message.role === "user")) { json(response, 400, { error: "A user message is required" }); return; }
    if (body.system_prompt?.trim()) messages.unshift({ role: "system", content: body.system_prompt.trim().slice(0, config.maxMessageChars) });

    const result = await requestLlm(messages, body.temperature);
    requestCount += 1;
    totalLatencyMs += result.durationMs;
    if (!result.response.ok || !result.response.body) { json(response, result.response.status >= 400 ? result.response.status : 502, { error: "The self-hosted model is unavailable" }); return; }

    const assistantChunks: string[] = [];
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Conversation-Id": conversationId });
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line.slice(6).trim() === "[DONE]") continue;
        try {
          const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
          if (typeof delta === "string") { assistantChunks.push(delta); response.write(`data: ${JSON.stringify({ content: delta })}\n\n`); }
        } catch { /* Ignore incomplete provider-specific SSE frames. */ }
      }
    }
    const assistant = assistantChunks.join("").trim();
    conversations.set(conversationId, [...messages, { role: "assistant" as const, content: assistant }].slice(-config.maxContextMessages));
    response.write(`data: ${JSON.stringify({ conversation_id: conversationId, done: true })}\n\ndata: [DONE]\n\n`);
    response.end();
  } catch (error) {
    if (!response.headersSent) json(response, 504, { error: errorMessage(error) });
    else response.end();
  }
}

export function resetStateForTests(): void {
  conversations.clear();
  feedback.length = 0;
  requestCount = 0;
  totalLatencyMs = 0;
}
