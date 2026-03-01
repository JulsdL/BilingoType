import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Download, Trash2, X, Zap, Check } from "lucide-react";
import { ProviderTabs } from "./ui/ProviderTabs";
import { DownloadProgressBar } from "./ui/DownloadProgressBar";
import { ConfirmDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useModelDownload, type DownloadProgress } from "../hooks/useModelDownload";
import { WHISPER_MODEL_INFO, PARAKEET_MODEL_INFO } from "../models/localModelData";
import {
  MODEL_PICKER_COLORS,
  type ColorScheme,
  type ModelPickerStyles,
} from "../utils/modelPickerStyles";
import { getProviderIcon } from "../utils/providerIcons";
import { getCachedPlatform } from "../utils/platform";
import type { CudaWhisperStatus } from "../types/electron";
import logger from "../utils/logger";

interface LocalModel {
  model: string;
  size_mb?: number;
  downloaded?: boolean;
}

interface LocalModelCardProps {
  modelId: string;
  name: string;
  description: string;
  size: string;
  actualSizeMb?: number;
  isSelected: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  isCancelling: boolean;
  recommended?: boolean;
  provider: string;
  languageLabel?: string;
  onSelect: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCancel: () => void;
  styles: ModelPickerStyles;
}

function LocalModelCard({
  modelId,
  name,
  description,
  size,
  actualSizeMb,
  isSelected,
  isDownloaded,
  isDownloading,
  isCancelling,
  recommended,
  provider,
  languageLabel,
  onSelect,
  onDelete,
  onDownload,
  onCancel,
  styles: cardStyles,
}: LocalModelCardProps) {
  const { t } = useTranslation();
  const providerIcon = getProviderIcon(provider);
  const handleClick = () => {
    if (isDownloaded && !isSelected) {
      onSelect();
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`relative w-full text-left overflow-hidden rounded-md border transition-colors duration-200 group ${
        isSelected ? cardStyles.modelCard.selected : cardStyles.modelCard.default
      } ${isDownloaded && !isSelected ? "cursor-pointer" : ""}`}
    >
      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-linear-to-b from-primary via-primary to-primary/80 rounded-l-md" />
      )}
      <div className="flex items-center gap-1.5 p-2 pl-2.5">
        <div className="shrink-0">
          {isDownloaded ? (
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                isSelected
                  ? "bg-primary shadow-[0_0_6px_oklch(0.62_0.22_260/0.6)] animate-[pulse-glow_2s_ease-in-out_infinite]"
                  : "bg-success shadow-[0_0_4px_rgba(34,197,94,0.5)]"
              }`}
            />
          ) : isDownloading ? (
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)] animate-[spinner-rotate_1s_linear_infinite]" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {providerIcon && <img src={providerIcon} alt="" className="w-3.5 h-3.5 shrink-0" />}
          <span className="font-semibold text-sm text-foreground truncate tracking-tight">
            {name}
          </span>
          <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">
            {actualSizeMb ? `${actualSizeMb}MB` : size}
          </span>
          {recommended && (
            <span className={cardStyles.badges.recommended}>{t("common.recommended")}</span>
          )}
          {languageLabel && (
            <span className="text-xs text-muted-foreground/50 font-medium shrink-0">
              {languageLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isDownloaded ? (
            <>
              {isSelected && (
                <span className="text-xs font-medium text-primary px-2 py-0.5 bg-primary/10 rounded-sm">
                  {t("common.active")}
                </span>
              )}
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-[color,opacity,transform] active:scale-95"
              >
                <Trash2 size={12} />
              </Button>
            </>
          ) : isDownloading ? (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              disabled={isCancelling}
              size="sm"
              variant="outline"
              className="h-6 px-2.5 text-xs text-destructive border-destructive/25 hover:bg-destructive/8"
            >
              <X size={11} className="mr-0.5" />
              {isCancelling ? "..." : t("common.cancel")}
            </Button>
          ) : (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              size="sm"
              variant="default"
              className="h-6 px-2.5 text-xs"
            >
              <Download size={11} className="mr-1" />
              {t("common.download")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface TranscriptionModelPickerProps {
  selectedLocalModel: string;
  onLocalModelSelect: (modelId: string) => void;
  selectedLocalProvider?: string;
  onLocalProviderSelect?: (providerId: string) => void;
  className?: string;
  variant?: "onboarding" | "settings";
}

const LOCAL_PROVIDER_TABS: Array<{ id: string; name: string; disabled?: boolean }> = [
  { id: "whisper", name: "OpenAI Whisper" },
  { id: "nvidia", name: "NVIDIA Parakeet" },
  { id: "faster-whisper", name: "Faster Whisper" },
];

export default function TranscriptionModelPicker({
  selectedLocalModel,
  onLocalModelSelect,
  selectedLocalProvider = "whisper",
  onLocalProviderSelect,
  className = "",
  variant = "settings",
}: TranscriptionModelPickerProps) {
  const { t } = useTranslation();
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [parakeetModels, setParakeetModels] = useState<LocalModel[]>([]);
  const [internalLocalProvider, setInternalLocalProvider] = useState(selectedLocalProvider);
  const hasLoadedRef = useRef(false);
  const hasLoadedParakeetRef = useRef(false);
  const [cudaStatus, setCudaStatus] = useState<CudaWhisperStatus | null>(null);
  const [cudaDownloading, setCudaDownloading] = useState(false);
  const [cudaProgress, setCudaProgress] = useState<DownloadProgress>({
    downloadedBytes: 0,
    totalBytes: 0,
    percentage: 0,
  });
  const [cudaDismissed, setCudaDismissed] = useState(false);
  const [fasterWhisperAvailable, setFasterWhisperAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (selectedLocalProvider !== internalLocalProvider) {
      setInternalLocalProvider(selectedLocalProvider);
    }
  }, [selectedLocalProvider]);

  const isLoadingRef = useRef(false);
  const isLoadingParakeetRef = useRef(false);
  const loadLocalModelsRef = useRef<(() => Promise<void>) | null>(null);
  const loadParakeetModelsRef = useRef<(() => Promise<void>) | null>(null);
  const selectedLocalModelRef = useRef(selectedLocalModel);
  const onLocalModelSelectRef = useRef(onLocalModelSelect);

  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();
  const colorScheme: ColorScheme = variant === "settings" ? "purple" : "blue";
  const styles = useMemo(() => MODEL_PICKER_COLORS[colorScheme], [colorScheme]);

  useEffect(() => {
    selectedLocalModelRef.current = selectedLocalModel;
  }, [selectedLocalModel]);
  useEffect(() => {
    onLocalModelSelectRef.current = onLocalModelSelect;
  }, [onLocalModelSelect]);

  const validateAndSelectModel = useCallback((loadedModels: LocalModel[]) => {
    const current = selectedLocalModelRef.current;
    if (!current) return;

    const downloaded = loadedModels.filter((m) => m.downloaded);
    const isCurrentDownloaded = loadedModels.find((m) => m.model === current)?.downloaded;

    if (!isCurrentDownloaded && downloaded.length > 0) {
      onLocalModelSelectRef.current(downloaded[0].model);
    } else if (!isCurrentDownloaded && downloaded.length === 0) {
      onLocalModelSelectRef.current("");
    }
  }, []);

  const loadLocalModels = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      const result = await window.electronAPI?.listWhisperModels();
      if (result?.success) {
        setLocalModels(result.models);
        validateAndSelectModel(result.models);
      }
    } catch (error) {
      logger.error("Failed to load models", { error }, "models");
      setLocalModels([]);
    } finally {
      isLoadingRef.current = false;
    }
  }, [validateAndSelectModel]);

  const loadParakeetModels = useCallback(async () => {
    if (isLoadingParakeetRef.current) return;
    isLoadingParakeetRef.current = true;

    try {
      const result = await window.electronAPI?.listParakeetModels();
      if (result?.success) {
        setParakeetModels(result.models);
      }
    } catch (error) {
      logger.error("Failed to load Parakeet models", { error }, "models");
      setParakeetModels([]);
    } finally {
      isLoadingParakeetRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadLocalModelsRef.current = loadLocalModels;
  }, [loadLocalModels]);
  useEffect(() => {
    loadParakeetModelsRef.current = loadParakeetModels;
  }, [loadParakeetModels]);

  useEffect(() => {
    if (internalLocalProvider === "whisper" && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadLocalModelsRef.current?.();
    } else if (internalLocalProvider === "nvidia" && !hasLoadedParakeetRef.current) {
      hasLoadedParakeetRef.current = true;
      loadParakeetModelsRef.current?.();
    }
  }, [internalLocalProvider]);

  useEffect(() => {
    if (internalLocalProvider === "faster-whisper") {
      window.electronAPI
        ?.fasterWhisperStatus?.()
        .then((status) => setFasterWhisperAvailable(status?.installed ?? false))
        .catch(() => setFasterWhisperAvailable(false));
    }
  }, [internalLocalProvider]);

  useEffect(() => {
    const handleModelsCleared = () => {
      loadLocalModels();
      loadParakeetModels();
    };
    window.addEventListener("bilingotype-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("bilingotype-models-cleared", handleModelsCleared);
  }, [loadLocalModels, loadParakeetModels]);

  // CUDA GPU acceleration detection
  useEffect(() => {
    if (internalLocalProvider !== "whisper") return;
    if (getCachedPlatform() === "darwin") return;
    window.electronAPI
      ?.getCudaWhisperStatus?.()
      ?.then(setCudaStatus)
      .catch(() => {});
  }, [internalLocalProvider]);

  useEffect(() => {
    if (!cudaDownloading) return;
    const cleanup = window.electronAPI?.onCudaDownloadProgress?.((data) => {
      setCudaProgress(data);
    });
    return cleanup;
  }, [cudaDownloading]);

  const handleCudaDownload = async () => {
    setCudaDownloading(true);
    try {
      const result = await window.electronAPI?.downloadCudaWhisperBinary?.();
      if (result?.success) {
        const status = await window.electronAPI?.getCudaWhisperStatus?.();
        setCudaStatus(status || null);
      }
    } finally {
      setCudaDownloading(false);
    }
  };

  const handleCudaDelete = async () => {
    await window.electronAPI?.deleteCudaWhisperBinary?.();
    const status = await window.electronAPI?.getCudaWhisperStatus?.();
    setCudaStatus(status || null);
  };

  const handleCudaCancel = async () => {
    await window.electronAPI?.cancelCudaWhisperDownload?.();
    setCudaDownloading(false);
  };

  const {
    downloadingModel,
    downloadProgress,
    downloadModel,
    deleteModel,
    isDownloadingModel,
    isInstalling,
    cancelDownload,
    isCancelling,
  } = useModelDownload({
    modelType: "whisper",
    onDownloadComplete: loadLocalModels,
  });

  const {
    downloadingModel: downloadingParakeetModel,
    downloadProgress: parakeetDownloadProgress,
    downloadModel: downloadParakeetModel,
    deleteModel: deleteParakeetModel,
    isDownloadingModel: isDownloadingParakeetModel,
    isInstalling: isInstallingParakeet,
    cancelDownload: cancelParakeetDownload,
    isCancelling: isCancellingParakeet,
  } = useModelDownload({
    modelType: "parakeet",
    onDownloadComplete: loadParakeetModels,
  });

  const handleLocalProviderChange = useCallback(
    (providerId: string) => {
      const tab = LOCAL_PROVIDER_TABS.find((t) => t.id === providerId);
      if (tab?.disabled) return;
      setInternalLocalProvider(providerId);
      onLocalProviderSelect?.(providerId);
    },
    [onLocalProviderSelect]
  );

  const handleWhisperModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("whisper");
      setInternalLocalProvider("whisper");
      onLocalModelSelect(modelId);
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handleParakeetModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("nvidia");
      setInternalLocalProvider("nvidia");
      onLocalModelSelect(modelId);
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handleFasterWhisperModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("faster-whisper");
      setInternalLocalProvider("faster-whisper");
      onLocalModelSelect(modelId);
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handleDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: async () => {
          await deleteModel(modelId, async () => {
            const result = await window.electronAPI?.listWhisperModels();
            if (result?.success) {
              setLocalModels(result.models);
              validateAndSelectModel(result.models);
            }
          });
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteModel, validateAndSelectModel, t]
  );

  const handleParakeetDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: async () => {
          await deleteParakeetModel(modelId, async () => {
            const result = await window.electronAPI?.listParakeetModels();
            if (result?.success) {
              setParakeetModels(result.models);
            }
          });
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteParakeetModel, t]
  );

  const progressDisplay = useMemo(() => {
    if (downloadingModel && internalLocalProvider === "whisper") {
      const modelInfo = WHISPER_MODEL_INFO[downloadingModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingModel}
          progress={downloadProgress}
          isInstalling={isInstalling}
        />
      );
    }

    if (downloadingParakeetModel && internalLocalProvider === "nvidia") {
      const modelInfo = PARAKEET_MODEL_INFO[downloadingParakeetModel];
      return (
        <DownloadProgressBar
          modelName={modelInfo?.name || downloadingParakeetModel}
          progress={parakeetDownloadProgress}
          isInstalling={isInstallingParakeet}
        />
      );
    }

    return null;
  }, [
    downloadingModel,
    downloadProgress,
    isInstalling,
    downloadingParakeetModel,
    parakeetDownloadProgress,
    isInstallingParakeet,
    internalLocalProvider,
  ]);

  const getParakeetLanguageLabel = (language: string) => {
    return language === "multilingual"
      ? t("transcription.parakeet.multilingual")
      : t("transcription.parakeet.english");
  };

  const renderLocalModels = () => {
    const modelsToRender =
      localModels.length === 0
        ? Object.entries(WHISPER_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : localModels;

    return (
      <div className="space-y-0.5">
        {modelsToRender.map((model) => {
          const modelId = model.model;
          const info = WHISPER_MODEL_INFO[modelId] ?? {
            name: modelId,
            description: t("transcription.fallback.whisperModelDescription"),
            size: t("common.unknown"),
            recommended: false,
          };

          return (
            <LocalModelCard
              key={modelId}
              modelId={modelId}
              name={info.name}
              description={info.description}
              size={info.size}
              actualSizeMb={model.size_mb}
              isSelected={modelId === selectedLocalModel}
              isDownloaded={model.downloaded ?? false}
              isDownloading={isDownloadingModel(modelId)}
              isCancelling={isCancelling}
              recommended={info.recommended}
              provider="whisper"
              onSelect={() => handleWhisperModelSelect(modelId)}
              onDelete={() => handleDelete(modelId)}
              onDownload={() =>
                downloadModel(modelId, (downloadedId) => {
                  setLocalModels((prev) =>
                    prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
                  );
                  handleWhisperModelSelect(downloadedId);
                })
              }
              onCancel={cancelDownload}
              styles={styles}
            />
          );
        })}
      </div>
    );
  };

  const renderParakeetModels = () => {
    const modelsToRender =
      parakeetModels.length === 0
        ? Object.entries(PARAKEET_MODEL_INFO).map(([modelId, info]) => ({
            model: modelId,
            downloaded: false,
            size_mb: info.sizeMb,
          }))
        : parakeetModels;

    return (
      <div className="space-y-0.5">
        {modelsToRender.map((model) => {
          const modelId = model.model;
          const info = PARAKEET_MODEL_INFO[modelId] ?? {
            name: modelId,
            description: t("transcription.fallback.parakeetModelDescription"),
            size: t("common.unknown"),
            language: "en",
            recommended: false,
          };

          return (
            <LocalModelCard
              key={modelId}
              modelId={modelId}
              name={info.name}
              description={info.description}
              size={info.size}
              actualSizeMb={model.size_mb}
              isSelected={modelId === selectedLocalModel}
              isDownloaded={model.downloaded ?? false}
              isDownloading={isDownloadingParakeetModel(modelId)}
              isCancelling={isCancellingParakeet}
              recommended={info.recommended}
              provider="nvidia"
              languageLabel={getParakeetLanguageLabel(info.language)}
              onSelect={() => handleParakeetModelSelect(modelId)}
              onDelete={() => handleParakeetDelete(modelId)}
              onDownload={() =>
                downloadParakeetModel(modelId, (downloadedId) => {
                  setParakeetModels((prev) =>
                    prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
                  );
                  handleParakeetModelSelect(downloadedId);
                })
              }
              onCancel={cancelParakeetDownload}
              styles={styles}
            />
          );
        })}
      </div>
    );
  };

  const renderFasterWhisperModels = () => {
    if (fasterWhisperAvailable === false) {
      return (
        <div className="space-y-2 text-center py-4">
          <p className="text-xs text-muted-foreground">
            {t("transcription.fasterWhisper.unavailable")}
          </p>
          <a
            href="https://docs.astral.sh/uv/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            {t("transcription.fasterWhisper.installGuide")}
          </a>
        </div>
      );
    }

    return (
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground/60 px-1 pb-1">
          {t("transcription.fasterWhisper.autoDownload")}
        </p>
        {Object.entries(WHISPER_MODEL_INFO).map(([modelId, info]) => (
          <LocalModelCard
            key={modelId}
            modelId={modelId}
            name={info.name}
            description={info.description}
            size={info.size}
            isSelected={modelId === selectedLocalModel}
            isDownloaded={true}
            isDownloading={false}
            isCancelling={false}
            recommended={info.recommended}
            provider="faster-whisper"
            onSelect={() => handleFasterWhisperModelSelect(modelId)}
            onDelete={() => {}}
            onDownload={() => {}}
            onCancel={() => {}}
            styles={styles}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className={styles.container}>
        <div className="p-2 pb-0">
          <ProviderTabs
            providers={LOCAL_PROVIDER_TABS}
            selectedId={internalLocalProvider}
            onSelect={handleLocalProviderChange}
            colorScheme="purple"
          />
        </div>

        {progressDisplay}

        {cudaDownloading && internalLocalProvider === "whisper" && (
          <div>
            <DownloadProgressBar modelName="GPU acceleration" progress={cudaProgress} />
            <div className="px-2.5 pb-1 flex justify-end">
              <button
                onClick={handleCudaCancel}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {internalLocalProvider === "whisper" &&
          !cudaDismissed &&
          !cudaDownloading &&
          getCachedPlatform() !== "darwin" &&
          cudaStatus?.gpuInfo.hasNvidiaGpu && (
            <div className="mx-2 mt-2 rounded-md border border-border bg-surface-1 p-2.5">
              {cudaStatus.downloaded ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Check size={13} className="text-success" />
                    <span className="text-xs font-medium text-foreground">{t("gpu.active")}</span>
                  </div>
                  <Button
                    onClick={handleCudaDelete}
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    {t("gpu.remove")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-2.5">
                  <Zap size={13} className="text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      {t("gpu.transcriptionBanner")}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Button
                        onClick={handleCudaDownload}
                        size="sm"
                        variant="default"
                        className="h-6 px-2.5 text-xs"
                      >
                        {t("gpu.enableButton")}
                      </Button>
                      <button
                        onClick={() => setCudaDismissed(true)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t("gpu.dismiss")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        <div className="p-2">
          {internalLocalProvider === "whisper" && renderLocalModels()}
          {internalLocalProvider === "nvidia" && renderParakeetModels()}
          {internalLocalProvider === "faster-whisper" && renderFasterWhisperModels()}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
    </div>
  );
}
