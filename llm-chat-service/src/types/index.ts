export type Role = "system" | "user" | "assistant";

export type ChatMessage = {
  role: Role;
  content: string;
};

export type ChatRequest = {
  conversation_id?: string;
  messages?: ChatMessage[];
  message?: string;
  system_prompt?: string;
  temperature?: number;
};

export type FeedbackRequest = {
  conversation_id: string;
  message_id?: string;
  rating: "up" | "down";
  comment?: string;
};
