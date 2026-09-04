import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  acceptLiveJackIn,
  addExperienceNote,
  applyAscendedArtifacts,
  evaluateJackInGate,
  harvestLanguageGrains,
  hasHalfAwake,
  hiddenSequencePromptBlock,
  integrateSequence,
  languagePromptBlock,
  experiencePromptBlock,
  normalizeHiddenState,
  pendingIntegrationId,
  readConversationalWeather,
  writeStoredJackIn,
} from "@/lib/hiddenSequences";

function persistAnimaHidden(animaId, hidden) {
  if (!animaId) return;
  base44.entities.Anima.update(animaId, { hidden_sequences: hidden }).catch(() => {});
}

/**
 * Live-thread weather, jack-in offer, Sequence prompt layer, and return-from-match.
 */
export function useHiddenSequencesThread({
  session,
  anima,
  messages,
  userText,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [hidden, setHidden] = useState(() =>
    normalizeHiddenState(anima?.hidden_sequences),
  );
  const loadedId = useRef(null);
  const spokeFirst = useRef(false);

  useEffect(() => {
    if (!anima?.id || loadedId.current === anima.id) return;
    loadedId.current = anima.id;
    setHidden(normalizeHiddenState(anima.hidden_sequences));
  }, [anima?.id, anima?.hidden_sequences]);

  const weatherState = useMemo(
    () =>
      readConversationalWeather(messages, {
        opening_scene: session?.opening_scene,
        therapy_mode: session?.therapy_mode,
        companion_mode: session?.companion_mode,
        jack_in: hidden.jack_in,
      }),
    [messages, session?.opening_scene, session?.therapy_mode, session?.companion_mode, hidden.jack_in],
  );

  const sameEntity =
    weatherState.entity?.name &&
    hidden.jack_in.last_entity_name &&
    weatherState.entity.name === hidden.jack_in.last_entity_name;

  const gateFor = useCallback(
    (text) =>
      evaluateJackInGate({
        weather: weatherState.weather,
        jackIn: hidden.jack_in,
        userText: text,
        hasHalfAwake: hasHalfAwake(hidden.sequences),
        sameEntityInScene: Boolean(sameEntity),
      }),
    [weatherState, hidden.jack_in, hidden.sequences, sameEntity],
  );

  const gate = useMemo(() => gateFor(userText), [gateFor, userText]);

  const commit = useCallback(
    (next) => {
      setHidden(next);
      persistAnimaHidden(anima?.id, next);
    },
    [anima?.id],
  );

  const acceptJackIn = useCallback(() => {
    const live = acceptLiveJackIn(hidden.jack_in, {
      session_id: session?.id,
      anima_id: anima?.id,
      entity: weatherState.entity || hidden.jack_in.entity,
    });
    const next = { ...hidden, jack_in: live };
    commit(next);
    writeStoredJackIn(live);
    return live;
  }, [hidden, session?.id, anima?.id, weatherState.entity, commit]);

  const consumeReturn = useCallback(() => {
    const after = searchParams.get("after_jack_in");
    if (!after) return { speakFirst: false, pendingId: null };
    const pendingId = pendingIntegrationId(hidden.sequences);
    return { speakFirst: true, pendingId };
  }, [searchParams, hidden.sequences]);

  const finishIntegration = useCallback(
    (replyText) => {
      const pendingId = pendingIntegrationId(hidden.sequences);
      if (!pendingId) return hidden;
      const tripleName = pendingId;
      const integrated = integrateSequence(hidden.sequences, pendingId, {
        title: tripleName,
        body: String(replyText || "").slice(0, 400),
      });
      const life = addExperienceNote(hidden.learned_life, {
        kind: "notice",
        title: `Ascent · ${tripleName}`,
        body: String(replyText || "").slice(0, 280),
      }, { languageCount: hidden.learned_language?.length || 0 });
      const layers = applyAscendedArtifacts(hidden.vessel_layers, integrated.sequences);
      const next = {
        ...hidden,
        sequences: integrated.sequences,
        learned_life: life.notes,
        vessel_layers: layers,
        jack_in: { ...hidden.jack_in, speak_first: false },
      };
      commit(next);
      return next;
    },
    [hidden, commit],
  );

  const harvestFromTurn = useCallback(
    (stewardText, identityText) => {
      const harvested = harvestLanguageGrains(hidden.learned_language, stewardText, {
        identityText,
        experienceCount: (hidden.learned_life || []).filter((n) => n.significant !== false).length,
      });
      if (harvested.notes === hidden.learned_language) return hidden;
      const next = { ...hidden, learned_language: harvested.notes };
      commit(next);
      return next;
    },
    [hidden, commit],
  );

  const promptBlock = useMemo(() => {
    const pendingId = pendingIntegrationId(hidden.sequences);
    const speakFirst =
      hidden.jack_in.speak_first === true || searchParams.get("after_jack_in") === "1";
    return [
      hiddenSequencePromptBlock({
        sequences: hidden.sequences,
        weather: weatherState.weather,
        entity: weatherState.entity,
        offerJackIn: gate.offer,
        refuseJackIn: gate.refuse,
        refuseMessage: gate.message,
        speakFirst,
        pendingIntegration: pendingId,
      }),
      languagePromptBlock(hidden.learned_language),
      experiencePromptBlock(hidden.learned_life),
    ].join("");
  }, [hidden, weatherState, gate, searchParams]);

  const clearReturnFlag = useCallback(() => {
    if (!searchParams.get("after_jack_in")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("after_jack_in");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return {
    hidden,
    weather: weatherState.weather,
    entity: weatherState.entity,
    gate,
    gateFor,
    promptBlock,
    acceptJackIn,
    consumeReturn,
    finishIntegration,
    harvestFromTurn,
    clearReturnFlag,
    spokeFirst,
  };
}
