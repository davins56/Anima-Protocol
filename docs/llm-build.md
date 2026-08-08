# Building the Anima local LLM

**Honest scope:** ChatGPT / Gemini / Groq source + weights are **not** public.
Anima’s LLM is built from **public open weights** (Qwen2.5 bootstrap, Ministral
upgrade) + open inference (Ollama / llama.cpp / vLLM) + Anima fine-tune data.

This guide covers the full stack:

0. **Bootstrap** `anima-chat` (Qwen2.5 3B) so chat works on a laptop today — `pnpm llm:up`  
1. Fine-tuned **Ministral 3 8B** as the primary GPU companion model  
2. Structured + vector **memory retrieval** before every generation  
3. **Local serving** via vLLM or Ollama (OpenAI-compatible)  
4. Optional hybrid cloud fallback while you tune  

Short path: [`docs/custom-llm.md`](./custom-llm.md).

The React/Vite frontend does **not** need rewrites — it already talks to `POST /api/chat/messages` with an OpenAI-style SSE contract.

---

## Architecture

```
Chat.jsx
  → POST /api/chat/messages
      → promptBuilder + memory retrieval (heuristic + embeddings)
      → llmFailover
           ├─ local (vLLM / Ollama)     ← ANIMA_LLM_PROVIDER=custom|local
           └─ (optional) cloud auto chain only if local-first + keys set
```

| Piece | Location |
|-------|----------|
| Model registry (vLLM / Ollama / cloud) | `lib/llm/src/registry.ts` |
| Embeddings + hybrid retrieval | `lib/llm/src/embeddings.ts`, `lib/llm/src/memory/retrieval.ts` |
| Dataset export / ShareGPT formatters | `lib/llm/src/dataset/*` |
| CLI | `pnpm llm:cli` / `@workspace/llm` |
| Local provider in failover | `artifacts/api-server/src/lib/llmFailover.ts` |
| Embedding store | `memory_embeddings` table (`lib/db`) |
| Unsloth SFT script | `scripts/llm/finetune/unsloth_sft.py` |
| LLaMA-Factory YAML | `scripts/llm/finetune/llama_factory_ministral.yaml` |
| vLLM compose | `scripts/llm/docker-compose.vllm.yml` |

**Defaults**

| Constant | Value |
|----------|-------|
| Serve | `mistralai/Ministral-3-8B-Instruct-2512` |
| Fine-tune base | `mistralai/Ministral-3-8B-Base-2512` |
| Memory specialist | `mistralai/Ministral-3-3B-Instruct-2512` |

---

## 1. Fine-tune focus

Train for:

- Multi-turn character consistency and emotional continuity  
- Your writing/voice (Fallen Angel, long Serenity logs, etc.)  
- Memory-aware replies (reference + update long-term state)  
- Companion / erotic / spiritual tone depth you want  

**Quality > quantity.** A few thousand excellent turns beat tens of thousands of noisy ones.

### Prepare data

```bash
# Seed examples only (always available)
pnpm llm:prepare-finetune

# Seed + Postgres chat transcripts (needs DATABASE_URL)
pnpm llm:prepare-finetune -- --with-db --user <clerk_user_id>

# Raw session export
pnpm llm:export-turns -- --out scripts/llm/output/turns.jsonl
```

Outputs JSONL in ShareGPT / ChatML / Alpaca formats under `scripts/llm/output/`.

Add cleaned Serenity / Fallen Angel arcs as additional JSONL rows (same ShareGPT shape), plus synthetic turns that force memory recall and voice adherence.

### Unsloth (fast iteration + VRAM savings)

```bash
# On a CUDA box with ~12–16 GB
pip install "unsloth[colab-new]" transformers datasets trl
python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base mistralai/Ministral-3-8B-Base-2512 \
  --out scripts/llm/checkpoints/anima-ministral8b-qlora
```

### LLaMA-Factory (broadest method support)

```bash
llamafactory-cli train scripts/llm/finetune/llama_factory_ministral.yaml
```

Dataset metadata: `scripts/llm/output/dataset_info.json`.

### Preference optimization

