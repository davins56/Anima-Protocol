// Type declarations for the JS base44 client (base44Client.js). The runtime
// implementation is a server-backed store with a Proxy-based `entities`/
// `functions` surface, so entity records are intentionally typed loosely as
// `any` while the call shapes (list/get/create/update/delete/filter, auth,
// integrations, functions) are described accurately.

export interface ListOptions {
  // ChatSession only: skip hydrating each session's `messages` (metadata-only
  // lists such as the chat sidebar). Defaults to hydrating.
  withMessages?: boolean;
}

export interface EntityStore {
  list(
    sortOrFilters?: string | Record<string, unknown>,
    limit?: number,
    opts?: ListOptions,
  ): Promise<any[]>;
  get(id: string): Promise<any | null>;
  create(data: Record<string, unknown>): Promise<any>;
  update(id: string, data: Record<string, unknown>): Promise<any>;
  delete(id: string): Promise<void>;
  bulkCreate(dataArray: Record<string, unknown>[]): Promise<any>;
  filter(
    filters?: Record<string, unknown>,
    sort?: string,
    limit?: number,
    opts?: ListOptions,
  ): Promise<any[]>;
}

export type EntitiesProxy = Record<string, EntityStore>;

export interface MessagePageOptions {
  limit?: number;
  beforeSeq?: number;
}

export interface Base44Messages {
  // Read a session's messages in ascending (chronological) seq order. No
  // options returns the whole history; limit/beforeSeq page it.
  list(sessionId: string, opts?: MessagePageOptions): Promise<any[]>;
  // Append one message; the server assigns its seq. Returns the stored message.
  append(sessionId: string, message: Record<string, unknown>): Promise<any>;
  // Reconcile a full message array into rows (diff by id).
  replace(sessionId: string, messages: any[]): Promise<any[]>;
  // Batch hydrate: { [sessionId]: message[] }.
  bySessions(ids: string[]): Promise<Record<string, any[]>>;
}

export interface Base44Auth {
  isAuthenticated(): Promise<boolean>;
  redirectToLogin(): void;
  me(): Promise<any>;
  syncIdentity(identity: Record<string, unknown>): any;
  clearSession(): void;
  updateMe(data: Record<string, unknown>): Promise<any>;
  updateMyUserData(data: Record<string, unknown>): Promise<any>;
  logout(): Promise<void>;
}

export interface Base44Integrations {
  Core: {
    InvokeLLM(args: { prompt: string; systemPrompt?: string }): Promise<string>;
    GenerateImage(...args: any[]): Promise<any>;
    UploadFile(...args: any[]): Promise<{ url: string | null }>;
    GetStripeLifetimePrices(...args: any[]): Promise<{ prices: any[] }>;
  };
}

export interface Base44Function {
  invoke(data?: Record<string, unknown>): Promise<any>;
}

export type Base44Functions = {
  invoke(name: string, data?: Record<string, unknown>): Promise<any>;
} & Record<string, Base44Function>;

export interface Base44Client {
  auth: Base44Auth;
  entities: EntitiesProxy;
  messages: Base44Messages;
  asServiceRole: { entities: EntitiesProxy };
  integrations: Base44Integrations;
  functions: Base44Functions;
}

export declare function setAuthTokenGetter(
  fn: (() => Promise<string | null>) | null,
): void;
export declare function clearStoreCache(): void;
export declare function bulkImport(payload?: Record<string, unknown>): Promise<any>;
export declare function restoreData(
  payload?: Record<string, unknown>,
  mode?: "merge" | "replace",
): Promise<any>;

export declare const base44: Base44Client;

export default base44;
