# Custom Anima LLM — Ministral

Fine-tune **Ministral 3 8B** for persistent memory and companion identity. Do **not** build a model from scratch, and do **not** require Gemini / Groq / Kimi / Grok / AI Gateway for chat.

| Role | Hugging Face id |
|------|-----------------|
| Serve (chat) | `mistralai/Ministral-3-8B-Instruct-2512` |
| Fine-tune base (LoRA) | `mistralai/Ministral-3-8B-Base-2512` |
| Optional memory specialist | `mistralai/Ministral-3-3B-Instruct-2512` |

Accept the Mistral license on Hugging Face and set `HUGGING_FACE_HUB_TOKEN` if the repo is gated.

---

## Recommended path

### 1. Choose a base model — Ministral

Ministral 3 8B balances companion quality with local VRAM (QLoRA on ~12–16 GB; Q4 GGUF often fits ~8 GB). Smaller option: Ministral 3 3B for light / memory-only tiers.

### 2. Prepare your dataset

Gather Anima-specific data:

- Multi-turn chats between users and companions  
- Turns that use **persistent memory** and emotional continuity  
- Soul / personality examples that match your character cards  

```bash
# Seed examples (always available)
pnpm llm:prepare-finetune

# Seed + your Postgres transcripts
pnpm llm:prepare-finetune -- --with-db --user <clerk_user_id>
```

Outputs ShareGPT / ChatML / Alpaca JSONL under `scripts/llm/output/`. Add cleaned companion arcs and memory-recall drills in the same ShareGPT shape.

### 3. Fine-tune with LoRA (QLoRA)

**Unsloth** (fast iteration):

```bash
pip install "unsloth[colab-new]" transformers datasets trl
python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --base mistralai/Ministral-3-8B-Base-2512 \
  --out scripts/llm/checkpoints/anima-ministral8b-qlora
```

**LLaMA-Factory**:

```bash
llamafactory-cli train scripts/llm/finetune/llama_factory_ministral.yaml
```

### 4. Deploy and integrate

**vLLM:**

```bash
export ANIMA_VLLM_MODEL=mistralai/Ministral-3-8B-Instruct-2512
# or: export ANIMA_VLLM_MODEL=/path/to/merged-checkpoint
docker compose -f scripts/llm/docker-compose.vllm.yml up
```

**Ollama** (after GGUF conversion):

```bash
ollama create anima-ministral8b -f scripts/llm/Modelfile.anima-ministral8b
```

**Point the api-server** (self-hosted only — no cloud BYOK):

```bash
export ANIMA_LLM_PROVIDER=custom
export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1   # or :11434/v1 for Ollama
export ANIMA_VLLM_MODEL_STANDARD=mistralai/Ministral-3-8B-Instruct-2512
# Ollama:
# export ANIMA_LOCAL_LLM_BACKEND=ollama
# export ANIMA_OLLAMA_MODEL_STANDARD=anima-ministral8b
```

Leave `GEMINI_API_KEY`, `GROQ_API_KEY`, `KIMI_API_KEY`, `XAI_API_KEY`, and `AI_GATEWAY_API_KEY` unset.

Verify:

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
# expect: "mode":"local", "preferred":"local", "brand":"anima"
```

The React app keeps calling `POST /api/chat/messages` — no frontend rewrite.

---

## Modes

| `ANIMA_LLM_PROVIDER` | Behavior |
|----------------------|----------|
| `custom` / `anima` / `local` | **Self-hosted Ministral only** (recommended) |
| `local-first` | Local first, then optional cloud BYOK if keys exist |
| `auto` | Cloud BYOK only |

More detail (memory embeddings, eval checklist): [`docs/llm-build.md`](./llm-build.md).

## Production note

Vercel serverless cannot reach a laptop GPU. Host vLLM/Ollama on a GPU box with a reachable HTTPS URL (or run the api-server beside the GPU), then set `ANIMA_LOCAL_LLM_BASE_URL`.
