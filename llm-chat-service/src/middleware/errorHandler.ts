export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "The self-hosted model took too long to respond.";
  return error instanceof Error ? error.message : "Unexpected server error";
}
