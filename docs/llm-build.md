# Building the Anima local LLM (Qwen3.6-27B)

This guide covers the full stack:

1. Fine-tuned **Qwen3.6-27B** (or equivalent) as the primary companion model  
2. Structured + vector **memory retrieval** before every generation  
3. **Local serving** via vLLM or Ollama (OpenAI-compatible)  
4. **Hybrid fallback** to the existing cloud chain while you tune  

The React/Vite frontend does **not** need rewrites — it already talks to `POST /api/chat/messages` with an OpenAI-style SSE contract.

---

## Architecture

```
Chat.jsx
  → POST /api/chat/messages
      → promptBuilder + memory retrieval (heuristic + embeddings)
      → llmFailover
           ├─ local (vLLM / Ollama)     ← ANIMA_LLM_PROVIDER=local|local-first
           └─ Gemini → Groq → Kimi → Grok → OpenAI → Gateway
      → llmEnsemble (ANIMA_LLM_PROVIDER=anima)
           └─ parallel minds: Gemini + Groq + ChatGPT → synthesize
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
| LLaMA-Factory YAML | `scripts/llm/finetune/llama_factory_qwen36.yaml` |
| vLLM compose | `scripts/llm/docker-compose.vllm.yml` |

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
# On a CUDA box with ~24 GB+
pip install "unsloth[colab-new]" transformers datasets trl
python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base Qwen/Qwen3.6-27B \
  --out scripts/llm/checkpoints/anima-qwen27b-qlora
```

### LLaMA-Factory (broadest method support)

```bash
llamafactory-cli train scripts/llm/finetune/llama_factory_qwen36.yaml
```

Dataset metadata: `scripts/llm/output/dataset_info.json`.

### Preference optimization

Once you have chosen/rejected pairs (character fidelity, memory coherence, tone):

- Export with `toPreferencePair` from `@workspace/llm/dataset`  
- Run a DPO / ORPO / SimPO stage in LLaMA-Factory (`stage: dpo` / `orpo`)  
- Keep base instruction-following intact so character cards and system prompts still work  

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

Optional specialist (7–14B) for summarization: registry light tier (`ANIMA_MEMORY_SPECIALIST_MODEL` / `ANIMA_VLLM_MODEL_LIGHT`). Rule + embedding compression is available via `compressMemoriesForContext` without a second model.

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
export ANIMA_VLLM_MODEL=Qwen/Qwen3.6-27B   # or merged / LoRA checkpoint path
docker compose -f scripts/llm/docker-compose.vllm.yml up
```

Quantization: start with **Q4_K_M / AWQ / GPTQ** on 24 GB; raise precision if you have VRAM.

### Ollama (simpler single-user)

```bash
# After converting your fine-tune to GGUF Q4_K_M / Q5_K_M:
ollama create anima-qwen27b -f scripts/llm/Modelfile.anima-qwen27b
```

### Point the api-server at it

```bash
export ANIMA_LLM_PROVIDER=local-first
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1   # or http://localhost:11434/v1
export ANIMA_VLLM_MODEL_STANDARD=Qwen/Qwen3.6-27B          # must match served name
# For Ollama tags:
# export ANIMA_LOCAL_LLM_BACKEND=ollama
# export ANIMA_OLLAMA_MODEL_STANDARD=anima-qwen27b
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
| `auto` (default) | Cloud: Gemini → Groq → Kimi → Grok → OpenAI → Gateway |
| `anima` / `ensemble` | Parallel minds: **Gemini + Groq + ChatGPT**, then synthesize |
| `local` | Local only |
| `local-first` / `vllm` / `ollama` | **Local first**, then cloud auto chain |
| `gemini` / `groq` / `kimi` / … | Single-provider modes |

Route core companion traffic to local once it consistently beats your internal evals (character fidelity, memory coherence, tone). Keep cloud keys configured so edge cases still fail over.

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
pnpm llm:serve-hint
pnpm llm:test
pnpm --filter @workspace/api-server test
```
