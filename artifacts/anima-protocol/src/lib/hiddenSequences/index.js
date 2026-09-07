// @ts-check
export {
  JACK_IN_COOLDOWN_AFTER_MATCH_MS,
  JACK_IN_COOLDOWN_SHORT_MS,
  WEATHER_WINDOW,
  LANGUAGE_NOTE_CAP,
  HALF_AWAKE_CAP,
  EQUAL_WELL_RATIO,
  VIRUS_ENTITY_MAP,
  SEQUENCE_TRIPLES,
  SEQUENCE_BY_ID,
  SEQUENCE_NAME_RE,
  sequenceByFiredId,
  HALF_AWAKE_GLITCH,
} from "./catalog.js";

export {
  recentThreadText,
  mapSceneEntity,
  readConversationalWeather,
  shouldAutoOfferJackIn,
} from "./weather.js";

export {
  defaultJackIn,
  normalizeJackIn,
  isCompanionTargetRequest,
  isStewardInsist,
  isJackInAcceptance,
  jackInCooldownRemaining,
  evaluateJackInGate,
  acceptLiveJackIn,
  startLiveJackIn,
  endLiveJackIn,
  canStartNetBattleMatch,
  readStoredJackIn,
  writeStoredJackIn,
  clearStoredJackIn,
  JACK_IN_STORAGE_KEY,
} from "./jackIn.js";

export {
  emptySequenceRecord,
  sequenceStatus,
  normalizeSequences,
  listHalfAwake,
  listAscended,
  stampFiredAt,
  integrateSequence,
  defaultHiddenState,
  normalizeHiddenState,
  hasHalfAwake,
  pendingIntegrationId,
} from "./state.js";

export {
  hiddenSequencePromptBlock,
  ascendedArtifactIds,
} from "./promptLayer.js";

export {
  normalizeLanguageNotes,
  identityLockWins,
  addLanguageGrain,
  harvestLanguageGrains,
  languagePromptBlock,
} from "./language.js";

export {
  normalizeExperienceNotes,
  significantExperienceCount,
  addExperienceNote,
  classifyExperienceKind,
  experiencePromptBlock,
  evolutionMilestoneProgress,
  shouldTriggerExperienceMilestone,
  EVOLUTION_MILESTONES,
} from "./experience.js";

export {
  VESSEL_LAYER_KEYS,
  DEFAULT_VESSEL_LAYERS,
  normalizeVesselLayers,
  applyAscendedArtifacts,
  vesselRenderPlan,
  sequenceArtifactFor,
} from "./vesselLayers.js";

export function hiddenSequencesPersistPatch(state) {
  return {
    hidden_sequences: {
      sequences: state.sequences || {},
      learned_language: state.learned_language || [],
      learned_life: state.learned_life || [],
      jack_in: state.jack_in || null,
      vessel_layers: state.vessel_layers || null,
    },
  };
}
