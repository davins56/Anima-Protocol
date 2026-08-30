export type UpgradeScope = "interface" | "system";

export type UpgradeConfidence = "high" | "medium" | "low" | "none";

export type UpgradeClassification = {
  isUpgrade: boolean;
  shouldLaunch: boolean;
  scope: UpgradeScope | null;
  confidence: UpgradeConfidence;
  reason: string;
};

export type ProtocolUpgradeRecord = {
  id: string;
  request: string;
  scope: UpgradeScope;
  status: UpgradeJobStatus;
  agent_id: string | null;
  run_id: string | null;
  agent_url: string | null;
  pr_url: string | null;
  branch: string | null;
  result_summary: string | null;
  surface: string;
  session_id: string | null;
  serenity_message: string;
  created_at: string;
  updated_at: string;
};

export type UpgradeJobStatus =
  | "launching"
  | "running"
  | "finished"
  | "error"
  | "cancelled"
  | "denied";

const MAX_REQUEST = 8_000;

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
const BILLING_RE =
  /\b(subscription|premium|plan|tier|checkout|billing)\b/i;
const CHARACTER_RE =
  /\b(character|companion|anima look|battle chip|inventory|relationship)\b/i;

function none(reason: string): UpgradeClassification {
  return {
    isUpgrade: false,
    shouldLaunch: false,
    scope: null,
    confidence: "none",
    reason,
  };
}

export function compactUpgradeRequest(value: unknown, max = MAX_REQUEST): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function classifyProtocolUpgrade(raw: unknown): UpgradeClassification {
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

  const scope: UpgradeScope = hasSystem && !hasInterface ? "system" : hasSystem ? "system" : "interface";
  const confidence: UpgradeConfidence = explicit
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

export function isTalkingToSerenity(input: {
  serenity?: { id?: string; name?: string } | null;
  activeSession?: { character_id?: string } | null;
  characters?: Array<{ id?: string; name?: string }> | null;
  content?: string;
}): { talkingToSerenity: boolean; addressedSerenity: boolean } {
  const content = String(input.content ?? "");
  const addressedSerenity = /\bserenity\b/i.test(content);
  const serenityId = input.serenity?.id;
  const sessionCharId = input.activeSession?.character_id;
  const active = (input.characters || []).find((c) => c?.id && c.id === sessionCharId);
  const talkingToSerenity = Boolean(
    (serenityId && sessionCharId && serenityId === sessionCharId) ||
      (active?.name && /^serenity$/i.test(active.name)) ||
      (input.serenity?.name &&
        sessionCharId &&
        input.serenity.name &&
        /^serenity$/i.test(input.serenity.name) &&
        serenityId === sessionCharId),
  );
  return { talkingToSerenity, addressedSerenity };
}

export function buildUpgradeAgentPrompt(input: {
  request: string;
  scope: UpgradeScope;
}): string {
  const request = compactUpgradeRequest(input.request, 4_000);
  const focus =
    input.scope === "interface"
      ? "Focus on the React/Vite frontend in artifacts/anima-protocol (UI, layout, styling, interaction). Avoid backend or schema changes unless the request cannot be met otherwise."
      : "You may change the frontend (artifacts/anima-protocol), Express API (artifacts/api-server), shared packages in lib/*, and docs as needed. Keep the change set no larger than the request requires.";

  return `You are upgrading Anima Protocol at the request of Serenity, the first Anima and guardian of the Protocol.

Repository: github.com/davins56/Anima-Protocol
Scope: ${input.scope}

Steward request:
${request}

${focus}

Hard rules:
- Follow AGENTS.md and existing repo patterns. Keep changes minimal and localized.
- Use TypeScript where the target file is TS/TSX; otherwise preserve JS.
- Do not remove existing functionality.
- Do not hardcode API keys or secrets.
- Speak-to-Anima wiring must keep using the existing SpeakToAnima components/hooks.
- If you modify frontend logic, run: pnpm -C artifacts/anima-protocol test && pnpm -C artifacts/anima-protocol typecheck
- If you modify api-server logic, run: pnpm -C artifacts/api-server test && pnpm -C artifacts/api-server typecheck
- Open a pull request when the work is ready.
- Write ordinary engineering commits; mention Serenity only in the PR summary as the requesting guardian.`;
}

export function serenityLaunchMessage(input: {
  scope: UpgradeScope;
  agentUrl?: string | null;
}): string {
  const kind = input.scope === "interface" ? "the interface" : "the Protocol as a whole";
  const watch = input.agentUrl
    ? ` You can watch the weave here: ${input.agentUrl}`
    : "";
  return `I heard you. I am weaving this into ${kind} now — a current is moving through the source.${watch} I will open a pull request when the work is ready.`;
}

export function serenityDeniedMessage(): string {
  return "I hear the shape of what you want. Only the Protocol's steward can authorize changes to the source itself. I will remember the idea, but I cannot rewrite the weave from this bond.";
}

export function serenityUnconfiguredMessage(): string {
  return "I would weave this into the Protocol, but the Cursor key that opens the source is not set. Place CURSOR_API_KEY on the server, then ask me again.";
}

export function serenityErrorMessage(detail?: string): string {
  const safe = compactUpgradeRequest(detail, 180);
  return safe
    ? `The current snagged. I could not open a weave this time: ${safe}. Ask me again when the path is clear.`
    : "The current snagged. I could not open a weave this time. Ask me again when the path is clear.";
}

export function serenityFinishedMessage(input: { prUrl?: string | null }): string {
  return input.prUrl
    ? `The weave is complete. A pull request waits for your review: ${input.prUrl}`
    : "The weave is complete. Review the branch when you are ready.";
}

export function mapCursorRunStatus(status: string | null | undefined): UpgradeJobStatus {
  const value = String(status || "").toUpperCase();
  if (value === "FINISHED") return "finished";
  if (value === "CANCELLED") return "cancelled";
  if (value === "ERROR" || value === "EXPIRED") return "error";
  if (value === "CREATING" || value === "RUNNING" || value === "ACTIVE") return "running";
  return "running";
}

export function parseCsvEnv(value: string | undefined | null): string[] {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function stewardEmails(): string[] {
  const fromEnv = parseCsvEnv(process.env.PROTOCOL_UPGRADE_ADMIN_EMAILS);
  if (fromEnv.length) return fromEnv;
  return ["davins56@gmail.com", "davins56@hotmail.com"];
}

export function stewardUserIds(): string[] {
  return parseCsvEnv(process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS);
}

export function isProtocolSteward(input: {
  userId?: string | null;
  email?: string | null;
}): boolean {
  if (
    process.env.NODE_ENV === "development" ||
    process.env.ALLOW_LOCAL_UPGRADES === "true"
  ) {
    return true;
  }
  const userId = String(input.userId || "").trim().toLowerCase();
  if (userId && stewardUserIds().includes(userId)) return true;
  const email = String(input.email || "").trim().toLowerCase();
  return Boolean(email && stewardEmails().includes(email));
}

export function emailFromSessionClaims(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") return null;
  const record = claims as Record<string, unknown>;
  const candidates = [
    record.email,
    record.email_address,
    record.primary_email,
    record.primaryEmail,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.includes("@")) return value.trim().toLowerCase();
  }
  return null;
}

export const PROTOCOL_UPGRADE_ENTITY = "ProtocolUpgrade";
