import type { ModelOptionsSnapshot, ModelProviderOption } from "./model-options";

export function visibleProviderModels(
  snapshot: ModelOptionsSnapshot,
  search: string,
): ModelProviderOption[] {
  const query = search.trim().toLowerCase();

  return snapshot.providers
    .filter((provider) => provider.authenticated)
    .filter((provider) => {
      if (!query) return true;
      const matchingModels = provider.models.filter((model) => model.toLowerCase().includes(query));
      return provider.name.toLowerCase().includes(query) || matchingModels.length > 0;
    })
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}
