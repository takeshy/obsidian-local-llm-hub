import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { t } from "src/i18n";

interface ModelSelectorProps {
  models: string[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

export function filterModelOptions(models: string[], query: string): string[] {
  const unique = [...new Set(models)];
  const normalized = query.trim().toLowerCase();
  return normalized
    ? unique.filter((model) => model.toLowerCase().includes(normalized))
    : unique;
}

export default function ModelSelector({ models, value, onChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filteredModels = useMemo(() => filterModelOptions(models, query), [models, query]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    activeDocument.addEventListener("mousedown", handleOutsideClick);
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => activeDocument.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectModel = (model: string) => {
    onChange(model);
    setQuery("");
    setOpen(false);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, filteredModels.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && filteredModels[selectedIndex]) {
      event.preventDefault();
      selectModel(filteredModels[selectedIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="llm-hub-model-picker" ref={rootRef}>
      <button
        type="button"
        className="llm-hub-model-picker-trigger"
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value}
      >
        <span>{value}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div className="llm-hub-model-picker-popover">
          <div className="llm-hub-model-picker-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("input.modelFilterPlaceholder")}
              aria-label={t("input.modelFilterPlaceholder")}
            />
          </div>
          <div className="llm-hub-model-picker-list" role="listbox" ref={listRef}>
            {filteredModels.length > 0 ? filteredModels.map((model, index) => (
              <button
                type="button"
                key={model}
                className={`llm-hub-model-picker-option${index === selectedIndex ? " is-selected" : ""}`}
                onClick={() => selectModel(model)}
                onMouseEnter={() => setSelectedIndex(index)}
                role="option"
                aria-selected={model === value}
                title={model}
              >
                <span>{model}</span>
                {model === value && <Check size={13} aria-hidden="true" />}
              </button>
            )) : (
              <div className="llm-hub-model-picker-empty">{t("input.modelFilterEmpty")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
