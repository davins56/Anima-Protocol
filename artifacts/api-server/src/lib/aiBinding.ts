// Shared holder for the Workers AI binding.
// worker.ts sets this at request time; app.ts reads it in routes.
// This breaks the circular import between worker.ts → app → worker.ts.
export let aiBinding: { run: (model: string, options: Record<string, unknown>) => Promise<unknown> } | undefined;

export function setAiBinding(value: typeof aiBinding) {
  aiBinding = value;
}