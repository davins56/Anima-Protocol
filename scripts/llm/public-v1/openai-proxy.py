#!/usr/bin/env python3
"""Bearer proxy in front of a local OpenAI-compatible LLM (Ollama / vLLM).

Unauthenticated /v1/* → 401. /healthz is open. Does not log the token.

Ollama's OpenAI layer (`/v1/chat/completions`) unmarshals a struct with no
`keep_alive` field, so the Worker field is dropped and anima-chat unloads
after the server default (~5m). Cold generate on the droplet is ~15–18s.
This proxy maps that one route onto native `/api/chat`, which honors
`keep_alive`, and streams the reply instead of buffering the full generate
(buffering made the Worker open budget cover decode as well as the load).

Set ANIMA_LLM_PROXY_NATIVE=0 to pass `/v1/chat/completions` through unchanged
(vLLM). Set ANIMA_OLLAMA_KEEP_ALIVE=0 to stop injecting a default.
"""
from __future__ import annotations

import http.client
import http.server
import json
import os
import sys
from typing import Any

UPSTREAM_HOST = os.environ.get("ANIMA_LLM_UPSTREAM", "127.0.0.1:11434")
LISTEN_HOST = os.environ.get("ANIMA_LLM_PROXY_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("ANIMA_LLM_PROXY_PORT", "18000"))
TOKEN_PATH = os.environ.get(
    "ANIMA_LLM_PROXY_TOKEN_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy-token"),
)
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}
DEFAULT_KEEP_ALIVE = "30m"

TOKEN = ""


def load_token() -> str:
    env = os.environ.get("ANIMA_LLM_PROXY_TOKEN", "").strip()
    if env:
        return env
    try:
        with open(TOKEN_PATH, encoding="utf-8") as f:
            token = f.read().strip()
    except OSError as e:
        raise SystemExit(f"missing proxy token ({TOKEN_PATH}): {e}") from e
    if not token:
        raise SystemExit(f"empty proxy token ({TOKEN_PATH})")
    return token


def default_keep_alive() -> str:
    raw = os.environ.get("ANIMA_OLLAMA_KEEP_ALIVE", DEFAULT_KEEP_ALIVE).strip()
    if not raw or raw.lower() in {"0", "off", "false", "no"}:
        return ""
    return raw


def native_chat_enabled() -> bool:
    raw = os.environ.get("ANIMA_LLM_PROXY_NATIVE", "1").strip().lower()
    return raw not in {"0", "off", "false", "no"}


def is_chat_completions_path(path: str) -> bool:
    trimmed = path.rstrip("/") or "/"
    return trimmed == "/v1/chat/completions"


def openai_chat_to_native(body: dict[str, Any], keep_alive: str) -> dict[str, Any]:
    """Map an OpenAI chat-completions body onto Ollama `/api/chat`."""
    native: dict[str, Any] = {
        "model": body.get("model") or "anima-chat",
        "messages": body.get("messages") if isinstance(body.get("messages"), list) else [],
        "stream": bool(body.get("stream")),
    }
    requested = body.get("keep_alive")
    if isinstance(requested, str) and requested.strip():
        native["keep_alive"] = requested.strip()
    elif isinstance(requested, (int, float)) and not isinstance(requested, bool):
        native["keep_alive"] = requested
    elif keep_alive:
        native["keep_alive"] = keep_alive

    options: dict[str, Any] = {}
    if isinstance(body.get("temperature"), (int, float)) and not isinstance(body.get("temperature"), bool):
        options["temperature"] = body["temperature"]
    max_tokens = body.get("max_tokens", body.get("max_completion_tokens"))
    if isinstance(max_tokens, (int, float)) and not isinstance(max_tokens, bool):
        options["num_predict"] = int(max_tokens)
    if isinstance(body.get("top_p"), (int, float)) and not isinstance(body.get("top_p"), bool):
        options["top_p"] = body["top_p"]
    stop = body.get("stop")
    if isinstance(stop, str) and stop:
        options["stop"] = [stop]
    elif isinstance(stop, list) and stop:
        options["stop"] = [s for s in stop if isinstance(s, str)]
    if options:
        native["options"] = options
    if isinstance(body.get("tools"), list) and body["tools"]:
        native["tools"] = body["tools"]
    response_format = body.get("response_format")
    if isinstance(response_format, dict) and response_format.get("type") == "json_object":
        native["format"] = "json"
    return native


