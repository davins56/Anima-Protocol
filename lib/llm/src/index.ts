/**
 * @workspace/llm — the Anima LLM build kit.
 *
 * Runtime surface (what the api-server imports). The dataset pipeline lives
 * under `@workspace/llm/dataset`, and the CLI under `@workspace/llm/cli`, so a
 * lean api-server bundle never pulls the training tooling.
 */
export * from "./registry";

