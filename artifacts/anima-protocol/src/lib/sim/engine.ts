/**
 * The deterministic 4D battle engine lives in lib/sim-core (@workspace/sim-core)
 * so api-server can replay and validate the exact same rules. lib/sim/{engine,
 * rules,consequences} are the app-facing entry points.
 */
export * from "@workspace/sim-core";
