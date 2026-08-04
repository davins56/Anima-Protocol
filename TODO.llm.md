# Build the Anima LLM layer (into the scaffolding)

End-to-end build: a reusable model registry + dataset/fine-tune pipeline +
CLI, wired into the api-server (multi-provider execution), plus documentation.

## Phase A — New `lib/llm` workspace package (`@workspace/llm`)

- [ ] Step 1: package.json, tsconfig.json, vitest config
- [ ] Step 2: `src/registry.ts` — tier x provider model registry + presets
- [ ] Step 3: `src/dataset/transcripts.ts` — export chat_messages to transcripts
- [ ] Step 4: `src/dataset/format.ts` — ShareGPT / ChatML / Alpaca formatters
- [ ] Step 5: `src/dataset/seed.ts` — curated Anima-protocol seed turns
- [ ] Step 6: `src/cli.ts` — export-turns / prepare-finetune / download-model / serve
- [ ] Step 7: tests for registry + formatters
- [ ] Step 8: README.md

## Phase B — Wire into api-server (multi-provider execution)

- [ ] Step 9: modelProvider.ts resolves via @workspace/llm registry (OpenAI default)
- [ ] Step 10: chat.ts records provider/model in metadata + SSE done event
- [ ] Step 11: functions.ts llm() honors ANIMA_LLM_PROVIDER

## Phase C — Self-hosted "run your own Anima" path via Ollama

- [ ] Step 12: CLI download-model + serve commands (Ollama integration)
- [ ] Step 13: docs/llm-build.md — self-hosted + fine-tune guides

## Phase D — Root wiring + validation

- [ ] Step 14: root package.json llm:* scripts
- [ ] Step 15: typecheck + tests + api-server build validation

