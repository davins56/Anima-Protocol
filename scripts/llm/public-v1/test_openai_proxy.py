#!/usr/bin/env python3
"""Proxy maps OpenAI chat completions onto Ollama /api/chat with keep_alive."""
from __future__ import annotations

import http.client
import importlib.util
import json
import os
import select
import socket
import threading
import time
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
        self.assertEqual(native["options"]["num_predict"], proxy.NUM_PREDICT_CAP)

    def test_omits_keep_alive_unless_the_env_var_is_set(self) -> None:
        os.environ.pop("ANIMA_OLLAMA_KEEP_ALIVE", None)
        self.assertEqual(proxy.default_keep_alive(), "")
        native = proxy.openai_chat_to_native(
            {"model": "anima-chat", "messages": [{"role": "user", "content": "hi"}]},
            proxy.default_keep_alive(),
        )
        self.assertNotIn("keep_alive", native)
        self.assertEqual(native["options"]["num_predict"], proxy.NUM_PREDICT_CAP)
        self.assertFalse(native["stream"])

    def test_uses_explicit_keep_alive_env(self) -> None:
        os.environ["ANIMA_OLLAMA_KEEP_ALIVE"] = "30m"
        try:
            self.assertEqual(proxy.default_keep_alive(), "30m")
        finally:
            os.environ.pop("ANIMA_OLLAMA_KEEP_ALIVE", None)

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


class _FakeChunkedOllama(BaseHTTPRequestHandler):
    """Real Ollama streams /api/chat as a chunked NDJSON body."""

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _chunk(self, data: bytes) -> None:
        self.wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
        self.wfile.flush()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        self._chunk(b'{"model":"anima-chat","message":{"role":"assistant","content":"Hi"},"done":false}\n')
        self.server.release.wait(3)  # type: ignore[attr-defined]
        self.server.finished.set()  # type: ignore[attr-defined]
        self._chunk(b'{"model":"anima-chat","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n')
        self.wfile.write(b"0\r\n\r\n")
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


class ProxyNativePassthroughStreamTests(unittest.TestCase):
    def test_native_api_chat_passthrough_streams_chunked_body(self) -> None:
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), _FakeChunkedOllama)
        upstream.release = threading.Event()  # type: ignore[attr-defined]
        upstream.finished = threading.Event()  # type: ignore[attr-defined]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()

        proxy.TOKEN = "test-token"
        proxy.UPSTREAM_HOST = f"127.0.0.1:{upstream.server_address[1]}"
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
                }
            )
            conn.request(
                "POST",
                "/api/chat",
                body=payload,
                headers={
                    "Authorization": "Bearer " + proxy.TOKEN,
                    "Content-Type": "application/json",
                    "Content-Length": str(len(payload)),
                },
            )
            resp = conn.getresponse()
            self.assertEqual(resp.status, 200)
            first = resp.fp.readline()
            self.assertIn(b"Hi", first)
            self.assertFalse(upstream.finished.is_set())  # type: ignore[attr-defined]
            upstream.release.set()  # type: ignore[attr-defined]
            rest = resp.read()
            self.assertIn(b'"done":true', rest)
            conn.close()
        finally:
            upstream.release.set()  # type: ignore[attr-defined]
            listen.shutdown()
            upstream.shutdown()
            listen.server_close()
            upstream.server_close()