def _stringify_arguments(arguments: Any) -> str:
    if isinstance(arguments, str):
        return arguments
    if arguments is None:
        return "{}"
    return json.dumps(arguments, separators=(",", ":"))


def tool_calls_to_openai(tool_calls: Any) -> list[dict[str, Any]]:
    if not isinstance(tool_calls, list):
        return []
    out: list[dict[str, Any]] = []
    for index, call in enumerate(tool_calls):
        if not isinstance(call, dict):
            continue
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        out.append(
            {
                "id": call.get("id") or f"call_{index}",
                "index": call.get("index", index),
                "type": call.get("type") or "function",
                "function": {
                    "name": fn.get("name") or "",
                    "arguments": _stringify_arguments(fn.get("arguments")),
                },
            }
        )
    return out


def _finish_reason(payload: dict[str, Any], message: dict[str, Any]) -> str:
    if tool_calls_to_openai(message.get("tool_calls")):
        return "tool_calls"
    reason = str(payload.get("done_reason") or "stop")
    if reason == "length":
        return "length"
    return "stop"


def native_message_to_openai(message: dict[str, Any]) -> dict[str, Any]:
    content = message.get("content")
    openai_message: dict[str, Any] = {
        "role": message.get("role") or "assistant",
        "content": content if isinstance(content, str) else ("" if content is None else str(content)),
    }
    calls = tool_calls_to_openai(message.get("tool_calls"))
    if calls:
        openai_message["tool_calls"] = calls
    return openai_message


def native_chat_to_openai(payload: dict[str, Any]) -> dict[str, Any]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    model = payload.get("model") or "anima-chat"
    return {
        "id": "chatcmpl-anima",
        "object": "chat.completion",
        "created": 0,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": native_message_to_openai(message),
                "finish_reason": _finish_reason(payload, message),
            }
        ],
    }


def native_line_to_sse(line: str, model_fallback: str) -> str | None:
    raw = line.strip()
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get("error"), str):
        err = {"error": {"message": payload["error"], "type": "api_error"}}
        return "data: " + json.dumps(err, separators=(",", ":")) + "\n\n"
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    model = payload.get("model") or model_fallback
    done = bool(payload.get("done"))
    if done:
        chunk = {
            "id": "chatcmpl-anima",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": _finish_reason(payload, message),
                }
            ],
        }
        return "data: " + json.dumps(chunk, separators=(",", ":")) + "\n\n"
    content = message.get("content")
    text = content if isinstance(content, str) else ""
    calls = tool_calls_to_openai(message.get("tool_calls"))
    if not text and not calls:
        return None
    delta: dict[str, Any] = {}
    if text:
        delta["content"] = text
    if calls:
        delta["tool_calls"] = calls
    chunk = {
        "id": "chatcmpl-anima",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }
    return "data: " + json.dumps(chunk, separators=(",", ":")) + "\n\n"


def native_ndjson_to_sse(text: str, model_fallback: str) -> str:
    parts: list[str] = []
    for line in text.splitlines():
        block = native_line_to_sse(line, model_fallback)
        if block:
            parts.append(block)
    parts.append("data: [DONE]\n\n")
    return "".join(parts)


