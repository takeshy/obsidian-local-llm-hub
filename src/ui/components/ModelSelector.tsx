import { ModelSelector as SharedModelSelector } from "obsidian-llm-hub-common";
import { t } from "src/i18n";

interface ModelSelectorProps {
  models: string[]; value: string; onChange: (model: string) => void; disabled?: boolean;
}
export function filterModelOptions(models: string[], query: string): string[] {
  const unique = [...new Set(models)];
  const normalized = query.trim().toLowerCase();
  return normalized
    ? unique.filter((model) => model.toLowerCase().includes(normalized))
    : unique;
}


export default function ModelSelector({ models, value, onChange, disabled }: ModelSelectorProps) {
  return <SharedModelSelector classPrefix="llm-hub"
    models={models.map(model => ({ value: model, label: model }))}
    value={value} onChange={value => onChange(value)} disabled={disabled}
    filterLabel={t("input.modelFilterPlaceholder")} emptyLabel={t("input.modelFilterEmpty")} />;
}
