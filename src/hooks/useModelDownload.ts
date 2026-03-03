import { useState, useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useDialogs } from "./useDialogs";
import { useToast } from "../components/ui/Toast";
import type { WhisperDownloadProgressData } from "../types/electron";
import "../types/electron";

const PROGRESS_THROTTLE_MS = 100;

export interface DownloadProgress {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speed?: number;
  eta?: number;
}

export type ModelType = "faster-whisper";

interface UseModelDownloadOptions {
  modelType: ModelType;
  onDownloadComplete?: () => void;
  onModelsCleared?: () => void;
}

interface LLMDownloadProgressData {
  modelId: string;
  progress: number;
  downloadedSize: number;
  totalSize: number;
}

export function formatETA(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function getDownloadErrorMessage(t: TFunction, error: string, code?: string): string {
  if (code === "EXTRACTION_FAILED" || error.includes("installation failed"))
    return t("hooks.modelDownload.errors.extractionFailed");
  if (code === "ETIMEDOUT" || error.includes("timeout") || error.includes("stalled"))
    return t("hooks.modelDownload.errors.timeout");
  if (code === "ENOTFOUND" || error.includes("ENOTFOUND"))
    return t("hooks.modelDownload.errors.notFound");
  if (error.includes("disk space")) return error;
  if (error.includes("corrupted") || error.includes("incomplete") || error.includes("too small"))
    return t("hooks.modelDownload.errors.corrupted");
  if (error.includes("HTTP 429") || error.includes("rate limit"))
    return t("hooks.modelDownload.errors.rateLimited");
  if (error.includes("HTTP 4") || error.includes("HTTP 5"))
    return t("hooks.modelDownload.errors.server", { error });
  return t("hooks.modelDownload.errors.generic", { error });
}

export function useModelDownload({
  modelType,
  onDownloadComplete,
  onModelsCleared,
}: UseModelDownloadOptions) {
  const { t } = useTranslation();
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isCancellingRef = useRef(false);
  const lastProgressUpdateRef = useRef(0);

  const { showAlertDialog } = useDialogs();
  const { toast } = useToast();
  const showAlertDialogRef = useRef(showAlertDialog);
  const onDownloadCompleteRef = useRef(onDownloadComplete);
  const onModelsClearedRef = useRef(onModelsCleared);

  useEffect(() => {
    showAlertDialogRef.current = showAlertDialog;
  }, [showAlertDialog]);

  useEffect(() => {
    onDownloadCompleteRef.current = onDownloadComplete;
  }, [onDownloadComplete]);

  useEffect(() => {
    onModelsClearedRef.current = onModelsCleared;
  }, [onModelsCleared]);

  useEffect(() => {
    const handleModelsCleared = () => onModelsClearedRef.current?.();
    window.addEventListener("bilingotype-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("bilingotype-models-cleared", handleModelsCleared);
  }, []);

  const handleWhisperProgress = useCallback(
    (_event: unknown, data: WhisperDownloadProgressData) => {
      if (data.type === "progress") {
        const now = Date.now();
        if (now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) return;
        lastProgressUpdateRef.current = now;
        setDownloadProgress({
          percentage: data.percentage || 0,
          downloadedBytes: data.downloaded_bytes || 0,
          totalBytes: data.total_bytes || 0,
        });
      } else if (data.type === "installing") {
        setIsInstalling(true);
      } else if (data.type === "complete") {
        if (isCancellingRef.current) return;
        setIsInstalling(false);
        // Don't clear downloadingModel/downloadProgress here — let downloadModel's
        // finally block handle it after the model list has been refreshed.
        // This prevents a flash where the model appears "not downloaded".
      } else if (data.type === "error") {
        if (isCancellingRef.current) return;
        const msg = getDownloadErrorMessage(
          t,
          data.error || t("hooks.modelDownload.errors.unknown"),
          data.code
        );
        const title =
          data.code === "EXTRACTION_FAILED"
            ? t("hooks.modelDownload.installationFailed.title")
            : t("hooks.modelDownload.downloadFailed.title");
        setDownloadError(msg);
        showAlertDialogRef.current({ title, description: msg });
        setIsInstalling(false);
        setDownloadingModel(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      }
    },
    [t]
  );

  const handleLLMProgress = useCallback((_event: unknown, data: LLMDownloadProgressData) => {
    if (isCancellingRef.current) return;

    const now = Date.now();
    const isComplete = data.progress >= 100;
    if (!isComplete && now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) {
      return;
    }
    lastProgressUpdateRef.current = now;

    setDownloadProgress({
      percentage: data.progress || 0,
      downloadedBytes: data.downloadedSize || 0,
      totalBytes: data.totalSize || 0,
    });
  }, []);

  useEffect(() => {
    // faster-whisper auto-downloads models via the Python sidecar,
    // so no progress listener is needed for now.
    return undefined;
  }, [modelType]);

  const downloadModel = useCallback(
    async (modelId: string, onSelectAfterDownload?: (id: string) => void) => {
      if (downloadingModel) {
        toast({
          title: t("hooks.modelDownload.downloadInProgress.title"),
          description: t("hooks.modelDownload.downloadInProgress.description"),
        });
        return;
      }

      try {
        setDownloadingModel(modelId);
        setDownloadError(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
        lastProgressUpdateRef.current = 0; // Reset throttle timer

        // faster-whisper auto-downloads models via the Python sidecar
        // Just mark as success since the model will be downloaded on first use
        const success = true;

        if (success) {
          onSelectAfterDownload?.(modelId);
        }

        // Await the refresh so the model list is updated before we clear
        // the downloading state in `finally`. This prevents a flash where
        // the model briefly appears "not downloaded".
        try {
          await onDownloadCompleteRef.current?.();
        } catch {
          // Non-fatal — the model is on disk regardless
        }
      } catch (error: unknown) {
        if (isCancellingRef.current) return;

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          !errorMessage.includes("interrupted by user") &&
          !errorMessage.includes("cancelled by user") &&
          !errorMessage.includes("DOWNLOAD_CANCELLED")
        ) {
          const msg = getDownloadErrorMessage(t, errorMessage);
          setDownloadError(msg);
          showAlertDialog({
            title: t("hooks.modelDownload.downloadFailed.title"),
            description: msg,
          });
        }
      } finally {
        setIsInstalling(false);
        setDownloadingModel(null);
        setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
      }
    },
    [downloadingModel, modelType, showAlertDialog, toast, t]
  );

  const deleteModel = useCallback(
    async (_modelId: string, onComplete?: () => void) => {
      // faster-whisper models are managed by the Python sidecar
      // and cached in its model directory. No manual deletion needed.
      onComplete?.();
    },
    []
  );

  const cancelDownload = useCallback(async () => {
    // faster-whisper auto-downloads are managed by the Python sidecar
    // No manual cancellation needed
    setIsCancelling(false);
    isCancellingRef.current = false;
    setDownloadingModel(null);
    setDownloadProgress({ percentage: 0, downloadedBytes: 0, totalBytes: 0 });
  }, []);

  const isDownloading = downloadingModel !== null;
  const isDownloadingModel = useCallback(
    (modelId: string) => downloadingModel === modelId,
    [downloadingModel]
  );

  return {
    downloadingModel,
    downloadProgress,
    downloadError,
    isDownloading,
    isDownloadingModel,
    isInstalling,
    isCancelling,
    downloadModel,
    deleteModel,
    cancelDownload,
    formatETA,
  };
}
