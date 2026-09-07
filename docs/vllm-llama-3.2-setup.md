# Serving Llama 3.2 Vision (`meta-llama/Llama-3.2-11B-Vision-Instruct`) with vLLM

This guide addresses common errors and setup requirements when serving **Llama 3.2 Vision** (`meta-llama/Llama-3.2-11B-Vision-Instruct` or `Llama-3.2-90B-Vision-Instruct`) using `vLLM` and Hugging Face `transformers`.

---

## Error Analysis & Root Causes

### Error 1: `ValueError: Unrecognized model in .../Llama-3.2-11B-Vision-Instruct` (from `IMG_4137.png`)

```
Traceback (most recent call last):
  File ".../vllm/engine/arg_utils.py", line 700, in create_engine_configs
    model_config = ModelConfig(...)
  File ".../vllm/config.py", line 197, in __init__
    self.hf_config = get_config(model, trust_remote_code, revision, code_revision)
  File ".../vllm/transformers_utils/config.py", line 53, in get_config
    config = AutoConfig.from_pretrained(...)
  File ".../transformers/models/auto/configuration_auto.py", line 1022, in from_pretrained
    raise ValueError(
ValueError: Unrecognized model in /root/.cache/huggingface/hub/models--meta-llama--Llama-3.2-11B-Vision-Instruct/...
Should have a `model_type` key in its config.json, or use one of the following model types: ...
```

* **Cause:** The installed version of `transformers` (and/or `vllm`) is too old to recognize the `mllama` model architecture specified in Llama 3.2 Vision's `config.json`.
* **Fix:** Upgrade `transformers` to `>= 4.45.0` and `vllm` to `>= 0.6.3`.

---

### Error 2: `AssertionError` in `vllm/engine/arg_utils.py` (from `IMG_4138.png`)

```
Traceback (most recent call last):
  File ".../vllm/entrypoints/openai/api_server.py", line ...
  File ".../vllm/engine/async_llm_engine.py", line 583, in from_engine_args
    engine = cls.from_engine_args_usage(...)
  File ".../vllm/engine/async_llm_engine.py", line 524, in from_engine_args_usage
    engine = cls(...)
  File ".../vllm/engine/async_llm_engine.py", line 369, in __init__
    self.engine = self._init_engine(*args, **kwargs)
  File ".../vllm/engine/async_llm_engine.py", line 439, in _init_engine
    return EngineClass.from_engine_args(...)
  File ".../vllm/engine/llm_engine.py", line 263, in from_engine_args
    engine_config = engine_args.create_engine_configs()
  File ".../vllm/engine/arg_utils.py", line 822, in create_engine_configs
    assert self.image_input_type is not None
AssertionError
```

* **Cause:** In older or transition builds of vLLM, multimodal vision models required explicit multimodal options or flags to configure `image_input_type`. When serving Llama 3.2 Vision, `--max-model-len` and multimodal prompt limit options (`--limit-mm-per-prompt image=4`) must be specified when starting the vLLM OpenAI API server.
* **Fix:** Update `vllm` to standard release `v0.6.3` or newer (where `mllama` vision models are natively integrated) and pass appropriate vision parameters.

---

## Recommended Resolution Steps

### 1. Upgrade Environment Dependencies

Ensure Python environment has updated packages:

```bash
pip install --upgrade "vllm>=0.6.3" "transformers>=4.45.0" "accelerate>=0.34.0"
```

Verify Hugging Face authentication (since Meta Llama 3.2 models are gated):

```bash
huggingface-cli login
```

### 2. Start vLLM OpenAI API Server

Launch `vllm` with Llama 3.2 11B Vision Instruct:

```bash
python3 -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.2-11B-Vision-Instruct \
  --trust-remote-code \
  --max-model-len 8192 \
  --limit-mm-per-prompt image=4 \
  --port 8000
```

For multi-GPU setups (tensor parallelism):

```bash
python3 -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.2-11B-Vision-Instruct \
  --tensor-parallel-size 2 \
  --max-model-len 8192 \
  --limit-mm-per-prompt image=4 \
  --port 8000
```

### 3. Connect Anima Protocol to vLLM

Configure your Anima Protocol API server environment (`.env`):

```env
ANIMA_LOCAL_LLM_BACKEND=vllm
ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
ANIMA_VLLM_MODEL=meta-llama/Llama-3.2-11B-Vision-Instruct
```

Test the connection:

```bash
curl -s http://localhost:8080/api/healthz/llm | jq
```
