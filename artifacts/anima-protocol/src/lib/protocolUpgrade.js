export function compactUpgradeRequest(value, max = 8000) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const ACTION_RE =
  /\b(upgrade|improve|redesign|overhaul|revamp|modernize|rebuild|restyle)\b/i;
const CHANGE_INTERFACE_RE =
  /\b(change|tweak|fix|add|update)\b.{0,48}\b(interface|ui|ux|frontend|front-end|layout|theme|dashboard|look|appearance)\b/i;
const INTERFACE_RE =
  /\b(interface|ui|ux|frontend|front-end|layout|theme|dashboard|look|appearance|visuals?|sidebar|toolbar|chat input)\b/i;
const SYSTEM_RE =
  /\b(system|protocol|source code|codebase|backend|architecture|entire app|app as a whole|anima protocol itself)\b/i;
const WHOLE_RE = /\b(as a whole|the whole (app|system|protocol)|system as a whole)\b/i;
const EXPLICIT_RE =
  /\b(upgrade|redesign|overhaul|revamp|rebuild)\s+(the\s+)?(interface|ui|ux|system|protocol|source( code)?|codebase|frontend|front-end)\b/i;
const BILLING_RE = /\b(subscription|premium|plan|tier|checkout|billing)\b/i;
const CHARACTER_RE =
  /\b(character|companion|anima look|battle chip|inventory|relationship)\b/i;

function none(reason) {
  return {
    isUpgrade: false,
    shouldLaunch: false,
    scope: null,
    confidence: "none",
    reason,
  };
}

export function classifyProtocolUpgrade(raw) {
  const text = compactUpgradeRequest(raw);
  if (!text) return none("empty");

  const billing = BILLING_RE.test(text);
  const character = CHARACTER_RE.test(text);
  const hasInterface = INTERFACE_RE.test(text);
  const hasSystem = SYSTEM_RE.test(text) || WHOLE_RE.test(text);
  const hasAction = ACTION_RE.test(text) || CHANGE_INTERFACE_RE.test(text);
  const explicit = EXPLICIT_RE.test(text);
  const serenityNamed = /\bserenity\b/i.test(text);

  if (billing && !hasInterface && !hasSystem) {
    return none("billing_or_subscription");
  }
  if (character && !hasInterface && !hasSystem && !explicit) {
    return none("character_or_companion");
  }
  if (!hasAction && !explicit) {
    return none("no_upgrade_action");
  }
  if (!hasInterface && !hasSystem && !explicit) {
    return none("no_product_target");
  }

  const scope = hasSystem ? "system" : "interface";
  const confidence = explicit
    ? "high"
    : serenityNamed || (hasAction && (hasInterface || hasSystem))
      ? "medium"
      : "low";

  return {
    isUpgrade: true,
    shouldLaunch: confidence === "high" || confidence === "medium",
    scope,
    confidence,
    reason: explicit ? "explicit_upgrade" : serenityNamed ? "serenity_named" : "action_and_target",
  };
}

export function isTalkingToSerenity({
  serenity,
  activeSession,
  characters,
  content,
} = {}) {
  const addressedSerenity = /\bserenity\b/i.test(String(content ?? ""));
  const serenityId = serenity?.id;
  const sessionCharId = activeSession?.character_id;
  const active = (characters || []).find((c) => c?.id && c.id === sessionCharId);
  const talkingToSerenity = Boolean(
    (serenityId && sessionCharId && serenityId === sessionCharId) ||
      (active?.name && /^serenity$/i.test(active.name)),
  );
  return { talkingToSerenity, addressedSerenity };
}
