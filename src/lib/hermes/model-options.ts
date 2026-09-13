export interface ModelCapability {
  fast: boolean;
  reasoning: boolean;
  canDisableReasoning?: boolean;
}

export interface ModelProviderOption {
  slug: string;
  name: string;
  authenticated: boolean;
  isCurrent: boolean;
  models: string[];
  featuredModels: string[];
  unavailableModels: string[];
  warning?: string;
  capabilities: Record<string, ModelCapability>;
}

export interface ModelOptionsSnapshot {
  activeProvider: string;
  activeModel: string;
  providers: ModelProviderOption[];
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(string).filter(Boolean) : [];
}

function capabilities(value: unknown): Record<string, ModelCapability> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([model, raw]) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const row = raw as Record<string, unknown>;
      return [
        [
          model,
          {
            fast: Boolean(row["fast"]),
            reasoning: Boolean(row["reasoning"]),
            ...(typeof row["can_disable_reasoning"] === "boolean"
              ? { canDisableReasoning: row["can_disable_reasoning"] }
              : {}),
          },
        ],
      ];
    }),
  );
}

export function parseModelOptions(value: unknown): ModelOptionsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed model-options response");
  }

  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload["providers"])) {
    throw new Error("Malformed model-options response");
  }

  return {
    activeProvider: string(payload["provider"]),
    activeModel: string(payload["model"]),
    providers: payload["providers"].flatMap((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const row = raw as Record<string, unknown>;
      const slug = string(row["slug"]);
      const name = string(row["name"]);
      if (!slug || !name) return [];
      return [
        {
          slug,
          name,
          authenticated: Boolean(row["authenticated"]),
          isCurrent: Boolean(row["is_current"]),
          models: stringList(row["models"]),
          featuredModels: stringList(row["featured_models"]),
          unavailableModels: stringList(row["unavailable_models"]),
          ...(string(row["warning"]) ? { warning: string(row["warning"]) } : {}),
          capabilities: capabilities(row["capabilities"]),
        },
      ];
    }),
  };
}
