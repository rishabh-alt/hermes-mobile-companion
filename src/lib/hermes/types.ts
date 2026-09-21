export type Role = "user" | "assistant" | "system";

export type ToolCallState =
  "input-streaming" | "input-available" | "output-available" | "output-error";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  rawInput: string;
  output?: unknown;
  errorText?: string | undefined;
  state: ToolCallState;
}

export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  /** data: URL kept locally on the device */
  url: string;
}

export interface HermesMessage {
  id: string;
  role: Role;
  text: string;
  reasoning?: string | undefined;
  tools?: ToolCall[] | undefined;
  attachments?: Attachment[] | undefined;
  reactions?: string[] | undefined;
  error?: string | undefined;
  createdAt: number;
  model?: string | undefined;
}

export interface Session {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  provider?: string | undefined;
  model?: string | undefined;
  messages: HermesMessage[];
}

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export interface HermesConfig {
  baseUrl: string;
  token: string;
  activeProfile: string;
  profilePathPrefix: string;
  provider: string;
  model: string;
  fallbackModel: string;
  wsEnabled: boolean;
  haptics: boolean;
  reasoning: ReasoningLevel;
  fastMode: boolean;
}

export interface HermesModel {
  id: string;
  owned_by?: string | undefined;
  created?: number | undefined;
}

export interface Capability {
  name: string;
  description?: string | undefined;
  kind: "skill" | "tool" | "mcp";
  enabled?: boolean | undefined;
  server?: string | undefined;
}

export interface MemoryPeer {
  id: string;
  name: string;
  facts: string[];
  updatedAt?: string | undefined;
}
