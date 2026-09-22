#!/usr/bin/env python3
"""Proxy maps OpenAI chat completions onto Ollama /api/chat with keep_alive."""
from __future__ import annotations

import http.client
import importlib.util
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "openai_proxy",
    Path(__file__).with_name("openai-proxy.py"),
)
assert _SPEC and _SPEC.loader
proxy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(proxy)


class TransformTests(unittest.TestCase):
    def test_maps_keep_alive_temperature_and_max_tokens(self) -> None:
        native = proxy.openai_chat_to_native(
            {
                "model": "anima-chat",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
                "temperature": 0.85,
                "max_tokens": 1024,
                "keep_alive": "30m",
            },
            "30m",
        )
        self.assertEqual(native["model"], "anima-chat")
        self.assertTrue(native["stream"])
        self.assertEqual(native["keep_alive"], "30m")
        self.assertEqual(native["options"]["temperature"], 0.85)
        self.assertEqual(native["options"]["num_predict"], 1024)

    def test_injects_default_keep_alive_when_openai_body_omits_it(self) -> None:
        native = proxy.openai_chat_to_native(
            {"model": "anima-chat", "messages": [{"role": "user", "content": "hi"}]},
            "30m",
        )
        self.assertEqual(native["keep_alive"], "30m")
        self.assertFalse(native["stream"])

    def test_nonstream_openai_shape_and_tool_arguments(self) -> None:
        out = proxy.native_chat_to_openai(
            {
                "model": "anima-chat",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "remember", "arguments": {"fact": "rain"}}}
                    ],
                },
                "done": True,
                "done_reason": "stop",
            }
        )
        choice = out["choices"][0]
        self.assertEqual(choice["finish_reason"], "tool_calls")
        self.assertEqual(choice["message"]["tool_calls"][0]["function"]["name"], "remember")
        self.assertEqual(
            choice["message"]["tool_calls"][0]["function"]["arguments"],
            '{"fact":"rain"}',
        )

    def test_ndjson_becomes_openai_sse(self) -> None:
        sse = proxy.native_ndjson_to_sse(
            '{"model":"anima-chat","message":{"role":"assistant","content":"Hi"},"done":false}\n'
            '{"model":"anima-chat","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n',
            "anima-chat",
        )
        self.assertIn('"content":"Hi"', sse)
        self.assertIn('"finish_reason":"stop"', sse)
        self.assertTrue(sse.endswith("data: [DONE]\n\n"))


class _FakeOllama(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        self.server.last_path = self.path  # type: ignore[attr-defined]
        self.server.last_body = json.loads(raw.decode("utf-8"))  # type: ignore[attr-defined]
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Connection", "close")
        self.end_headers()
        first = b'{"model":"anima-chat","message":{"role":"assistant","content":"Hi"},"done":false}\n'
        self.wfile.write(first)
        self.wfile.flush()
        self.server.first_flushed.set()  # type: ignore[attr-defined]
        self.server.release.wait(3)  # type: ignore[attr-defined]
        second = b'{"model":"anima-chat","message":{"role":"assistant","content":"!"},"done":false}\n'
        third = b'{"model":"anima-chat","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n'
        self.wfile.write(second + third)
        self.wfile.flush()


class ProxyStreamTests(unittest.TestCase):
    def test_chat_completions_stream_before_upstream_finishes(self) -> None:
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), _FakeOllama)
        upstream.last_path = ""  # type: ignore[attr-defined]
        upstream.last_body = {}  # type: ignore[attr-defined]
        upstream.first_flushed = threading.Event()  # type: ignore[attr-defined]
        upstream.release = threading.Event()  # type: ignore[attr-defined]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()

        proxy.TOKEN = "test-token"
        proxy.UPSTREAM_HOST = f"127.0.0.1:{upstream.server_address[1]}"
        os.environ["ANIMA_LLM_PROXY_NATIVE"] = "1"
        os.environ["ANIMA_OLLAMA_KEEP_ALIVE"] = "30m"
        listen = ThreadingHTTPServer(("127.0.0.1", 0), proxy.Handler)
        threading.Thread(target=listen.serve_forever, daemon=True).start()
        host, port = listen.server_address

        try:
            conn = http.client.HTTPConnection(host, port, timeout=5)
            payload = json.dumps(
                {
                    "model": "anima-chat",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
                    "max_tokens": 32,
                    "keep_alive": "30m",
                }
            )
            conn.request(
                "POST",
                "/v1/chat/completions",
                body=payload,
                headers={
                    "Authorization": "Bearer test-token",
                    "Content-Type": "application/json",
                    "Content-Length": str(len(payload)),
                },
            )
            resp = conn.getresponse()
            self.assertEqual(resp.status, 200)
            self.assertIn("text/event-stream", resp.getheader("Content-Type") or "")
            # First SSE byte must arrive while the fake Ollama is still holding
            # the rest of the generate. A buffered proxy would block here.
            first = resp.fp.readline()
            self.assertIn(b"Hi", first)
            self.assertFalse(upstream.release.is_set())  # type: ignore[attr-defined]
            upstream.release.set()  # type: ignore[attr-defined]
            rest = resp.read()
            self.assertIn(b"[DONE]", rest)
            self.assertEqual(upstream.last_path, "/api/chat")  # type: ignore[attr-defined]
            self.assertEqual(upstream.last_body["keep_alive"], "30m")  # type: ignore[attr-defined]
            self.assertEqual(upstream.last_body["model"], "anima-chat")  # type: ignore[attr-defined]
            self.assertEqual(upstream.last_body["options"]["num_predict"], 32)  # type: ignore[attr-defined]
            conn.close()
        finally:
            upstream.release.set()  # type: ignore[attr-defined]
            listen.shutdown()
            upstream.shutdown()
            listen.server_close()
            upstream.server_close()


if __name__ == "__main__":
    unittest.main()
