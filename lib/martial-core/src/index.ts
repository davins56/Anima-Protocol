/**
 * @workspace/martial-core: pure martial-arts style library for animas (#768).
 * No I/O, no routes, no model calls. Feature flag: ANIMA_MARTIAL_ARTS (server).
 */
export * from "./types";
export * from "./hash";
export { SEED_LIBRARY_VERSION, SEED_STYLES } from "./library.seed";
export * from "./library";
export * from "./battle";
export * from "./lexicon";
export * from "./select";
export * from "./explain";
export * from "./tone";
export * from "./techniques";
export * from "./narrate";
export * from "./profile";
export * from "./builtins";

/** Bumped when the library's public shape changes (not the catalog content). */
export const MARTIAL_CORE_VERSION = 1;
