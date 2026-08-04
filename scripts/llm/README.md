# Anima Protocol LLM starter stack

This folder contains a lightweight starter path for building an Anima Protocol–specific LLM stack.

## Goals
- Keep the app model-agnostic so you can swap providers.
- Export conversation data in a training-friendly format.
- Make it easy to attach character, scenario, memory, and relationship context.

## Suggested first setup
- Inference provider: Groq for fast iteration, or an open-weight model via vLLM later.
- Fine-tuning target: Qwen 2.5 7B Instruct or Llama 3.1 8B Instruct.
- Training data format: JSONL with character/scenario/memory context and assistant responses.
