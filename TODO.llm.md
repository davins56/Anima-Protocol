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
- [x] Step 10: `ANIMA_LLM_PROVIDER=local|local-first` hybrid routing + healthz keys
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

## Phase G — Data quality pipeline (dataset/clean.ts)

- [x] Step 24: `normalizeTurns` — trim, drop empty, merge consecutive same-role turns
- [x] Step 25: Quality gate — drop no-assistant / too-short / error-fallback-denylist / echoed-reply examples, with drop reasons logged
- [x] Step 26: `dedupeExamples` — drop exact/near-duplicate conversations
- [x] Step 27: `splitExamples` — deterministic train/val split by id hash, wired into `prepare-finetune --val-split`
- [x] Step 28: `dataset-stats` CLI — quality/shape report on any exported (or hand-merged) JSONL
- [x] Step 29: `unsloth_sft.py --eval-data` — real held-out eval loss during QLoRA SFT
- [x] Step 30: Tests (`lib/llm/test/clean.test.ts`) + docs (`lib/llm/README.md`, `docs/llm-build.md`)

## Still manual (GPU / data ops)

- [ ] Clean and import highest-quality Serenity / Fallen Angel multi-turn logs
  (the pipeline above now auto-drops junk/dupes and reports stats, but curating
  which raw logs are worth including is still a human judgment call)
- [ ] Run Unsloth or LLaMA-Factory QLoRA on a CUDA box
- [ ] Optional DPO/ORPO/SimPO preference stage
- [ ] Quantize to Q4_K_M / Q5 and validate on internal evals
- [x] `ANIMA_LLM_PROVIDER=custom|anima|local` = self-hosted Anima LLM (no cloud BYOK)
- [x] `ANIMA_ALLOW_CLOUD_LLM=true` gate — every cloud-capable mode (auto/local-first/gemini/groq/kimi/xai/openai/gateway/ensemble) is silently downgraded to `local` unless this second flag is also set, so a mistyped `ANIMA_LLM_PROVIDER` can never switch chat onto a flagship provider
- [ ] Host Ollama/vLLM with a public HTTPS URL and flip production to `custom`
  - Do **not** point `ANIMA_LOCAL_LLM_BASE_URL` at `api.openai.com` — that is cloud OpenAI, not Anima LLM
  - For OpenAI chat responses use `ANIMA_LLM_PROVIDER=openai` (or `auto`) + `OPENAI_API_KEY` instead
  - Concrete no-infra-yet path (VPS + Cloudflare Tunnel, then GPU/vLLM upgrade): `docs/llm-deploy.md` + `scripts/llm/tunnel-cloudflared.sh` / `pnpm llm:tunnel` — still requires someone to actually rent the box and run it