def openai_error(message: str, status: int = 502) -> tuple[int, bytes]:
    body = json.dumps(
        {"error": {"message": message, "type": "api_error"}},
        separators=(",", ":"),
    ).encode("utf-8")
    return status, body


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
            self.wfile.flush()

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._handle()

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle()

    def _authorized(self) -> bool:
        return self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _handle(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/healthz", "/health"):
            self._send(200, b"ok", "text/plain")
            return
        native_api = path == "/api/chat" or path == "/api/generate" or path.startswith("/api/")
        openai_api = path == "/v1" or path.startswith("/v1/")
        if not openai_api and not (native_api and path in ("/api/chat", "/api/generate")):
            self._send(404, b'{"error":{"message":"not found"}}', "application/json")
            return
        if not self._authorized():
            self._send(
                401,
                b'{"error":{"message":"unauthorized","type":"auth"}}',
                "application/json",
            )
            return

        body = self._read_body()
        if (
            self.command == "POST"
            and is_chat_completions_path(path)
            and native_chat_enabled()
        ):
            self._translate_chat(body)
            return
        self._passthrough(self.command, self.path, body)

    def _translate_chat(self, body: bytes) -> None:
        try:
            parsed = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            status, payload = openai_error("chat completions body must be JSON", 400)
            self._send(status, payload, "application/json")
            return
        if not isinstance(parsed, dict):
            status, payload = openai_error("chat completions body must be a JSON object", 400)
            self._send(status, payload, "application/json")
            return

        native = openai_chat_to_native(parsed, default_keep_alive())
        upstream_body = json.dumps(native, separators=(",", ":")).encode("utf-8")
        headers = {
            "Host": "127.0.0.1:11434",
            "Content-Type": "application/json",
            "Accept": "application/x-ndjson, application/json",
            "Connection": "close",
        }
        conn = http.client.HTTPConnection(UPSTREAM_HOST, timeout=300)
        self._response_started = False
        try:
            conn.request("POST", "/api/chat", body=upstream_body, headers=headers)
            resp = conn.getresponse()
            if resp.status != 200:
                raw = resp.read()
                message = _upstream_error_message(raw) or resp.reason or "upstream chat failed"
                status, payload = openai_error(message, resp.status or 502)
                self._send(status, payload, "application/json")
                return
            if native.get("stream"):
                self._stream_native_chat(resp, str(native.get("model") or "anima-chat"))
                return
            raw = resp.read()
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except (UnicodeDecodeError, json.JSONDecodeError):
                status, err = openai_error("Ollama returned a non-JSON chat body", 502)
                self._send(status, err, "application/json")
                return
            if isinstance(payload, dict) and isinstance(payload.get("error"), str):
                status, err = openai_error(payload["error"], 502)
                self._send(status, err, "application/json")
                return
            if not isinstance(payload, dict):
                status, err = openai_error("Ollama returned an unexpected chat body", 502)
                self._send(status, err, "application/json")
                return
            encoded = json.dumps(native_chat_to_openai(payload), separators=(",", ":")).encode("utf-8")
            self._send(200, encoded, "application/json")
        except Exception as exc:  # noqa: BLE001 — proxy must return JSON, not drop the socket
            if getattr(self, "_response_started", False):
                return
            if not getattr(self.wfile, "closed", False):
                status, payload = openai_error(f"LLM proxy failed: {exc}", 502)
                try:
                    self._send(status, payload, "application/json")
                except Exception:
                    return
        finally:
            conn.close()

    def _stream_native_chat(self, resp: http.client.HTTPResponse, model: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self._response_started = True
        while True:
            line = resp.readline()
            if not line:
                break
            block = native_line_to_sse(line.decode("utf-8", errors="replace"), model)
            if not block:
                continue
            self.wfile.write(block.encode("utf-8"))
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def _passthrough(self, method: str, path: str, body: bytes) -> None:
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        headers["Host"] = "127.0.0.1:11434"
        headers["Connection"] = "close"
        if body:
            headers["Content-Length"] = str(len(body))
        conn = http.client.HTTPConnection(UPSTREAM_HOST, timeout=300)
        try:
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            self.send_response(resp.status, resp.reason)
            for key, value in resp.getheaders():
                if key.lower() in HOP_BY_HOP:
                    continue
                self.send_header(key, value)
            self.send_header("Connection", "close")
            self.end_headers()
            if method == "HEAD":
                return
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        finally:
            conn.close()


def _upstream_error_message(raw: bytes) -> str:
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        text = raw.decode("utf-8", errors="replace").strip()
        return text[:300]
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, str):
            return err
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            return err["message"]
    return raw.decode("utf-8", errors="replace").strip()[:300]


def main() -> None:
    global TOKEN
    TOKEN = load_token()
    server = http.server.ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(
        f"anima openai proxy listening on http://{LISTEN_HOST}:{LISTEN_PORT} -> {UPSTREAM_HOST}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
