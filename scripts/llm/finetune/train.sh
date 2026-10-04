#!/usr/bin/env bash
# One command from prepared JSONL to a trained Anima adapter (and GGUF):
#
#   pre-flight (check-gpu-ready.sh)  →  SFT (unsloth_sft.py)
#   →  DPO (unsloth_dpo.py)  →  GGUF export (export_gguf.py, GPU only)
#
# Production run on a CUDA box (Ministral 3 8B QLoRA, ~12–16 GB VRAM):
#   pnpm llm:dataset                 # or llm:ingest + llm:dataset with real logs
#   pnpm llm:train
#
# Scribe run on a free Colab T4 (what colab_scribe_qlora.ipynb does by hand):
#   ANIMA_TRAIN_BASE=unsloth/Qwen2.5-7B-Instruct-bnb-4bit ANIMA_TRAIN_PREFIX=anima-scribe \
#   ANIMA_TRAIN_SEQ_LEN=2048 pnpm llm:train
#
# CPU smoke test (no GPU, no Unsloth — a few steps on a tiny base, ~5 min):
#   pnpm llm:train -- --smoke
#
# Knobs (env or flags; flags win):
#   ANIMA_TRAIN_BASE      base model id            (--base)      default mistralai/Ministral-3-8B-Base-2512
#   ANIMA_TRAIN_PREFIX    checkpoint/GGUF prefix   (--prefix)    default anima-ministral8b
#   ANIMA_TRAIN_SEQ_LEN   max sequence length      (--seq-len)   default 4096
#   ANIMA_TRAIN_EPOCHS    SFT epochs               (--epochs)    default 1
#   ANIMA_TRAIN_QUANT     GGUF quant               (--quant)     default q4_k_m
#   ANIMA_TRAIN_PYTHON    python binary            (--python)    default .venv/bin/python if present, else python3
#   --skip-dpo | --skip-gguf | --sft-only           stop early
#   --smoke                                        SmolLM2-135M, seq 1024, 12 SFT + 6 DPO steps, no GGUF
#   --extra "--lora-r 32 --no-4bit"                 extra flags passed to BOTH train scripts
#                                                  (bare "--" tokens are ignored: pnpm forwards them)
#
# Outputs:
#   scripts/llm/checkpoints/<prefix>-qlora/   SFT adapter + training_summary.json
#   scripts/llm/checkpoints/<prefix>-dpo/     DPO adapter + training_summary.json
#   scripts/llm/gguf/<prefix>-<quant>.gguf    → ollama create <prefix> -f scripts/llm/Modelfile.<prefix>[-tuned]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

BASE="${ANIMA_TRAIN_BASE:-mistralai/Ministral-3-8B-Base-2512}"
PREFIX="${ANIMA_TRAIN_PREFIX:-anima-ministral8b}"
SEQ_LEN="${ANIMA_TRAIN_SEQ_LEN:-4096}"
EPOCHS="${ANIMA_TRAIN_EPOCHS:-1}"
QUANT="${ANIMA_TRAIN_QUANT:-q4_k_m}"
PYTHON="${ANIMA_TRAIN_PYTHON:-}"
SKIP_DPO=0
SKIP_GGUF=0
SMOKE=0
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:?}"; shift 2 ;;
    --prefix) PREFIX="${2:?}"; shift 2 ;;
    --seq-len) SEQ_LEN="${2:?}"; shift 2 ;;
    --epochs) EPOCHS="${2:?}"; shift 2 ;;
    --quant) QUANT="${2:?}"; shift 2 ;;
    --python) PYTHON="${2:?}"; shift 2 ;;
    --skip-dpo) SKIP_DPO=1; shift ;;
    --skip-gguf) SKIP_GGUF=1; shift ;;
    --sft-only) SKIP_DPO=1; SKIP_GGUF=1; shift ;;
    --smoke) SMOKE=1; shift ;;
    --extra)
      # shellcheck disable=SC2206  # intentional word split of the quoted flag string
      EXTRA+=(${2:?}); shift 2 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    --) shift ;;
    *) echo "unknown arg: $1 (see --help)" >&2; exit 2 ;;
  esac
done

if [[ -z "$PYTHON" ]]; then
  if [[ -x "$ROOT/.venv/bin/python" ]]; then PYTHON="$ROOT/.venv/bin/python"; else PYTHON="python3"; fi
fi