class _ListOllama(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        self.server.paths.append(path)  # type: ignore[attr-defined]
        body = b'{"models":[{"name":"anima-chat"}]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class _DripUpstream(BaseHTTPRequestHandler):
    """Flushes one short line, then waits. read() would sit until 8192 bytes."""

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(b'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
        self.wfile.flush()
        self.server.first_flushed.set()  # type: ignore[attr-defined]
        self.server.release.wait(15)  # type: ignore[attr-defined]
        self.wfile.write(b'data: {"choices":[{"delta":{"content":" there"}}]}\n\n')
        self.wfile.flush()


class ProxyPassthroughStreamTests(unittest.TestCase):
    def test_passthrough_forwards_the_first_line_before_the_burst_fills(self) -> None:
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), _DripUpstream)
        upstream.first_flushed = threading.Event()  # type: ignore[attr-defined]
        upstream.release = threading.Event()  # type: ignore[attr-defined]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()

        proxy.TOKEN = "test-token"
        proxy.UPSTREAM_HOST = f"127.0.0.1:{upstream.server_address[1]}"
        previous_native = os.environ.get("ANIMA_LLM_PROXY_NATIVE")
        os.environ["ANIMA_LLM_PROXY_NATIVE"] = "0"
        listen = ThreadingHTTPServer(("127.0.0.1", 0), proxy.Handler)
        threading.Thread(target=listen.serve_forever, daemon=True).start()
        host, port = listen.server_address

        try:
            conn = http.client.HTTPConnection(host, port, timeout=2)
            payload = json.dumps(
                {
                    "model": "anima-chat",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
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
            # The first line must arrive while the upstream is still holding
            # the rest. resp.read(8192) blocks for a full buffer or EOF.
            started = time.monotonic()
            first = resp.fp.readline()
            self.assertLess(time.monotonic() - started, 1.0)
            self.assertIn(b"Hi", first)
            self.assertFalse(upstream.release.is_set())  # type: ignore[attr-defined]
            upstream.release.set()  # type: ignore[attr-defined]
            rest = resp.read()
            self.assertIn(b"there", rest)
            conn.close()
        finally:
            upstream.release.set()  # type: ignore[attr-defined]
            if previous_native is None:
                os.environ.pop("ANIMA_LLM_PROXY_NATIVE", None)
            else:
                os.environ["ANIMA_LLM_PROXY_NATIVE"] = previous_native
            listen.shutdown()
            upstream.shutdown()
            listen.server_close()
            upstream.server_close()


class ProxyListTests(unittest.TestCase):
    def test_ps_and_tags_pass_and_pull_stays_closed(self) -> None:
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), _ListOllama)
        upstream.paths = []  # type: ignore[attr-defined]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()

        proxy.TOKEN = "test-token"
        proxy.UPSTREAM_HOST = f"127.0.0.1:{upstream.server_address[1]}"
        listen = ThreadingHTTPServer(("127.0.0.1", 0), proxy.Handler)
        threading.Thread(target=listen.serve_forever, daemon=True).start()
        host, port = listen.server_address

        def get(path: str) -> http.client.HTTPResponse:
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request(
                "GET",
                path,
                headers={"Authorization": "Bearer test-token"},
            )
            resp = conn.getresponse()
            resp.read()
            conn.close()
            return resp

        try:
            ps = get("/api/ps")
            tags = get("/api/tags")
            pull = get("/api/pull")
            self.assertEqual(ps.status, 200)
            self.assertEqual(tags.status, 200)
            self.assertEqual(pull.status, 404)
            self.assertEqual(upstream.paths, ["/api/ps", "/api/tags"])  # type: ignore[attr-defined]
        finally:
            listen.shutdown()
            upstream.shutdown()
            listen.server_close()
            upstream.server_close()


