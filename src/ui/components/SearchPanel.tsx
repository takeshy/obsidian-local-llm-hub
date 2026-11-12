import { RagSearchModeBadge, RagSearchResultMeta } from "obsidian-llm-hub-common/chat";
import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MessageSquare, FileText, ChevronDown, Loader2, Settings2, RefreshCw, Pencil, Plus, Undo2, X, Sparkles } from "lucide-react";
import { Notice } from "obsidian";
import { RagChunkEditModal } from "./RagChunkEditModal";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { Attachment, Message } from "src/types";
import { DEFAULT_RAG_SETTING } from "src/types";
import { getRagStore, searchLocalRagResults, type RagSearchResult, type RagSyncProgress } from "src/core/ragStore";
import { localLlmChatStream } from "src/core/localLlmProvider";
import { extractPdfPages } from "src/core/pdfUtils";
import { parseFilterTerms, matchesFilter, removeRedundantTerms } from "./searchUtils";
import { t } from "src/i18n";
import { encodeBase64Utf8 } from "src/utils/base64";

interface SearchPanelProps {
  plugin: LocalLlmHubPlugin;
  onChatWithResults: (attachments: Attachment[]) => void;
}

interface PluginSettingApi {
  open?: () => void;
  openTabById?: (id: string) => void;
}

interface AppWithPluginSettings {
  setting?: PluginSettingApi;
}

