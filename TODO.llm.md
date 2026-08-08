# Build the Anima LLM layer (into the scaffolding)

End-to-end build: a reusable model registry + dataset/fine-tune pipeline +
CLI, wired into the api-server (multi-provider execution + local hybrid), plus
documentation.

## Phase A — New `lib/llm` workspace package (`@workspace/llm`)

- [x] Step 1: package.json, tsconfig.json, vitest config
- [x] Step 2: `src/registry.ts` — tier × provider model registry + Ministral 3 8B / vLLM presets
- [x] Step 3: `src/dataset/transcripts.ts` — export chat_messages to transcripts
- [x] Step 4: `src/dataset/format.ts` — ShareGPT / ChatML / Alpaca formatters
- [x] Step 5: `src/dataset/seed.ts` — curated Anima-protocol seed turns
- [x] Step 6: `src/cli.ts` — export-turns / prepare-finetune / list-models / serve-hint
- [x] Step 7: tests for registry + formatters + embeddings/retrieval
- [x] Step 8: README.md

## Phase B — Wire into api-server (multi-provider + local hybrid)

- [x] Step 9: OpenAI-compatible **local** provider (vLLM/Ollama) in `llmFailover`
- [x] Step 10: local-only routing + healthz status (superseded by Step 21 — the
      cloud failover/ensemble chain and `ANIMA_LLM_PROVIDER` mode switch were
      removed entirely; chat has exactly one backend now)
- [x] Step 11: Hybrid memory retrieval + `memory_embeddings` + `searchMemoriesSemantically`
  - Chat `upsertTurnMemory` indexes each new turn into `memory_embeddings` via `upsertMemoryEmbeddings`
  - Prompt path uses `attachStoredEmbeddings`; tool path uses `searchMemoriesSemantically`

## Phase C — Self-hosted "run your own Anima" path

- [x] Step 12: vLLM docker-compose + Ollama Modelfile + Unsloth / LLaMA-Factory configs
- [x] Step 13: docs/llm-build.md — self-hosted + fine-tune guides

## Phase D — Root wiring + validation

- [x] Step 14: root package.json `llm:*` scripts
- [x] Step 15: typecheck + tests + api-server build validation

## Phase E — Runnable open chat LLM (no cloud BYOK)

- [x] Step 16: `Modelfile.anima-chat` from public Qwen2.5 3B weights
- [x] Step 17: `scripts/llm/bootstrap-anima-llm.sh` + `pnpm llm:up` / `pnpm llm:chat`
- [x] Step 18: Registry defaults Ollama lineup to `anima-chat`; custom → ollama unless `ANIMA_LOCAL_LLM_BACKEND=vllm`
- [x] Step 19: Docs clarify ChatGPT/Gemini/Groq weights are closed; Anima uses open weights
- [x] Step 20: `docker-compose.dev.yml` + `pnpm dev:infra:up/down/logs` — bundles Postgres + the branded `anima-chat` Ollama model behind one command (validated with `docker compose config`; image pulls not exercised in this sandbox's network policy)

## Phase F — Audit + sandbox smoke test (no GPU / no ollama.com or huggingface.co egress)

- [x] Step 21: Removed `lib/modelProvider.ts` — an orphaned, unused provider-selection
  module that read `ANIMA_LLM_PROVIDER` directly and could dial Groq/OpenAI with
  none of `llmFailover.ts`'s `ANIMA_ALLOW_CLOUD_LLM` gate, sanitization, or sticky-skip
  protections. Nothing imported it outside its own test — dead code, but a foot-gun
  if it had ever been wired into a route.
- [x] Step 22: Audited every live chat call site (`chat.ts`, `routes/openai/functions.ts`,
  `evolutionEngine.ts`) — all go through `createChatCompletionWithFailover` /
  `isAnimaCustomMode()`. No bypass found in the routes that actually run.
- [x] Step 23: `scripts/llm/mock-server.mjs` (`pnpm llm:mock`) — canned OpenAI-compatible
  `/v1` server for smoke-testing the custom-LLM wiring without a GPU or network access
  to Ollama/Hugging Face (both blocked in this sandbox). Confirmed live against real
  `llmFailover.ts` code (not just mocks): with fake Gemini/Groq/OpenAI keys present
  *and* a stray `ANIMA_LLM_ENSEMBLE=true`, `ANIMA_LLM_PROVIDER=custom` still resolved
  to `mode: "local"`, `chain: ["local"]` and answered from the mock endpoint only.

## Still manual (GPU / data ops)

- [ ] Clean and import highest-quality Serenity / Fallen Angel multi-turn logs
- [ ] Run Unsloth or LLaMA-Factory QLoRA on a CUDA box
- [ ] Optional DPO/ORPO/SimPO preference stage
- [ ] Quantize to Q4_K_M / Q5 and validate on internal evals
- [x] Step 21: Deleted the cloud failover/ensemble chain entirely — `llmEnsemble.ts`,
      `geminiNative.ts`, and every Gemini/Groq/Kimi/xAI/OpenAI/Gateway chat code
      path, plus the `ANIMA_LLM_PROVIDER` mode switch and `ANIMA_ALLOW_CLOUD_LLM`
      gate (nothing left to gate — there is no cloud mode to enable). Chat is
      exactly one backend: the self-hosted Anima LLM via `ANIMA_LOCAL_LLM_BASE_URL`.
      `OPENAI_API_KEY` remains, scoped to image generate/edit only. Frontend
      "Switched to Kimi/Grok/ChatGPT/AI Gateway" toasts and the ensemble
      "Consulting minds…" status UI were removed along with it.
- [ ] Host Ollama/vLLM with a public HTTPS URL and flip production to it
  - Do **not** point `ANIMA_LOCAL_LLM_BASE_URL` at `api.openai.com` — that is cloud OpenAI, not Anima LLM
  - For OpenAI chat responses use `ANIMA_LLM_PROVIDER=openai` (or `auto`) + `OPENAI_API_KEY` instead
  - Concrete no-infra-yet path (VPS + Cloudflare Tunnel, then GPU/vLLM upgrade): `docs/llm-deploy.md` + `scripts/llm/tunnel-cloudflared.sh` / `pnpm llm:tunnel` — still requires someone to actually rent the box and run it
