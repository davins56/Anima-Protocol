import { animaApi } from '@/api/animaApi';
import { buildCharacterPrompt } from './buildCharacterPrompt';
import { parseGroupResponse } from './parseGroupResponse';

export async function sendChatMessage({
  content,
  activeSession,
  characters,
  user,
  aiBehaviorConfig,
  scenario,
  emotionalMemory,
  relationships,
  characterEmotions,
  loreEntries,
  calendar,
  adultMode,
  responseLength,
  characterEvolutions,
  setActiveSession,
  setRelationships,
  setCharacterEmotions,
}) {
  if (!activeSession) return;

  const isContinue = !content || !content.trim();
  if (isContinue && activeSession.mode !== "group") return;

  const updatedMessages = isContinue
    ? [...(activeSession.messages || [])]
    : [...(activeSession.messages || []), { role: "user", content, timestamp: new Date().toISOString() }];

  const typingMsg = { role: "assistant", content: "...", character_name: "__typing__", timestamp: new Date().toISOString() };
  setActiveSession((prev) => ({ ...prev, messages: [...updatedMessages, typingMsg] }));

  try {
    const activeChar = activeSession.character_id
      ? characters.find((c) => c.id === activeSession.character_id)
      : null;

    let systemPrompt = "";

    if (activeSession.mode === "solo" && activeChar) {
      const relCtx = buildRelationshipContext(activeChar.id, relationships);
      const persistentMemCtx = emotionalMemory.buildMemoryContext();
      const behaviorInstructions = buildBehaviorInstructions(aiBehaviorConfig);
      const lengthGuide = buildLengthGuide(responseLength);
      const adultInstruction = adultMode
        ? "\nCONTENT RATING: Adult mode is enabled by the user (18+). You may engage in explicit, sexual, and lewd content when the story naturally leads there.\n"
        : "";

      systemPrompt = buildCharacterPrompt({
        character: activeChar,
        scenario,
        emotionalMemoryContext: persistentMemCtx,
        relationshipContext: relCtx,
        locationContext: "",
        loreContext: buildLoreContext(loreEntries),
        companionModeInstruction: user?.selected_mode ? `\nMode: ${user.selected_mode}\n` : "",
        behaviorInstructions,
        adultInstruction,
        lengthGuide,
      });
    } else {
      systemPrompt = "Continue this story naturally. Respond with vivid, immersive prose.";
    }

    const charName = activeChar?.name || "Serenity";

    // Ensure a conversation record exists in the DB for this session
    if (!activeSession._conversationId) {
      const conv = await animaApi.conversations.create(
        activeChar ? `Chat with ${activeChar.name}` : "Story session"
      );
      activeSession._conversationId = conv.id;
      setActiveSession((prev) => ({ ...prev, _conversationId: conv.id }));
    }

    const conversationId = activeSession._conversationId;
    const userContent = isContinue
      ? `Continue as ${charName}. Make real decisions based on who you are.`
      : content;

    let fullResponse = "";

    for await (const chunk of animaApi.sendMessage(conversationId, userContent, systemPrompt)) {
      if (chunk.done) break;
      if (chunk.content) {
        fullResponse += chunk.content;
        // Stream partial response into the UI
        const partialMsg = {
          role: "assistant",
          content: fullResponse,
          character_name: charName,
          timestamp: new Date().toISOString(),
        };
        setActiveSession((prev) => ({
          ...prev,
          messages: [...updatedMessages, partialMsg],
        }));
      }
    }

    const strippedResult = fullResponse.replace(/\[(EMOTION|LOCATION):([^\]]+)\]/gi, "").trim();

    let newAiMessages;
    if (activeSession.mode === "group") {
      const groupChars = characters.filter((c) => activeSession.group_character_ids?.includes(c.id));
      newAiMessages = parseGroupResponse(strippedResult, groupChars, charName);
    } else {
      newAiMessages = [{ role: "assistant", content: strippedResult || fullResponse, character_name: charName, timestamp: new Date().toISOString() }];
    }

    const finalMessages = [...updatedMessages, ...newAiMessages];
    setActiveSession((prev) => ({ ...prev, messages: finalMessages }));

    // Record emotional memory
    if (activeChar) {
      emotionalMemory.recordMemory({
        memory_type: 'emotional_moment',
        subject: charName,
        description: `Conversation about: ${content?.slice(0, 100) || 'continued'}...`,
        emotional_weight: Math.floor(Math.random() * 3) + 4,
        relationship_impact: 1,
      }).catch(() => {});
    }
  } catch (err) {
    console.error(err);
    setActiveSession((prev) => ({
      ...prev,
      messages: (prev.messages || []).filter((m) => m.character_name !== "__typing__"),
    }));
  }
}

function buildRelationshipContext(charId, relationships) {
  const rel = relationships[charId];
  if (!rel) return "";
  const tierGuides = {
    hostile: "You deeply distrust or resent the player.",
    cold: "You are guarded and distant.",
    neutral: "You are professionally cordial.",
    warm: "You feel genuine fondness.",
    close: "You trust the player deeply.",
    devoted: "You are wholly devoted to the player.",
  };
  return `\nRELATIONSHIP: Tier "${rel.tier}" (score ${rel.score}/100). ${tierGuides[rel.tier] || ""}\n`;
}

function buildBehaviorInstructions(config) {
  if (!config) return "";
  return `AI BEHAVIOR: Verbosity ${config.verbosity}%, Emotional intensity ${config.emotional_intensity}%, Lore compliance ${config.lore_compliance}%`;
}

function buildLengthGuide(length) {
  if (length === "short") return "Keep your response brief (1-2 sentences).";
  if (length === "long") return "Feel free to explore deeply (2-4 paragraphs if needed).";
  return "Aim for 1-2 paragraphs. Be natural.";
}

function buildLoreContext(loreEntries) {
  if (!loreEntries?.length) return "";
  const lines = loreEntries.slice(0, 10).map(e => `- ${e.subject}: ${e.fact}`).join("\n");
  return `\nWORLD LORE:\n${lines}\n`;
}