A curated seed set of chosen/rejected pairs ships in
`lib/llm/src/dataset/preferences.ts` — each pair anchors on an SFT seed turn
and contrasts the vetted reply against a realistic failure mode (fact-dumping
memory, generic-assistant disclaimers, negotiating past a stated boundary,
narrating another companion's lines, over-apologizing). Expand it with your
own pairs as you spot real model mistakes worth correcting.

```bash
pnpm llm:prepare-dpo
# → scripts/llm/output/dpo-pairs.jsonl ({prompt, chosen, rejected, system} per line)

# On a CUDA box, after the SFT stage above:
python scripts/llm/finetune/unsloth_dpo.py \
  --data scripts/llm/output/dpo-pairs.jsonl \
  --base scripts/llm/checkpoints/anima-ministral8b-qlora \
  --out scripts/llm/checkpoints/anima-ministral8b-dpo
```

Or LLaMA-Factory (`stage: dpo` / `orpo`) with the same JSONL. Keep base
instruction-following intact so character cards and system prompts still work.

---

## 2. Memory & retrieval layer

Do **not** rely on the LLM alone.

| Store | Role |
|-------|------|
| `companion_memories` | Structured facts, summary, emotional state, resonance |
| `memory_embeddings` | Per-fact vectors (JSON `number[]`, no pgvector required) |
| Heuristic scorer | Type + recency (always on) |
| Semantic blend | Cosine similarity when embeddings exist |

Before each generation, `promptBuilder` calls hybrid `retrieveRelevantMemories`. Chat loads stored embeddings via `attachStoredEmbeddings`.

To index new facts:

```ts
import { upsertMemoryEmbeddings } from "../lib/memoryEmbeddings";
await upsertMemoryEmbeddings({ userId, characterId, facts });
```

Optional specialist (Ministral 3 3B) for summarization: registry light tier (`ANIMA_MEMORY_SPECIALIST_MODEL` / `ANIMA_VLLM_MODEL_LIGHT`). Rule + embedding compression is available via `compressMemoriesForContext` without a second model.

Embeddings endpoint (optional):

```bash
export ANIMA_EMBEDDINGS_BASE_URL=http://localhost:8000/v1
export ANIMA_EMBEDDINGS_MODEL=text-embedding-3-small   # or a local embed model
```

Without a remote embedder, deterministic hash embeddings keep the path wired for tests/dev.

Apply schema:

```bash
export DATABASE_URL=postgresql://anima:anima_dev@localhost:5432/anima_dev
pnpm --filter @workspace/db run push
```

---

## 3. Local serving

### vLLM (recommended throughput)

```bash
export ANIMA_VLLM_MODEL=mistralai/Ministral-3-8B-Instruct-2512   # or merged / LoRA path
docker compose -f scripts/llm/docker-compose.vllm.yml up
```

Quantization: FP8 Instruct weights run efficiently; Q4_K_M / AWQ / GPTQ on smaller cards after merge.

### Ollama (simpler single-user)

```bash
# After converting your fine-tune to GGUF Q4_K_M / Q5_K_M:
ollama create anima-ministral8b -f scripts/llm/Modelfile.anima-ministral8b
```

### Point the api-server at it

```bash
export ANIMA_LLM_PROVIDER=custom                           # self-hosted only
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1   # or http://localhost:11434/v1
export ANIMA_VLLM_MODEL_STANDARD=mistralai/Ministral-3-8B-Instruct-2512
# For Ollama tags:
# export ANIMA_LOCAL_LLM_BACKEND=ollama
# export ANIMA_OLLAMA_MODEL_STANDARD=anima-ministral8b
```

The local client is OpenAI-compatible — existing chat + group-speaker logic keeps working.

Check routing:

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
```

---

## 4. Hybrid safety net

| `ANIMA_LLM_PROVIDER` | Behavior |
|----------------------|----------|
| `custom` / `anima` / `local` | **Self-hosted Anima LLM only** (no Gemini/Groq/Kimi/Grok/Gateway) |
| `local-first` / `vllm` / `ollama` | Local first, then optional cloud auto chain |
| `auto` | Cloud BYOK: Gemini → Groq → Kimi → Grok → OpenAI → Gateway |
| `ensemble` | Opt-in cloud parallel minds (not the custom path) |
| `gemini` / `groq` / `kimi` / … | Single-provider cloud modes |

Route core companion traffic to local once it consistently beats your internal evals (character fidelity, memory coherence, tone).

---

## 5. Internal eval checklist

Before making local the default in production:

- [ ] Multi-turn voice lock (Serenity / Fallen Angel samples)  
- [ ] Memory recall without fact-dumping  
- [ ] Group speaker lock (does not speak as other companions)  
- [ ] Emotional continuity across 10+ turns  
- [ ] System / character card obedience preserved after SFT  
- [ ] Latency acceptable on your GPU at target quant  

---

## Quick command index

```bash
pnpm llm:list-models
pnpm llm:prepare-finetune
pnpm llm:prepare-dpo
pnpm llm:serve-hint
pnpm llm:test
pnpm --filter @workspace/api-server test
```