SFT_STEPS=()
DPO_STEPS=()
if [[ "$SMOKE" == "1" ]]; then
  BASE="${ANIMA_TRAIN_BASE:-HuggingFaceTB/SmolLM2-135M-Instruct}"
  PREFIX="${ANIMA_TRAIN_PREFIX:-smoke}"
  SEQ_LEN="${ANIMA_TRAIN_SEQ_LEN:-1024}"
  SKIP_GGUF=1
  SFT_STEPS=(--max-steps 12 --batch-size 2 --grad-accum 2 --logging-steps 2)
  DPO_STEPS=(--max-steps 6 --batch-size 1 --grad-accum 2 --logging-steps 1)
fi

TRAIN="$ROOT/scripts/llm/output/finetune-sharegpt.jsonl"
VAL="$ROOT/scripts/llm/output/finetune-sharegpt.val.jsonl"
DPO="$ROOT/scripts/llm/output/dpo-pairs.jsonl"
SFT_OUT="$ROOT/scripts/llm/checkpoints/${PREFIX}-qlora"
DPO_OUT="$ROOT/scripts/llm/checkpoints/${PREFIX}-dpo"
GGUF_OUT="$ROOT/scripts/llm/gguf"

step() { echo; echo "══ $* ══"; }

step "0/4 pre-flight"
echo "python: $PYTHON ($("$PYTHON" --version 2>&1))"
echo "base:   $BASE"
echo "prefix: $PREFIX   seq-len: $SEQ_LEN   epochs: $EPOCHS"
[[ "$SMOKE" == "1" ]] && echo "mode:   SMOKE (few steps, tiny base, no GGUF)"
bash "$ROOT/scripts/llm/finetune/check-gpu-ready.sh" || {
  echo "pre-flight failed — run: pnpm llm:dataset   (or pnpm llm:dataset -- --rehearse)" >&2
  exit 1
}

VAL_ARGS=()
if [[ -s "$VAL" ]]; then VAL_ARGS=(--eval-data "$VAL"); fi

step "1/4 SFT → $SFT_OUT"
"$PYTHON" "$ROOT/scripts/llm/finetune/unsloth_sft.py" \
  --data "$TRAIN" "${VAL_ARGS[@]}" \
  --base "$BASE" --out "$SFT_OUT" \
  --max-seq-len "$SEQ_LEN" --epochs "$EPOCHS" \
  "${SFT_STEPS[@]}" "${EXTRA[@]}"

FINAL="$SFT_OUT"
if [[ "$SKIP_DPO" == "1" ]]; then
  step "2/4 DPO skipped"
elif [[ ! -s "$DPO" ]]; then
  step "2/4 DPO skipped — no pairs at $DPO (pnpm llm:prepare-dpo)"
else
  step "2/4 DPO → $DPO_OUT"
  "$PYTHON" "$ROOT/scripts/llm/finetune/unsloth_dpo.py" \
    --data "$DPO" --base "$SFT_OUT" --out "$DPO_OUT" \
    --max-seq-len "$SEQ_LEN" \
    "${DPO_STEPS[@]}" "${EXTRA[@]}"
  FINAL="$DPO_OUT"
fi

if [[ "$SKIP_GGUF" == "1" ]]; then
  step "3/4 GGUF export skipped"
else
  step "3/4 GGUF export → $GGUF_OUT/${PREFIX}-${QUANT}.gguf"
  "$PYTHON" "$ROOT/scripts/llm/finetune/export_gguf.py" \
    --adapter "$FINAL" --out "$GGUF_OUT" --prefix "$PREFIX" --quant "$QUANT" --max-seq-len "$SEQ_LEN"
fi

step "4/4 done"
echo "adapter:  $FINAL"
for d in "$SFT_OUT" "$DPO_OUT"; do
  if [[ -f "$d/training_summary.json" ]]; then
    "$PYTHON" - "$d/training_summary.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
loss = f"{s['train_loss_first']:.4f} → {s['train_loss_last']:.4f}" if s.get("train_loss_first") is not None else "n/a"
ev = f"   eval {s['eval_loss']:.4f}" if s.get("eval_loss") is not None else ""
print(f"  {s['stage']:>3}: {s['steps']} steps   loss {loss}{ev}   [{s['backend']}, {s['hardware']}]")
PY
  fi
done
if [[ "$SKIP_GGUF" != "1" ]]; then
  echo
  echo "Next:"
  if [[ -f "$ROOT/scripts/llm/Modelfile.${PREFIX}-tuned" ]]; then
    echo "  ollama create $PREFIX -f scripts/llm/Modelfile.${PREFIX}-tuned"
  else
    echo "  ollama create $PREFIX -f scripts/llm/Modelfile.${PREFIX}"
  fi
  echo "  export ANIMA_LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1 ANIMA_OLLAMA_MODEL_STANDARD=$PREFIX"
  echo "  pnpm llm:eval"
fi
