#!/usr/bin/env bash
# Pre-flight for the CUDA train host. Does NOT start training.
#
# Run from anywhere:
#   bash scripts/llm/finetune/check-gpu-ready.sh
#   pnpm llm:gpu-check
#
# Exit 0 = data (and, if present, GPU) look ready to train.
# Exit 1 = missing JSONL / Python — fix before renting GPU time.
# A missing GPU is a WARNING, not a failure: this sandbox has no CUDA.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

ok=0
warn=0
fail=0
pass() { echo "  ✓ $*"; ok=$((ok + 1)); }
note() { echo "  ⚠ $*"; warn=$((warn + 1)); }
bad() { echo "  ✗ $*" >&2; fail=$((fail + 1)); }

echo "Anima LLM — CUDA host pre-flight (no training)"
echo "repo: $ROOT"
echo

TRAIN="$ROOT/scripts/llm/output/finetune-sharegpt.jsonl"
VAL="$ROOT/scripts/llm/output/finetune-sharegpt.val.jsonl"
DPO="$ROOT/scripts/llm/output/dpo-pairs.jsonl"
SFT_PY="$ROOT/scripts/llm/finetune/unsloth_sft.py"
DPO_PY="$ROOT/scripts/llm/finetune/unsloth_dpo.py"
EVAL="$ROOT/scripts/llm/eval/run-evals.mjs"
QUANT="$ROOT/scripts/llm/finetune/quantize.sh"

if [[ -f "$SFT_PY" ]]; then pass "SFT script $SFT_PY"; else bad "missing $SFT_PY"; fi
if [[ -f "$DPO_PY" ]]; then pass "DPO script $DPO_PY"; else bad "missing $DPO_PY"; fi
if [[ -f "$EVAL" ]]; then pass "eval harness $EVAL"; else bad "missing $EVAL"; fi
if [[ -f "$QUANT" ]]; then pass "quantize script $QUANT"; else bad "missing $QUANT"; fi

count_jsonl() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "0"
    return
  fi
  grep -c . "$f" || true
}

train_n="$(count_jsonl "$TRAIN")"
val_n="$(count_jsonl "$VAL")"
dpo_n="$(count_jsonl "$DPO")"

if [[ -f "$TRAIN" && "$train_n" -gt 0 ]]; then
  pass "SFT JSONL $TRAIN ($train_n rows)"
else
  bad "missing SFT JSONL. Run: pnpm llm:dataset -- --rehearse   OR   pnpm llm:ingest -- --from <backup.json> && pnpm llm:dataset"
fi

if [[ -f "$VAL" && "$val_n" -gt 0 ]]; then
  pass "held-out val JSONL $VAL ($val_n rows)"
else
  note "no val split yet (empty or missing). Re-run: pnpm llm:prepare-finetune -- --val-split 0.05"
fi

if [[ -f "$DPO" && "$dpo_n" -gt 0 ]]; then
  pass "DPO JSONL $DPO ($dpo_n pairs)"
else
  note "no DPO pairs — run: pnpm llm:prepare-dpo"
fi

if command -v python3 >/dev/null 2>&1; then
  pass "python3 $(python3 --version 2>&1 | awk '{print $2}')"
  python3 -m py_compile "$SFT_PY" "$DPO_PY" && pass "unsloth_sft.py / unsloth_dpo.py compile"
else
  bad "python3 not on PATH (needed on the CUDA host)"
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader && pass "nvidia-smi sees a GPU"
else
  note "nvidia-smi not found — this machine cannot run QLoRA. Copy the JSONL + scripts/llm/finetune/ to a CUDA box."
fi

if python3 - <<'PY' >/dev/null 2>&1
import torch
raise SystemExit(0 if torch.cuda.is_available() else 1)
PY
then
  pass "torch.cuda.is_available() = True"
else
  note "PyTorch CUDA not available here (expected on the CPU sandbox). On the GPU host: pip install 'unsloth[colab-new]' transformers datasets trl"
fi

echo
echo "Next commands on a CUDA host (12–16 GB VRAM for QLoRA):"
echo
cat <<'EOS'
  pip install "unsloth[colab-new]" transformers datasets trl
  huggingface-cli login   # accept mistralai/Ministral-3-8B-Base-2512 terms

  python scripts/llm/finetune/unsloth_sft.py \
    --data scripts/llm/output/finetune-sharegpt.jsonl \
    --eval-data scripts/llm/output/finetune-sharegpt.val.jsonl \
    --base mistralai/Ministral-3-8B-Base-2512 \
    --out scripts/llm/checkpoints/anima-ministral8b-qlora

  python scripts/llm/finetune/unsloth_dpo.py \
    --data scripts/llm/output/dpo-pairs.jsonl \
    --base scripts/llm/checkpoints/anima-ministral8b-qlora \
    --out scripts/llm/checkpoints/anima-ministral8b-dpo

  bash scripts/llm/finetune/quantize.sh --in scripts/llm/checkpoints/anima-ministral8b-dpo-merged

  export ANIMA_LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
  pnpm llm:eval
EOS

echo
echo "Full walkthrough: docs/llm-build.md"
echo "Summary: $ok passed, $warn warning(s), $fail failure(s)"

if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
exit 0