class _FakeVoice(BaseHTTPRequestHandler):
    """Kokoro-FastAPI / speaches stand-in: records requests, streams NDJSON and holds."""

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _record(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        self.server.requests.append(  # type: ignore[attr-defined]
            {"method": self.command, "path": self.path, "headers": dict(self.headers.items()), "len": len(raw)}
        )
        return raw

    def do_GET(self) -> None:  # noqa: N802
        self._record()
        body = b'{"status":"healthy"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        self._record()
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(b'{"audio":"AAAA","timestamps":[{"word":"Hi","start_time":0,"end_time":0.2}]}\n')
        self.wfile.flush()
        # Hold like a long synthesis; notice when the proxy hangs up on us.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.server.release.is_set():  # type: ignore[attr-defined]
                try:
                    self.wfile.write(b'{"audio":"BBBB","timestamps":[]}\n')
                    self.wfile.flush()
                except OSError:
                    pass
                return
            readable, _, _ = select.select([self.connection], [], [], 0.05)
            if readable:
                try:
                    if self.connection.recv(1, socket.MSG_PEEK) == b"":
                        self.server.closed.set()  # type: ignore[attr-defined]
                        return
                except OSError:
                    self.server.closed.set()  # type: ignore[attr-defined]
                    return


class ProxyVoiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.servers: list[ThreadingHTTPServer] = []
        self.tts = self._fake()
        self.stt = self._fake()
        self.saved = (proxy.TOKEN, proxy.VOICE_TTS_UPSTREAM, proxy.VOICE_STT_UPSTREAM)
        proxy.TOKEN = "test-token"
        proxy.VOICE_TTS_UPSTREAM = f"127.0.0.1:{self.tts.server_address[1]}"
        proxy.VOICE_STT_UPSTREAM = f"127.0.0.1:{self.stt.server_address[1]}"
        self.listen = ThreadingHTTPServer(("127.0.0.1", 0), proxy.Handler)
        threading.Thread(target=self.listen.serve_forever, daemon=True).start()
        self.servers.append(self.listen)
        self.host, self.port = self.listen.server_address

    def tearDown(self) -> None:
        proxy.TOKEN, proxy.VOICE_TTS_UPSTREAM, proxy.VOICE_STT_UPSTREAM = self.saved
        for srv in (self.tts, self.stt):
            srv.release.set()  # type: ignore[attr-defined]
        for srv in self.servers:
            srv.shutdown()
            srv.server_close()

    def _fake(self) -> ThreadingHTTPServer:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), _FakeVoice)
        srv.requests = []  # type: ignore[attr-defined]
        srv.release = threading.Event()  # type: ignore[attr-defined]
        srv.closed = threading.Event()  # type: ignore[attr-defined]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.servers.append(srv)
        return srv

    def _request(self, method: str, path: str, body: bytes = b"", auth: bool = True, headers: dict | None = None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=5)
        h = {"Content-Length": str(len(body))}
        if auth:
            h["Authorization"] = "Bearer test-token"
        h.update(headers or {})
        conn.request(method, path, body=body or None, headers=h)
        conn.raw_sock = conn.sock  # type: ignore[attr-defined]  # http.client detaches it on Connection: close
        return conn, conn.getresponse()

    def test_tts_streams_with_prefix_stripped_and_no_bearer_forwarded(self) -> None:
        body = json.dumps({"input": "Hi", "stream": True, "response_format": "pcm"}).encode()
        conn, resp = self._request("POST", "/tts/dev/captioned_speech", body, headers={"Content-Type": "application/json"})
        self.assertEqual(resp.status, 200)
        started = time.monotonic()
        first = resp.fp.readline()
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertIn(b"AAAA", first)
        self.tts.release.set()  # type: ignore[attr-defined]
        self.assertIn(b"BBBB", resp.read())
        conn.close()
        req = self.tts.requests[0]  # type: ignore[attr-defined]
        self.assertEqual((req["method"], req["path"], req["len"]), ("POST", "/dev/captioned_speech", len(body)))
        self.assertNotIn("Authorization", req["headers"])
        self.assertEqual(self.stt.requests, [])  # type: ignore[attr-defined]

    def test_client_disconnect_closes_the_tts_upstream(self) -> None:
        conn, resp = self._request("POST", "/tts/dev/captioned_speech", b'{"input":"Hi"}')
        self.assertIn(b"AAAA", resp.fp.readline())
        conn.raw_sock.shutdown(socket.SHUT_RDWR)  # type: ignore[attr-defined]
        resp.close()
        conn.close()
        self.assertTrue(self.tts.closed.wait(3))  # type: ignore[attr-defined]

    def test_stt_upload_and_health_reach_speaches(self) -> None:
        audio = b"RIFF" + b"\x00" * 64000
        conn, resp = self._request("POST", "/stt/v1/audio/transcriptions", audio, headers={"Content-Type": "multipart/form-data; boundary=x"})
        self.assertEqual(resp.status, 200)
        self.stt.release.set()  # type: ignore[attr-defined]
        resp.read()
        conn.close()
        conn, resp = self._request("GET", "/stt/health")
        self.assertEqual((resp.status, resp.read()), (200, b'{"status":"healthy"}'))
        conn.close()
        paths = [(r["path"], r["len"]) for r in self.stt.requests]  # type: ignore[attr-defined]
        self.assertEqual(paths, [("/v1/audio/transcriptions", len(audio)), ("/health", 0)])

    def test_voice_routes_need_the_bearer(self) -> None:
        for method, path in (("GET", "/tts/health"), ("POST", "/stt/v1/audio/transcriptions")):
            conn, resp = self._request(method, path, auth=False)
            self.assertEqual(resp.status, 401)
            resp.read()
            conn.close()
        self.assertEqual(self.tts.requests + self.stt.requests, [])  # type: ignore[attr-defined]

    def test_only_the_used_routes_are_open(self) -> None:
        closed = [
            ("POST", "/stt/v1/models/Systran/faster-whisper-large-v3"),
            ("GET", "/stt/v1/models"),
            ("DELETE", "/stt/v1/models/x"),
            ("GET", "/tts/v1/models"),
            ("GET", "/tts/web/"),
            ("GET", "/tts/dev/captioned_speech"),
            ("POST", "/tts/../v1/chat/completions"),
            ("GET", "/tts"),
        ]
        for method, path in closed:
            conn, resp = self._request(method, path)
            self.assertEqual(resp.status, 404 if method in ("GET", "POST") else 501, path)
            resp.read()
            conn.close()
        self.assertEqual(self.tts.requests + self.stt.requests, [])  # type: ignore[attr-defined]
        self.assertIsNone(proxy.voice_route("POST", "/stt/v1/models/x"))
        self.assertEqual(proxy.voice_route("GET", "/tts/v1/audio/voices"), (proxy.VOICE_TTS_UPSTREAM, "/v1/audio/voices"))

    def test_oversized_upload_is_refused_before_upstream(self) -> None:
        # Headers only: the proxy must answer 413 without reading the body.
        conn = http.client.HTTPConnection(self.host, self.port, timeout=5)
        conn.putrequest("POST", "/stt/v1/audio/transcriptions")
        conn.putheader("Authorization", "Bearer test-token")
        conn.putheader("Content-Length", str(proxy.VOICE_MAX_BODY_BYTES + 1))
        conn.endheaders()
        resp = conn.getresponse()
        self.assertEqual(resp.status, 413)
        resp.read()
        conn.close()
        self.assertEqual(self.stt.requests, [])  # type: ignore[attr-defined]

    def test_box_service_down_is_a_json_502(self) -> None:
        proxy.VOICE_TTS_UPSTREAM = "127.0.0.1:1"
        conn, resp = self._request("GET", "/tts/health")
        self.assertEqual(resp.status, 502)
        self.assertIn(b"voice upstream unreachable", resp.read())
        conn.close()
if __name__ == "__main__":
    unittest.main()
