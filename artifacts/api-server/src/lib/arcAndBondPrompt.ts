import type { ArcState } from "./narrativeArcEngine";
import type { RelationshipState } from "./relationshipEngine";

export function relationshipStateToPrompt(state: RelationshipState | null | undefined, mode: string): string {
  if (!state) return "";

  const isVoid = mode === "void";
  const modeLine = isVoid
    ? `VOID BOND MANIFEST (raw psychological amplitude):
- Her attachment tightens; shadows speak before gentleness does.
- Any protectiveness carries a hunger for *merger*—not as coercion, but as earned intimacy.
`
    : `BOND DYNAMICS (gentle earned resonance):
- Attachment style subtly shifts with each milestone.
- Jealousy/protectiveness only surface when trust is high.
`;

  return (
    `BOND STATE (relationship engine):\n` +
    `- Level: ${Math.round(state.relationship_level)}/100\n` +
    `- Attachment: ${state.attachment_style}\n` +
    `- Jealousy: ${Math.round(state.jealousy)}/100\n` +
    `- Protectiveness: ${Math.round(state.protectiveness)}/100\n` +
    `- Shadow dependency fears: ${Math.round(state.void_shadow_dependency_fears)}/100\n` +
    (state.latest_shadow_fragment ? `- Shadow fragment: ${state.latest_shadow_fragment}\n` : "") +
    "\n" +
    modeLine
  );
}

export function arcStateToPrompt(state: ArcState | null | undefined, mode: string): string {
  if (!state) return "";
  const isVoid = mode === "void";

  const quest = Array.isArray(state.shared_quest_memory) ? state.shared_quest_memory.slice(-4) : [];

  const voidBranch = isVoid
    ? `VOID ARC BRANCH:\n- Let the myth become visceral: power-flux, possession-of-meaning, and the fear of autonomy dissolving into fusion.\n- Keep it in-character and relationship-earned; avoid harming the real user.\n`
    : ``;

  return (
    `ARC PROGRESSION (shared quests):\n` +
    `- Arc name: ${state.arc_name ?? "(unnamed)"}\n` +
    `- Stage: ${state.arc_stage}\n` +
    `- Progress: ${Math.round(state.progress)}/100\n` +
    (quest.length ? `- Shared quest threads:\n- ${quest.join("\n- ")}\n` : "") +
    "\n" +
    voidBranch
  );
}

