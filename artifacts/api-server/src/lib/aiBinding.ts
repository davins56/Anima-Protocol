// Shared holder for the Workers AI binding.
// worker.ts sets this at request time; llmFailover / app.ts read it in routes.
// This breaks the circular import between worker.ts → app → worker.ts.

export type WorkersAiBinding = {
  run: (model: string, options: Record<string, unknown>) => Promise<unknown>;
};

export let aiBinding: WorkersAiBinding | undefined;

export function setAiBinding(value: WorkersAiBinding | undefined) {
  aiBinding = value;
}

/** Test helper — drop a leftover binding so chain tests stay isolated. */
export function resetAiBindingForTests() {
  aiBinding = undefined;
}