export default function SearchPanel({ plugin, onChatWithResults }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [ragSettingNames, setRagSettingNames] = useState<string[]>(plugin.getRagSettingNames());
  const [selectedRagSetting, setSelectedRagSetting] = useState<string>(
    plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
  );
  const [results, setResults] = useState<RagSearchResult[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [mediaPreviews, setMediaPreviews] = useState<Map<number, string>>(new Map());
  const mediaPreviewsRef = useRef(mediaPreviews);
  mediaPreviewsRef.current = mediaPreviews;
  const [pdfModes, setPdfModes] = useState<Map<number, "text" | "pdf">>(new Map());
  const filterIdCounter = useRef(1);
  const [keywordFilters, setKeywordFilters] = useState<{ id: number; value: string }[]>(
    () => [{ id: 0, value: "" }]
  );
  const [aiSuggestingId, setAiSuggestingId] = useState<number | null>(null);
  const [aiPrevValues, setAiPrevValues] = useState<Map<number, string>>(new Map());
  const aiAbortRef = useRef<AbortController | null>(null);
  const [editedIndices, setEditedIndices] = useState<Set<number>>(new Set());
  const [refinedIndices, setRefinedIndices] = useState<Set<number>>(new Set());
  const [chunkBoundaries, setChunkBoundaries] = useState<Map<number, { first: string; last: string }>>(new Map());
  const [refineModel, setRefineModel] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [topK, setTopK] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
    );
    return setting?.topK ?? DEFAULT_RAG_SETTING.topK;
  });
  const [scoreThreshold, setScoreThreshold] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
    );
    return setting?.minScore ?? DEFAULT_RAG_SETTING.minScore;
  });
  const [searchFileExtensions, setSearchFileExtensions] = useState("");

  // RAG settings section state
  const [showRagConfig, setShowRagConfig] = useState(false);
  const [chunkSize, setChunkSize] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
    );
    return setting?.chunkSize ?? DEFAULT_RAG_SETTING.chunkSize;
  });
  const [chunkOverlap, setChunkOverlap] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
    );
    return setting?.chunkOverlap ?? DEFAULT_RAG_SETTING.chunkOverlap;
  });
  const [targetFolders, setTargetFolders] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
    );
    return setting?.targetFolders?.join(", ") ?? "";
  });
  const [excludePatterns, setExcludePatterns] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.getSelectedRagSettingName() ?? ragSettingNames[0] ?? ""
    );
    return setting?.excludePatterns?.join("\n") ?? "";
  });
  const [ragSyncing, setRagSyncing] = useState(false);
  const ragSyncCancelRef = useRef(false);
  const ragSyncAbortRef = useRef<AbortController | null>(null);
  const [ragSyncProgress, setRagSyncProgress] = useState<RagSyncProgress | null>(null);
  const [indexedFiles, setIndexedFiles] = useState<{ filePath: string; chunks: number }[]>([]);
  const [showIndexedFiles, setShowIndexedFiles] = useState(false);

  // Check if current setting is internal (not external index)
  const currentRagSetting = plugin.getRagSetting(selectedRagSetting);
  const isInternalRag = currentRagSetting
    ? !currentRagSetting.externalIndexPath && currentRagSetting.sourceRagSettings.length === 0
    : false;

  // Abort AI suggestions on unmount
  useEffect(() => {
    return () => {
      aiAbortRef.current?.abort();
      mediaPreviewsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const syncRagSettings = () => {
      const names = plugin.getRagSettingNames();
      setRagSettingNames(names);
      setSelectedRagSetting(prev => {
        if (prev && names.includes(prev)) return prev;
        return names[0] ?? "";
      });
    };

    syncRagSettings();
    plugin.settingsEmitter.on("workspace-state-loaded", syncRagSettings);
    plugin.settingsEmitter.on("rag-setting-changed", syncRagSettings);

    return () => {
      plugin.settingsEmitter.off("workspace-state-loaded", syncRagSettings);
      plugin.settingsEmitter.off("rag-setting-changed", syncRagSettings);
    };
  }, [plugin]);

  useEffect(() => {
    const setting = plugin.getRagSetting(selectedRagSetting);
    setTopK(setting?.topK ?? DEFAULT_RAG_SETTING.topK);
    setScoreThreshold(setting?.minScore ?? DEFAULT_RAG_SETTING.minScore);
    setChunkSize(setting?.chunkSize ?? DEFAULT_RAG_SETTING.chunkSize);
    setChunkOverlap(setting?.chunkOverlap ?? DEFAULT_RAG_SETTING.chunkOverlap);
    setTargetFolders(setting?.targetFolders?.join(", ") ?? "");
    setExcludePatterns(setting?.excludePatterns?.join("\n") ?? "");
  }, [plugin, selectedRagSetting]);

  const handleRagSettingChange = (name: string) => {
    setSelectedRagSetting(name);
    const setting = plugin.getRagSetting(name);
    if (setting) {
      setTopK(setting.topK);
      setScoreThreshold(setting.minScore);
      setChunkSize(setting.chunkSize);
      setChunkOverlap(setting.chunkOverlap);
      setTargetFolders(setting.targetFolders?.join(", ") ?? "");
      setExcludePatterns(setting.excludePatterns?.join("\n") ?? "");
    }
  };

  // Handle RAG config field updates
  const handleChunkSizeChange = useCallback((value: number) => {
    setChunkSize(value);
    if (selectedRagSetting) {
      void plugin.updateRagSetting(selectedRagSetting, { chunkSize: value });
    }
  }, [plugin, selectedRagSetting]);

  const handleChunkOverlapChange = useCallback((value: number) => {
    setChunkOverlap(value);
    if (selectedRagSetting) {
      void plugin.updateRagSetting(selectedRagSetting, { chunkOverlap: value });
    }
  }, [plugin, selectedRagSetting]);

  const handleTargetFoldersChange = useCallback((value: string) => {
    setTargetFolders(value);
    if (selectedRagSetting) {
      const folders = value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      void plugin.updateRagSetting(selectedRagSetting, { targetFolders: folders });
    }
  }, [plugin, selectedRagSetting]);

  const handleExcludePatternsChange = useCallback((value: string) => {
    setExcludePatterns(value);
    if (selectedRagSetting) {
      const patterns = value
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      void plugin.updateRagSetting(selectedRagSetting, { excludePatterns: patterns });
    }
  }, [plugin, selectedRagSetting]);

  // Load indexed files list
  const loadIndexedFiles = useCallback(async () => {
    const store = getRagStore();
    if (!selectedRagSetting) {
      setIndexedFiles([]);
      return;
    }
    const files = await store.getIndexedFiles(plugin.app, selectedRagSetting);
    setIndexedFiles(files);
  }, [plugin, selectedRagSetting]);

  // Load indexed files when config section is opened
  useEffect(() => {
    if (showRagConfig) {
      void loadIndexedFiles();
    }
  }, [showRagConfig, loadIndexedFiles]);

  // Handle RAG sync
  const handleRagSync = useCallback(async () => {
    if (ragSyncing) {
      ragSyncCancelRef.current = true;
      ragSyncAbortRef.current?.abort();
      return;
    }
    if (!selectedRagSetting) return;

    const ragSetting = plugin.getRagSetting(selectedRagSetting);
    if (!ragSetting) return;

    setRagSyncing(true);
    setRagSyncProgress(null);
    ragSyncCancelRef.current = false;
    const abortController = new AbortController();
    ragSyncAbortRef.current = abortController;

    try {
      const store = getRagStore();
      const failedPdfFiles = new Set<string>();
      const handleProgress = (progress: RagSyncProgress) => {
        if (ragSyncCancelRef.current) {
          abortController.abort();
          throw new Error("Sync aborted");
        }
        setRagSyncProgress(progress);
      };
      let result = await store.sync(
        plugin.app,
        selectedRagSetting,
        ragSetting,
        plugin.settings.llmConfig,
        abortController.signal,
        handleProgress,
      );
      result.failedFiles?.forEach(filePath => failedPdfFiles.add(filePath));
      while (result.deferredFiles && !ragSyncCancelRef.current) {
        result = await store.sync(
          plugin.app,
          selectedRagSetting,
          ragSetting,
          plugin.settings.llmConfig,
          abortController.signal,
          handleProgress,
        );
        result.failedFiles?.forEach(filePath => failedPdfFiles.add(filePath));
      }
      if (!ragSyncCancelRef.current) {
        new Notice(t("settings.ragSynced", {
          count: String(result.totalChunks),
          files: String(result.indexedFiles),
        }));
        if (failedPdfFiles.size > 0) {
          new Notice(t("settings.ragSyncPdfFailed", {
            count: String(failedPdfFiles.size),
            files: Array.from(failedPdfFiles).join("\n"),
          }));
        }
        void plugin.updateRagSetting(selectedRagSetting, { lastFullSync: Date.now() });
        void loadIndexedFiles();
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.message === "Sync aborted")) {
        new Notice(t("settings.syncCancelled"));
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(t("settings.ragSyncFailed", { error: msg }));
    } finally {
      setRagSyncing(false);
      setRagSyncProgress(null);
      ragSyncCancelRef.current = false;
      ragSyncAbortRef.current = null;
    }
  }, [plugin, selectedRagSetting, ragSyncing, loadIndexedFiles]);

  const formatSyncProgress = (progress: RagSyncProgress): string => {
    if (progress.phase === "embedding") {
      return `${t("settings.ragSyncingEmbeddings")}: ${progress.filePath} (${progress.current}/${progress.total})`;
    }
    if (progress.phase === "saving") {
      return t("settings.ragSyncSaving");
    }
    return `${progress.filePath} (${progress.current}/${progress.total})`;
  };

  const handleSearch = async () => {
    if (isSearching) return;
    if (!selectedRagSetting) {
      new Notice(t("search.noRagSetting"));
      return;
    }
    if (!query.trim()) {
      new Notice(t("search.enterQuery"));
      return;
    }

    const ragSetting = plugin.getRagSearchSetting(selectedRagSetting);
    if (!ragSetting) {
      new Notice(t("search.ragSettingNotFound"));
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setResults([]);
    setSelectedIndices(new Set());
    setExpandedIndices(new Set());
    mediaPreviews.forEach(url => URL.revokeObjectURL(url));
    setMediaPreviews(new Map());
    setPdfModes(new Map());
    aiAbortRef.current?.abort();
    setKeywordFilters([{ id: filterIdCounter.current++, value: "" }]);
    setAiPrevValues(new Map());
    setEditedIndices(new Set());
    setRefinedIndices(new Set());
    setChunkBoundaries(new Map());

    try {
      const overriddenSetting = { ...ragSetting, topK, minScore: scoreThreshold };
      const extensions = searchFileExtensions
        .split(",")
        .map(ext => ext.trim())
        .filter(ext => ext.length > 0);
      const searchResults = await searchLocalRagResults(
        selectedRagSetting,
        query.trim(),
        overriddenSetting,
        plugin.settings.llmConfig,
        plugin.app,
        extensions,
      );
      setResults(searchResults);
    } catch (err) {
      new Notice(t("search.searchFailed") + ": " + (err instanceof Error ? err.message : String(err)));
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const toggleExpanded = (index: number) => {
    setExpandedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const parsePdfStartPage = (pageLabel?: string): number | null => {
    if (!pageLabel) return null;
    const match = pageLabel.match(/^pages?\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  };

  const loadPdfPreview = useCallback((index: number, result: RagSearchResult) => {
    if (result.contentType !== "pdf" || mediaPreviews.has(index)) return;

    void (async () => {
      try {
        const pdfBuffer = result.pageLabel
          ? await extractPdfPages(plugin.app, result.filePath, result.pageLabel)
          : null;
        if (!pdfBuffer) {
          throw new Error("Failed to extract PDF pages");
        }
        const blob = new Blob([pdfBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setMediaPreviews(prev => new Map(prev).set(index, url));
      } catch (err) {
        new Notice(t("search.pdfPreviewFailed") + ": " + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, [mediaPreviews, plugin.app]);

  const toggleSelection = (index: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Filtered results: pairs of [originalIndex, result] matching the keyword filters.
  // Each field: space-separated OR (any term matches), quoted phrases match as-is. Between fields: AND.
  const filteredResults: [number, RagSearchResult][] = (() => {
    const activeFilters = keywordFilters
      .map(f => parseFilterTerms(f.value))
      .filter(terms => terms.length > 0);
    return results
      .map((r, i) => [i, r] as [number, RagSearchResult])
      .filter(([, r]) => {
        if (activeFilters.length === 0) return true;
        const rawText = r.text + " " + r.filePath;
        return activeFilters.every(terms => matchesFilter(rawText, terms));
      });
  })();

  const toggleSelectAll = () => {
    const filteredIndices = new Set(filteredResults.map(([i]) => i));
    const allFilteredSelected = filteredResults.length > 0 && filteredResults.every(([i]) => selectedIndices.has(i));
    if (allFilteredSelected) {
      setSelectedIndices(prev => {
        const next = new Set(prev);
        for (const i of filteredIndices) next.delete(i);
        return next;
      });
    } else {
      setSelectedIndices(prev => new Set([...prev, ...filteredIndices]));
    }
  };

  const buildSelectedAttachments = (): Attachment[] | null => {
    if (selectedIndices.size === 0) {
      new Notice(t("search.selectResults"));
      return null;
    }

    const attachments: Attachment[] = [];

    for (const idx of Array.from(selectedIndices).sort((a, b) => a - b)) {
      const result = results[idx];
      if (!result) continue;

      const content = `[Source: ${result.filePath}] (relevance: ${result.score.toFixed(3)})\n\n${result.text}`;
      const fileName = result.filePath.split("/").pop() || result.filePath;
      attachments.push({
        name: fileName,
        type: "text",
        mimeType: "text/plain",
        data: encodeBase64Utf8(content),
        sourcePath: result.filePath,
      });
    }

    return attachments;
  };

  const handleChatWithSelected = () => {
    const attachments = buildSelectedAttachments();
    if (attachments) onChatWithResults(attachments);
  };

  const handleAiSuggest = async (filterId: number) => {
    const filter = keywordFilters.find(f => f.id === filterId);
    const currentTerms = filter?.value.trim();
    if (!currentTerms || !refineModel) return;

    // Abort any previous AI suggestion
    aiAbortRef.current?.abort();
    const abortController = new AbortController();
    aiAbortRef.current = abortController;

    // Save current value for undo
    setAiPrevValues(prev => new Map(prev).set(filterId, currentTerms));
    setAiSuggestingId(filterId);
    try {
      const systemPrompt = [
        "You are a keyword expansion assistant.",
        "Given the user's search keywords, suggest additional synonyms, related terms, and alternate phrasings that would help find similar content.",
        "Return ONLY a space-separated list of suggested keywords (no numbering, no explanations, no punctuation except hyphens within compound words).",
        "Include the original keywords in your response.",
        "If the input is not in English, also include English translations and related English terms.",
        "Keep the total number of terms between 5 and 15.",
      ].join(" ");
      const messages: Message[] = [{ role: "user", content: currentTerms, timestamp: Date.now() }];
      const llmConfig = { ...plugin.settings.llmConfig, model: refineModel };
      let result = "";
      for await (const chunk of localLlmChatStream(
        llmConfig,
        messages,
        systemPrompt,
        abortController.signal,
      )) {
        if (abortController.signal.aborted) return;
        if (chunk.type === "error") {
          throw new Error(chunk.error ?? chunk.content ?? "Unknown error");
        }
        if (chunk.type === "text" && chunk.content) result += chunk.content;
      }
      const suggested = result.trim();
      if (suggested && !abortController.signal.aborted) {
        const value = removeRedundantTerms(suggested, currentTerms);
        setKeywordFilters(prev => prev.map(f => f.id === filterId ? { ...f, value } : f));
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        new Notice(t("search.aiSuggestFailed") + ": " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      if (aiAbortRef.current === abortController) {
        aiAbortRef.current = null;
      }
      setAiSuggestingId(prev => prev === filterId ? null : prev);
    }
  };

  const handleAiUndo = (filterId: number) => {
    const prevValue = aiPrevValues.get(filterId);
    if (prevValue === undefined) return;
    setKeywordFilters(prev => prev.map(f => f.id === filterId ? { ...f, value: prevValue } : f));
    setAiPrevValues(prev => {
      const next = new Map(prev);
      next.delete(filterId);
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSearching) void handleSearch();
    }
  };

  const openPluginSettings = () => {
    const setting = (plugin.app as AppWithPluginSettings).setting;
    setting?.open?.();
    setting?.openTabById?.(plugin.manifest.id);
  };

  if (ragSettingNames.length === 0) {
    return (
      <div className="llm-hub-search-panel">
        <div className="llm-hub-search-empty-state">
          <p>{t("search.noRagSettings")}</p>
          <p className="llm-hub-search-empty-guide">{t("search.noRagSettingsGuide")}</p>
          <button className="mod-cta" onClick={openPluginSettings}>
            {t("search.openSettings")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="llm-hub-search-panel">
      {/* Search input area */}
      <div className="llm-hub-search-input-area">
        <div className="llm-hub-search-rag-selector">
          <select
            value={selectedRagSetting}
            onChange={e => handleRagSettingChange(e.target.value)}
            className="llm-hub-model-select llm-hub-rag-select"
            disabled={isSearching || ragSyncing}
          >
            {ragSettingNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            className="llm-hub-rag-icon-btn"
            onClick={() => setShowRagConfig(!showRagConfig)}
            title={t("input.ragSettings")}
            disabled={ragSyncing}
          >
            <Settings2 size={14} />
          </button>
        </div>
        {showRagConfig && (
          <div className="llm-hub-rag-config-section">
            {isInternalRag && (
              <>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragChunkSize")}: {chunkSize}</label>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={50}
                    value={chunkSize}
                    onChange={e => handleChunkSizeChange(Number(e.target.value))}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragChunkOverlap")}: {chunkOverlap}</label>
                  <input
                    type="range"
                    min={0}
                    max={500}
                    step={10}
                    value={chunkOverlap}
                    onChange={e => handleChunkOverlapChange(Number(e.target.value))}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragTargetFolders")}</label>
                  <input
                    type="text"
                    className="llm-hub-rag-config-input"
                    placeholder={t("input.ragTargetFolders.placeholder")}
                    value={targetFolders}
                    onChange={e => handleTargetFoldersChange(e.target.value)}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragExcludedPatterns")}</label>
                  <textarea
                    className="llm-hub-rag-config-textarea"
                    placeholder={t("input.ragExcludedPatterns.placeholder")}
                    value={excludePatterns}
                    rows={3}
                    onChange={e => handleExcludePatternsChange(e.target.value)}
                  />
                </div>
              </>
            )}
            {/* Last sync timestamp */}
            {currentRagSetting?.lastFullSync && (
              <div className="llm-hub-rag-last-sync">
                {t("input.ragLastSync")}: {new Date(currentRagSetting.lastFullSync).toLocaleString()}
              </div>
            )}
            {/* Indexed files accordion */}
            <div className="llm-hub-rag-indexed-files">
              <button
                className="llm-hub-rag-indexed-files-toggle"
                onClick={() => setShowIndexedFiles(!showIndexedFiles)}
              >
                <ChevronDown size={12} className={showIndexedFiles ? "llm-hub-chevron-rotated" : ""} />
                {t("input.ragIndexedFiles", { count: String(indexedFiles.length) })}
              </button>
              {showIndexedFiles && (
                <div className="llm-hub-rag-indexed-files-list">
                  {indexedFiles.length === 0 ? (
                    <div className="llm-hub-rag-indexed-files-empty">{t("input.ragNoIndexedFiles")}</div>
                  ) : (
                    indexedFiles.map(f => (
                      <div key={f.filePath} className="llm-hub-rag-indexed-file-item">
                        <span
                          className="llm-hub-rag-indexed-file-path"
                          onClick={() => {
                            const file = plugin.app.vault.getAbstractFileByPath(f.filePath);
                            if (file) {
                              void plugin.app.workspace.openLinkText(f.filePath, "", false);
                            } else {
                              new Notice(f.filePath, 5000);
                            }
                          }}
                        >
                          {f.filePath}
                        </span>
                        <span className="llm-hub-rag-indexed-file-chunks">
                          {f.chunks} chunks
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {isInternalRag && ragSyncProgress && (
              <div className="llm-hub-rag-sync-progress-bar">
                <progress
                  value={ragSyncProgress.current}
                  max={Math.max(ragSyncProgress.total, 1)}
                />
                <span className="llm-hub-rag-sync-progress-text">
                  {formatSyncProgress(ragSyncProgress)}
                </span>
              </div>
            )}
            <div className="llm-hub-rag-config-row">
              <label>{t("search.refineModel")}</label>
              <select
                className="llm-hub-rag-config-select"
                value={refineModel}
                onChange={e => setRefineModel(e.target.value)}
              >
                <option value="">{t("search.refineModelNone")}</option>
                {plugin.settings.availableModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="llm-hub-rag-config-actions">
              {isInternalRag && (
                <button
                  className={`llm-hub-rag-text-btn ${ragSyncing ? "syncing" : ""}`}
                  onClick={() => { void handleRagSync(); }}
                >
                  {ragSyncing ? (
                    <><Loader2 size={12} className="llm-hub-spinner" /> {t("settings.cancelSync")}</>
                  ) : (
                    <><RefreshCw size={12} /> {t("settings.ragSync")}</>
                  )}
                </button>
              )}
              <button
                className="llm-hub-rag-text-btn"
                onClick={() => setShowRagConfig(false)}
              >
                {t("input.close")}
              </button>
            </div>
          </div>
        )}
        <div className="llm-hub-search-params">
          <label className="llm-hub-search-param-label">
            Top K:
            <input
              type="number"
              min={1}
              max={999}
              value={topK}
              onChange={e => setTopK(Math.max(1, Math.min(999, parseInt(e.target.value) || 5)))}
              className="llm-hub-search-param-input"
            />
          </label>
          <label className="llm-hub-search-param-label">
            {t("search.scoreThreshold")}:
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={scoreThreshold}
              onChange={e => setScoreThreshold(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
              className="llm-hub-search-param-input"
            />
          </label>
          <label className="llm-hub-search-param-label">
            {t("search.fileExtensions")}:
            <input
              type="text"
              value={searchFileExtensions}
              onChange={e => setSearchFileExtensions(e.target.value)}
              className="llm-hub-search-param-input llm-hub-search-param-input-ext"
              placeholder={t("search.fileExtensionsPlaceholder")}
            />
          </label>
        </div>
        <RagSearchModeBadge hybridSearch={currentRagSetting?.hybridSearch === true} />
        <div className="llm-hub-search-query-row">
          <textarea
            className="llm-hub-search-query-input"
            placeholder={t("search.queryPlaceholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <button
            className="llm-hub-search-btn"
            onClick={() => void handleSearch()}
            disabled={isSearching || !selectedRagSetting}
            title={t("search.search")}
          >
            {isSearching ? (
              <Loader2 size={18} className="llm-hub-spinner" />
            ) : (
              <Search size={18} />
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="llm-hub-search-results">
        {hasSearched && results.length === 0 && !isSearching && (
          <div className="llm-hub-search-no-results">{t("search.noResults")}</div>
        )}
        {results.length > 0 && (
          <>
            <div className="llm-hub-search-results-header">
              <div className="llm-hub-search-keyword-filters">
                {keywordFilters.map((filter) => (
                  <div key={filter.id} className="llm-hub-search-keyword-filter-row">
                    <input
                      className="llm-hub-search-keyword-filter"
                      type="text"
                      placeholder={t("search.keywordFilterOr")}
                      value={filter.value}
                      onChange={e => {
                        const val = e.target.value;
                        setKeywordFilters(prev => prev.map(f => f.id === filter.id ? { ...f, value: val } : f));
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                    {aiPrevValues.has(filter.id) && aiSuggestingId !== filter.id && (
                      <button
                        className="llm-hub-search-keyword-undo-btn"
                        title={t("search.aiUndo")}
                        onClick={() => handleAiUndo(filter.id)}
                      >
                        <Undo2 size={14} />
                      </button>
                    )}
                    <button
                      className="llm-hub-search-keyword-ai-btn"
                      title={t("search.aiSuggest")}
                      disabled={!filter.value.trim() || !refineModel || aiSuggestingId === filter.id}
                      onClick={() => void handleAiSuggest(filter.id)}
                    >
                      {aiSuggestingId === filter.id
                        ? <Loader2 size={14} className="llm-hub-spinner" />
                        : <Sparkles size={14} />}
                    </button>
                    {keywordFilters.length > 1 && (
                      <button
                        className="llm-hub-search-keyword-remove-btn"
                        title={t("search.removeFilter")}
                        onClick={() => {
                          setKeywordFilters(prev => prev.filter(f => f.id !== filter.id));
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="llm-hub-search-keyword-add-btn"
                  title={t("search.addFilter")}
                  onClick={() => setKeywordFilters(prev => [...prev, { id: filterIdCounter.current++, value: "" }])}
                >
                  <Plus size={14} />
                  {t("search.addFilterLabel")}
                </button>
              </div>
              <div className="llm-hub-search-results-actions">
                <label className="llm-hub-search-select-all">
                  <input
                    type="checkbox"
                    checked={filteredResults.length > 0 && filteredResults.every(([i]) => selectedIndices.has(i))}
                    onChange={toggleSelectAll}
                  />
                  {t("search.selectAll")} ({filteredResults.length}/{results.length} {t("search.results")})
                </label>
                <span className="llm-hub-search-selected-count">
                  {t("search.selected")}: {selectedIndices.size}
                </span>
                <button
                  className="llm-hub-search-chat-btn"
                  onClick={handleChatWithSelected}
                  disabled={selectedIndices.size === 0}
                >
                  <MessageSquare size={14} />
                  Chat
                </button>
              </div>
            </div>
            {filteredResults.map(([index, result]) => (
              <div
                key={`${result.filePath}-${index}`}
                className={`llm-hub-search-result-item ${selectedIndices.has(index) ? "selected" : ""} ${editedIndices.has(index) ? "edited" : ""}`}
                onClick={() => toggleSelection(index)}
              >
                <div className="llm-hub-search-result-header">
                  <input
                    type="checkbox"
                    checked={selectedIndices.has(index)}
                    onChange={() => toggleSelection(index)}
                    onClick={e => e.stopPropagation()}
                  />
                  <FileText size={14} />
                  <span
                    className="llm-hub-search-result-path"
                    onClick={e => {
                      e.stopPropagation();
                      const file = plugin.app.vault.getAbstractFileByPath(result.filePath);
                      if (file) {
                        let linkPath = result.filePath;
                        if (result.contentType === "pdf" && result.pageLabel) {
                          const startPage = parsePdfStartPage(result.pageLabel);
                          if (startPage) {
                            linkPath += `#page=${startPage}`;
                          }
                        }
                        void plugin.app.workspace.openLinkText(linkPath, "", false);
                      } else {
                        new Notice(result.filePath, 5000);
                      }
                    }}
                    title={result.filePath}
                  >
                    {result.filePath}
                  </span>
                  {result.contentType === "pdf" && result.pageLabel && (
                    <span className="llm-hub-search-result-page-label">{result.pageLabel}</span>
                  )}
                  <RagSearchResultMeta score={result.score} retrievalSource={result.retrievalSource} />
                  {result.contentType === "pdf" && (
                    <>
                      <span className="llm-hub-search-result-pdf-badge">PDF</span>
                      <select
                        className="llm-hub-search-pdf-mode"
                        value={pdfModes.get(index) ?? "text"}
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          e.stopPropagation();
                          const mode = e.target.value as "text" | "pdf";
                          setPdfModes(prev => new Map(prev).set(index, mode));
                          if (mode === "pdf" && expandedIndices.has(index)) {
                            loadPdfPreview(index, result);
                          }
                        }}
                      >
                        <option value="text">{t("search.pdfMode.text")}</option>
                        <option value="pdf">{t("search.pdfMode.pdf")}</option>
                      </select>
                    </>
                  )}
                  {editedIndices.has(index) && (
                    <span className="llm-hub-search-result-edited-badge">{t("search.edited")}</span>
                  )}
                </div>
                {result.contentType === "pdf" && (pdfModes.get(index) ?? "text") === "pdf" ? (
                  expandedIndices.has(index) ? (
                    <div className="llm-hub-search-media-preview" onClick={e => e.stopPropagation()}>
                      {mediaPreviews.has(index) ? (
                        <iframe src={mediaPreviews.get(index)} className="llm-hub-search-pdf-iframe" />
                      ) : (
                        <Loader2 size={18} className="llm-hub-spinner" />
                      )}
                    </div>
                  ) : null
                ) : (
                  <div
                    className={`llm-hub-search-result-preview ${expandedIndices.has(index) ? "expanded" : ""}`}
                    onClick={e => { e.stopPropagation(); toggleExpanded(index); }}
                  >
                    {expandedIndices.has(index) ? result.text : (
                      result.text.length > 300 ? result.text.slice(0, 300) + "..." : result.text
                    )}
                  </div>
                )}
                <div className="llm-hub-search-result-actions">
                  {expandedIndices.has(index) && (
                    <button
                      className="llm-hub-search-result-edit-btn clickable-icon"
                      onClick={e => {
                        e.stopPropagation();
                        const llmConfig = refineModel
                          ? { ...plugin.settings.llmConfig, model: refineModel }
                          : plugin.settings.llmConfig;
                        new RagChunkEditModal(plugin.app, result, selectedRagSetting, query, llmConfig, refinedIndices.has(index), (edited) => {
                          setResults(prev => {
                            const next = [...prev];
                            next[index] = { ...prev[index], text: edited.text };
                            return next;
                          });
                          setEditedIndices(prev => new Set(prev).add(index));
                          setChunkBoundaries(prev => new Map(prev).set(index, { first: edited.firstChunkText, last: edited.lastChunkText }));
                          if (edited.refined) {
                            setRefinedIndices(prev => new Set(prev).add(index));
                          }
                        }, chunkBoundaries.get(index)).open();
                      }}
                      title={t("search.editChunk")}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  {(result.text.length > 300 || result.contentType === "pdf") && (
                    <button
                      className="llm-hub-search-result-toggle"
                      onClick={e => {
                        e.stopPropagation();
                        const nextExpanded = !expandedIndices.has(index);
                        toggleExpanded(index);
                        if (nextExpanded && result.contentType === "pdf" && (pdfModes.get(index) ?? "text") === "pdf") {
                          loadPdfPreview(index, result);
                        }
                      }}
                    >
                      <ChevronDown size={14} className={expandedIndices.has(index) ? "llm-hub-chevron-rotated" : ""} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
