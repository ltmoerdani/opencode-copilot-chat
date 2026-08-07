export function formatModelName(modelId: string): string {
  const parts = modelId.split("-");
  const displayParts: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (/^\d+$/.test(part) && /^\d+$/.test(parts[index + 1] ?? "")) {
      const versionParts = [part];

      while (/^\d+$/.test(parts[index + 1] ?? "")) {
        versionParts.push(parts[index + 1]);
        index += 1;
      }

      displayParts.push(versionParts.join("."));
      continue;
    }

    displayParts.push(part);
  }

  return displayParts.map((part) => (part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))).join(" ");
}

export function providerModelDisplayName(providerPrefix: string, modelId: string, showProviderPrefix = true): string {
  const modelName = formatModelName(modelId);
  return showProviderPrefix ? `${providerPrefix} / ${modelName}` : modelName;
}
