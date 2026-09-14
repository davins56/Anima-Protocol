#!/usr/bin/env bash
# Quantize a merged HF checkpoint to GGUF Q4_K_M and Q5_K_M for Ollama.
#
# This script does NOT invent a merge. Merge the LoRA first (Unsloth
# FastLanguageModel.save_pretrained_merged, or peft merge_and_unload), then:
#
#   bash scripts/llm/finetune/quantize.sh \
#     --in scripts/llm/checkpoints/anima-ministral8b-dpo-merged
#
# Requires llama.cpp convert + llama-quantize on PATH (or LLAMA_CPP=...).
# Will not run quantization if those binaries are missing — it prints the
# commands instead. Never run this as a substitute for CUDA SFT.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IN=""
OUT_DIR="$ROOT/scripts/llm/gguf"
PREFIX="anima-ministral8b"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --in) IN="${2:-}"; shift 2 ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

CONVERT="${LLAMA_CPP_CONVERT:-}"
QUANT="${LLAMA_CPP_QUANTIZE:-}"

find_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  if [[ -n "${LLAMA_CPP:-}" && -x "${LLAMA_CPP}/$name" ]]; then echo "${LLAMA_CPP}/$name"; return; fi
  if [[ -n "${LLAMA_CPP:-}" && -x "${LLAMA_CPP}/build/bin/$name" ]]; then echo "${LLAMA_CPP}/build/bin/$name"; return; fi
  echo ""
}

if [[ -z "$CONVERT" ]]; then
  CONVERT="$(find_tool convert_hf_to_gguf.py)"
  if [[ -z "$CONVERT" && -n "${LLAMA_CPP:-}" && -f "${LLAMA_CPP}/convert_hf_to_gguf.py" ]]; then
    CONVERT="${LLAMA_CPP}/convert_hf_to_gguf.py"
  fi
fi
if [[ -z "$QUANT" ]]; then
  QUANT="$(find_tool llama-quantize)"
  if [[ -z "$QUANT" ]]; then QUANT="$(find_tool quantize)"; fi
fi

echo "Anima LLM — GGUF quantize (Q4_K_M + Q5_K_M)"
echo

if [[ -z "$IN" ]]; then
  echo "Pass --in <merged-hf-checkpoint-dir> after SFT+DPO merge."
  echo "This environment will not run quantization without llama.cpp."
  echo
  echo "Expected commands on the CUDA host:"
  echo "  python \$LLAMA_CPP/convert_hf_to_gguf.py $IN --outfile $OUT_DIR/${PREFIX}-f16.gguf --outtype f16"
  echo "  llama-quantize $OUT_DIR/${PREFIX}-f16.gguf $OUT_DIR/${PREFIX}-q4_k_m.gguf Q4_K_M"
  echo "  llama-quantize $OUT_DIR/${PREFIX}-f16.gguf $OUT_DIR/${PREFIX}-q5_k_m.gguf Q5_K_M"
  echo "  ollama create anima-ministral8b -f scripts/llm/Modelfile.anima-ministral8b"
  echo "  pnpm llm:eval"
  exit 2
fi

if [[ ! -d "$IN" ]]; then
  echo "checkpoint dir not found: $IN" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
F16="$OUT_DIR/${PREFIX}-f16.gguf"
Q4="$OUT_DIR/${PREFIX}-q4_k_m.gguf"
Q5="$OUT_DIR/${PREFIX}-q5_k_m.gguf"

if [[ -z "$CONVERT" || -z "$QUANT" ]]; then
  echo "llama.cpp convert/quantize not on PATH."
  echo "Install https://github.com/ggerganov/llama.cpp and set LLAMA_CPP=/path/to/llama.cpp"
  echo
  echo "Then:"
  echo "  python \$LLAMA_CPP/convert_hf_to_gguf.py $IN --outfile $F16 --outtype f16"
  echo "  llama-quantize $F16 $Q4 Q4_K_M"
  echo "  llama-quantize $F16 $Q5 Q5_K_M"
  exit 2
fi

if [[ "$CONVERT" == *.py ]]; then
  python3 "$CONVERT" "$IN" --outfile "$F16" --outtype f16
else
  "$CONVERT" "$IN" --outfile "$F16" --outtype f16
fi
"$QUANT" "$F16" "$Q4" Q4_K_M
"$QUANT" "$F16" "$Q5" Q5_K_M

echo "Wrote:"
echo "  $Q4"
echo "  $Q5"
echo "Create the Ollama tag with scripts/llm/Modelfile.anima-ministral8b"
echo "Then: pnpm llm:eval"
