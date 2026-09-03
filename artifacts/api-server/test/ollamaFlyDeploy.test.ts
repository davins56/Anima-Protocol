import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const flyDir = path.join(repoRoot, "deploy/ollama-fly");

function read(name: string): string {
  return readFileSync(path.join(flyDir, name), "utf8");
}

describe("deploy/ollama-fly pack", () => {
  it("requires Bearer PROXY_AUTH_TOKEN on /v1 and exposes a cheap /healthz", () => {
    const caddy = read("Caddyfile");
    expect(caddy).toMatch(/header Authorization "Bearer \{\$PROXY_AUTH_TOKEN\}"/);
    expect(caddy).toMatch(/respond "unauthorized" 401/);
    expect(caddy).toMatch(/handle \/healthz/);
    expect(caddy).not.toMatch(/sk-|tok-|PROXY_AUTH_TOKEN=[0-9a-f]/i);
  });

  it("refuses to start without PROXY_AUTH_TOKEN and bootstraps anima-chat in the background", () => {
    const entry = read("entrypoint.sh");
    expect(entry).toMatch(/PROXY_AUTH_TOKEN must be set/);
    expect(entry).toMatch(/ollama serve/);
    expect(entry).toMatch(/caddy run/);
    expect(entry).toMatch(/bootstrap_model &/);
    expect(entry).toMatch(/Modelfile\.anima-chat/);
    expect(entry).toMatch(/ANIMA_OLLAMA_CHAT_TAG/);
  });

  it("builds from repo-root context with the shared Modelfile and no baked token", () => {
    const docker = read("Dockerfile");
    expect(docker).toMatch(/FROM ollama\/ollama/);
    expect(docker).toMatch(/COPY scripts\/llm\/Modelfile\.anima-chat/);
    expect(docker).toMatch(/EXPOSE 8080/);
    expect(docker).not.toMatch(/PROXY_AUTH_TOKEN=/);
    const toml = read("fly.toml");
    expect(toml).toMatch(/app = "anima-chat-llm"/);
    expect(toml).toMatch(/internal_port = 8080/);
    expect(toml).toMatch(/force_https = true/);
    expect(toml).toMatch(/auto_stop_machines = "off"/);
    expect(toml).toMatch(/min_machines_running = 1/);
    expect(toml).toMatch(/path = "\/healthz"/);
    expect(toml).toMatch(/destination = "\/root\/\.ollama"/);
    expect(toml).not.toMatch(/PROXY_AUTH_TOKEN/);
  });
});
