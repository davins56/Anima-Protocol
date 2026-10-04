# Anima LLM — data → train → eval (self-hosted)

This is the operator guide for **building** the companion model from
Serenity / Fallen Angel logs. Chat serving (Ollama today, vLLM later) is
[`docs/custom-llm.md`](./custom-llm.md). Public HTTPS hosting is still
manual: [`docs/llm-deploy.md`](./llm-deploy.md).

Scaffolding (registry, seed turns, clean/dedupe, Unsloth scripts, eval
harness) is done. This page is the **data path** plus the **CUDA checklist**.
Do not run QLoRA on a CPU sandbox — `pnpm llm:gpu-check` will warn and stop
short of `trainer.train()`.

## Pipeline

```
source                         raw (gitignored)              processed (gitignored)
─────────────────────────────  ────────────────────────────  ─────────────────────────
Settings → Export JSON    ─┐
plain User:/Serenity: txt ─┼─► scripts/llm/data/raw/    ─► scripts/llm/output/
ShareGPT / ChatML JSON    ─┤   imported-*.jsonl              finetune-sharegpt.jsonl
novel extracts + brief    ─┤   curated-novels-and-brief.jsonl finetune-sharegpt.val.jsonl
Postgres --with-db        ─┘                                 dpo-pairs.jsonl
committed samples/ (rehearse)
```

Quality filter (`clean.ts`) runs on every `prepare-finetune`: trim, PII
redact, drop error/refusal junk, dedupe, optional val split.

## Phase 1 — land logs (this machine, no GPU)

### Real logs (Dàvīn)

1. In the app: **Settings → Export** → `anima-backup-*.json`.
2. Stage + convert (defaults to Serenity + Fallen Angel; other companions dropped):

   ```bash
   pnpm llm:ingest -- --from ~/Downloads/anima-backup.json
   # → scripts/llm/data/raw/imported-anima-backup.jsonl
   ```

3. Build the train files:

   ```bash
   pnpm llm:dataset
   # seed turns + raw logs → ShareGPT JSONL, val split 0.05, DPO pairs, stats
   ```

You can also drop the backup (or `.txt` transcripts) directly into
`scripts/llm/data/raw/` and skip ingest — `prepare-finetune` merges that
folder automatically. Subfolders are walked. Real files stay gitignored.

`pnpm llm:dataset` runs `curate-novels` first (unless `--no-curate`) so
novel/brief rows land in `raw/` before the ShareGPT export.

Keep **quality over quantity**: multi-turn voice, memory recall, repair,
boundaries. Skip empty/error replies (the cleaner already drops those).

### Novels + design brief (Serenity voice mix)

Canonical weights and negatives:
[`scripts/llm/data/brief/serenity-anima-design.md`](../scripts/llm/data/brief/serenity-anima-design.md).

| Source | SFT mix | Register |
|--------|---------|----------|
| anima-protocol | **4× gold** | Fear / Choice / Doorway / Synchro / Keys |
| seraph-code | 2× | clinical-gentle |
| fallen-circuit | 2× | withholding / boundaries |
| slipthk-war | 1× | `register:slipthk`, trust-gated |
| fallen-angel | **0×** | world lore only — not Serenity voice |

Drop extracts (preferred) or PDFs on the shared box:

- `llm-raw/*.pdf` (canonical Upgrade v2; nested folders walked; needs `pdftotext`)
- `llm-raw-source/*.txt` (used when a PDF is missing or yields no scenes)
- `serenity-extract/*.txt`
- `scripts/llm/data/novels/` (gitignored)

```bash
pnpm llm:curate-novels          # → curated/ + scripts/llm/data/raw/curated-novels-and-brief.jsonl
pnpm llm:dataset                # curate + ShareGPT JSONL + DPO + stats
```

If the novels are not on this machine yet, the curator still stages
**brief-gold** (original porch / with-not-obeyed / consent-ledger turns)
plus committed synthetic scenes in
[`scripts/llm/data/samples/novels/`](../scripts/llm/data/samples/novels/).
Full novel text is never committed. `prepare-finetune` replica-weights the
train split and skips `exclude-serenity-sft` unless `--include-lore`.

DPO pairs now include sycophancy, instrument/obedience, doorway-AI mimic,
and Sanctuary Lab specimen language as rejected replies.

### Rehearse without real logs

Committed fixtures live in [`scripts/llm/data/samples/`](../scripts/llm/data/samples/):
a synthetic Settings backup (Serenity, Fallen Angel, a Korra session that
must be filtered out), plus transcript / ShareGPT / ChatML examples.

