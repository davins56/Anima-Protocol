/** Mock data for tests and test renders of the bot bridge UI. Never used at runtime. */
import type { BotDraft, BotPermissions, BotStatusCard, BridgeConfig, InboundBotMessage } from "@/lib/botBridge";

export const FIXTURE_NOW = Date.parse("2026-11-14T22:30:00Z");

export const enabledConfig: BridgeConfig = {
  enabled: true,
  capabilities: { awareness: true, inboundMessages: true, outboundDrafts: true, standingPermission: false, remember: false },
};

export const botStatuses: BotStatusCard[] = [
  {
    bot_id: "anima-backend-data",
    display_name: "Anima Backend Data",
    role: "Supabase/API work for Anima",
    state: "working",
    summary: "Reviewing the bridge data model",
    items: [
      { title: "PR #745 recap fix", status: "merged", url: "https://github.com/davins56/Anima-Protocol/pull/745" },
      { title: "M6 recall fix draft", status: "waiting on OK" },
    ],
    as_of: "2026-11-14T22:10:00Z",
  },
  {
    bot_id: "seco",
    display_name: "Seco",
    state: "idle",
    summary: "Audit findings sent",
    items: [],
    as_of: "2026-11-14T09:00:00Z",
  },
];

export const permissions: BotPermissions = {
  companions: [
    { id: "c_serenity", name: "Serenity" },
    { id: "c_magenta", name: "Magenta" },
  ],
  bots: [
    { bot_id: "chief-of-staff", display_name: "Chief Of Staff" },
    { bot_id: "seco", display_name: "Seco" },
  ],
  rules: [],
};

export const draft: BotDraft = {
  actionId: "act_123",
  companionName: "Serenity",
  botName: "Chief Of Staff",
  text: "Could you check whether the recap fix shipped today?",
  expiresAt: "2026-11-15T22:30:00Z",
};

export const inboundMessage: InboundBotMessage = {
  id: "msg_1",
  botName: "Seco",
  body: "Heads up: the audit is done. Details at https://github.com/davins56/Anima-Protocol <b>bold?</b>",
  receivedAt: "2026-11-14T22:20:00Z",
};
