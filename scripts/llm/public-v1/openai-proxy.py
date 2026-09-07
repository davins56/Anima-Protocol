#!/usr/bin/env python3
"""Bearer proxy in front of a local OpenAI-compatible LLM (Ollama / vLLM).

Unauthenticated /v1/* → 401. /healthz is open. Does not log the token.
"""
from __future__ import annotations

import http.client
import http.server
import os
import sys

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
}


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


TOKEN = load_token()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._handle()

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle()

    def _handle(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/healthz", "/health"):
            self._send(200, b"ok", "text/plain")
            return
        if not (path == "/v1" or path.startswith("/v1/")):
            self._send(404, b'{"error":{"message":"not found"}}', "application/json")
            return
        if self.headers.get("Authorization", "") != f"Bearer {TOKEN}":
            self._send(
                401,
                b'{"error":{"message":"unauthorized","type":"auth"}}',
                "application/json",
            )
            return

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        headers["Host"] = "127.0.0.1:11434"
        headers["Connection"] = "close"

        conn = http.client.HTTPConnection(UPSTREAM_HOST, timeout=300)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            resp_body = resp.read()
            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                if k.lower() in HOP_BY_HOP or k.lower() == "content-length":
                    continue
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(resp_body)
        finally:
            conn.close()


def main() -> None:
    server = http.server.ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(
        f"anima openai proxy listening on http://{LISTEN_HOST}:{LISTEN_PORT} -> {UPSTREAM_HOST}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