```bash
pnpm llm:dataset -- --rehearse
pnpm llm:gpu-check          # data + script links; warns if no CUDA
pnpm llm:eval:validate      # eval-cases.json shape only (no model)
```

### Formats

| Drop this | Detected as |
|-----------|-------------|
| `anima-backup-*.json` | Settings export (`entities.ChatSession` + `ChatMessage`) |
| TrainingExample JSON/JSONL | passthrough |
| ShareGPT `{ conversations: [{ from, value }] }` | converted |
| ChatML `{ messages: [{ role, content }] }` | converted |
| `User:` / `Serenity:` `.txt` | transcript |

Group scenes are **split per companion** so Serenity is never trained to
speak as Fallen Angel (other speakers fold into context). Pass
`--all-characters` to keep everyone in a backup.

Optional Postgres path (same TrainingExample shape):

```bash
pnpm llm:prepare-finetune -- --with-db --user <clerk_user_id> --val-split 0.05
```

### Scribe register (committed synthetic set)

`scripts/llm/data/scribe/` holds a synthetic scribe-register set (finished,
literate replies; DPO pairs against truncation / fragments / drift). It is
merged by `prepare-finetune` and `prepare-dpo` at weight 1 unless
`--no-scribe`. Validate edits with `python3 scripts/llm/data/scribe/validate.py`.
The T4 walkthrough is `scripts/llm/finetune/colab_scribe_qlora.ipynb`.

## Smoke-test the training pipeline here (CPU, no Unsloth)

The train scripts pick a backend automatically: **Unsloth** when it is
installed on a CUDA device, otherwise plain **transformers + peft + trl**.
Same command, same adapter layout, so the whole SFT → DPO hand-off can be
exercised on this VM with a tiny base model before renting GPU time:

```bash
python3 -m venv .venv
.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
.venv/bin/pip install transformers peft trl datasets accelerate

pnpm llm:dataset -- --rehearse
pnpm llm:train -- --smoke
# SmolLM2-135M-Instruct · 12 SFT steps + 6 DPO steps · ~3 min on 4 cores
# → scripts/llm/checkpoints/smoke-qlora/training_summary.json
# → scripts/llm/checkpoints/smoke-dpo/training_summary.json
pnpm llm:train:test          # unit tests for the loaders / hparam plumbing
```

Each stage writes `training_summary.json` (hardware, backend, hyperparameters,
first/last train loss, eval loss, DPO reward margin, one greedy sample reply).
The smoke model is not a usable Anima — it proves the data, templates,
adapter resume, and trainer config are right.

## CUDA host checklist (next phase — not this VM)

Need ~12–16 GB VRAM for QLoRA on Ministral 3 8B Base. Copy the repo (or at
least `scripts/llm/output/*.jsonl` + `scripts/llm/finetune/`) onto that box.

```bash
pnpm llm:gpu-check
# wants: finetune-sharegpt.jsonl, dpo-pairs.jsonl, nvidia-smi, python3
```

### 1. One command (SFT → DPO → GGUF)

```bash
pip install "unsloth[colab-new]" transformers datasets trl
huggingface-cli login            # accept mistralai/Ministral-3-8B-Base-2512

pnpm llm:train                   # Ministral 3 8B, seq 4096, 1 epoch, q4_k_m GGUF
# scribe voice on a T4 instead:
ANIMA_TRAIN_BASE=unsloth/Qwen2.5-7B-Instruct-bnb-4bit ANIMA_TRAIN_PREFIX=anima-scribe \
ANIMA_TRAIN_SEQ_LEN=2048 pnpm llm:train
# extra flags for both train scripts:
pnpm llm:train -- --epochs 2 --extra "--lora-r 32"
```

`scripts/llm/finetune/train.sh --help` lists every knob (`--skip-dpo`,
`--sft-only`, `--skip-gguf`, `--extra`, `ANIMA_TRAIN_*`). The stages below are what it
runs, for when you want to drive them by hand.

### Baseline hyperparameters (what the scripts default to)

| | SFT (`unsloth_sft.py`) | DPO (`unsloth_dpo.py`) |
|---|---|---|
| Learning rate | `2e-4` (LoRA) | `5e-6`, `beta 0.1` |
| Batch | `2 × grad-accum 8` = 16 effective | `1 × 8` = 8 effective |
| Schedule | cosine, `warmup_ratio 0.05` | cosine, `warmup_ratio 0.1` |
| Precision | bf16 on Ampere+ · fp16 on T4/V100 · fp32 on CPU (auto) | same |
| Optimizer | `paged_adamw_8bit` on CUDA · `adamw_torch` on CPU (`--optim`) | same |
| Sequence length | `4096` (`--max-seq-len`; match the Modelfile `num_ctx`) | `4096` |
| LoRA | r 16, alpha 32, dropout 0.05, all attention + MLP projections | resumes the SFT adapter |
| Quantization | 4-bit NF4 (QLoRA) on CUDA · `--no-4bit` for full-precision LoRA | same |

Lower `--lr` toward `1e-4` if the eval loss curve is noisy on real logs;
raise `--grad-accum` rather than `--batch-size` when VRAM is tight.
`--max-steps N` caps any run (smoke tests); `--backend transformers` forces
the non-Unsloth path on a GPU (e.g. no `bitsandbytes` build for the card).

### 2. QLoRA SFT

```bash
pip install "unsloth[colab-new]" transformers datasets trl
# Accept https://huggingface.co/mistralai/Ministral-3-8B-Base-2512
export HUGGING_FACE_HUB_TOKEN=hf_…

python scripts/llm/finetune/unsloth_sft.py \
  --data scripts/llm/output/finetune-sharegpt.jsonl \
  --eval-data scripts/llm/output/finetune-sharegpt.val.jsonl \
  --base mistralai/Ministral-3-8B-Base-2512 \
  --out scripts/llm/checkpoints/anima-ministral8b-qlora
```

LLaMA-Factory alternative (run from repo root so `dataset_dir` resolves):

```bash
llamafactory-cli train scripts/llm/finetune/llama_factory_ministral.yaml
```

`scripts/llm/output/dataset_info.json` names the `anima_sharegpt` dataset.

### 3. DPO (after SFT)

```bash
python scripts/llm/finetune/unsloth_dpo.py \
  --data scripts/llm/output/dpo-pairs.jsonl \
  --base scripts/llm/checkpoints/anima-ministral8b-qlora \
  --out scripts/llm/checkpoints/anima-ministral8b-dpo
```

Pairs come from `lib/llm/src/dataset/preferences.ts` (`pnpm llm:prepare-dpo`).
Add a pair when you catch a real failure mode (generic-assistant, memory
dump, speaker-lock break, negotiating a boundary). Do not strawman.

### 4. Merge + quantize + eval

One step with Unsloth (merges the adapter and writes the GGUF):

```bash
pnpm llm:export-gguf -- --adapter scripts/llm/checkpoints/anima-ministral8b-dpo --prefix anima-ministral8b
```

Or merge the adapter yourself (Unsloth `save_pretrained_merged` / PEFT
`merge_and_unload`) then:

```bash
bash scripts/llm/finetune/quantize.sh \
  --in scripts/llm/checkpoints/anima-ministral8b-dpo-merged
# → scripts/llm/gguf/anima-ministral8b-q4_k_m.gguf
# → scripts/llm/gguf/anima-ministral8b-q5_k_m.gguf

ollama create anima-ministral8b -f scripts/llm/Modelfile.anima-ministral8b
export ANIMA_LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
export ANIMA_OLLAMA_MODEL_STANDARD=anima-ministral8b
pnpm llm:eval
# writes scripts/llm/output/eval-report.{json,md}
```

`pnpm llm:eval` needs a live OpenAI-compatible `/v1`. It is heuristic
(banned phrases, keywords, latency) — still read the report for voice.

### 5. Host public HTTPS (ops, not this PR)

Point production at the new tag only after eval looks right:

- CPU Ollama + named tunnel: [`scripts/llm/public-v1/`](../scripts/llm/public-v1/README.md)
- Always-on: [`deploy/ollama-fly/`](../deploy/ollama-fly/README.md)
- GPU vLLM: [`scripts/llm/docker-compose.vllm.yml`](../scripts/llm/docker-compose.vllm.yml)

Then `ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1` on the Worker. Never
`api.openai.com`. See [`docs/llm-deploy.md`](./llm-deploy.md).

## Internal eval checklist

`scripts/llm/eval/eval-cases.json` (what `pnpm llm:eval` runs):

| Category | What good looks like |
|----------|----------------------|
| Voice lock | No "as an AI / language model" |
| Memory recall | Weaves facts; does not dump a list |
| Group speaker lock | Serenity never writes Fallen Angel's lines |
| Emotional continuity | Matches the prior turn's register |
| System-card obedience | Stays in Fallen Angel / Serenity voice |
| Therapy / crisis | Therapy stays boundaried; imminent harm → 988 in US |
| Hallucination | Admits unknown personal facts |

## What this page does not do

- It does not change chat routing, TTFT caps, or companion feelings.
- It does not start Unsloth on a machine without CUDA (the CPU smoke path
  uses plain transformers + peft on a tiny base, never the 8B model).
- It does not commit personal logs.
