import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { WHISPER_MODEL_INFO } from "../models/localModelData";
import {
  MODEL_PICKER_COLORS,
  type ColorScheme,
} from "../utils/modelPickerStyles";

interface LocalModelCardProps {
  modelId: string;
  name: string;
  description: string;
  size: string;
  isSelected: boolean;
  recommended?: boolean;
  onSelect: () => void;
  selectedClass: string;
  defaultClass: string;
}

function LocalModelCard({
  name,
  size,
  isSelected,
  recommended,
  onSelect,
  selectedClass,
  defaultClass,
}: LocalModelCardProps) {
  const { t } = useTranslation();

  return (
    <div
      onClick={() => {
        if (!isSelected) onSelect();
      }}
      className={`relative w-full text-left overflow-hidden rounded-md border transition-colors duration-200 group cursor-pointer ${
        isSelected ? selectedClass : defaultClass
      }`}
    >
      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-linear-to-b from-primary via-primary to-primary/80 rounded-l-md" />
      )}
      <div className="flex items-center gap-1.5 p-2 pl-2.5">
        <div className="shrink-0">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isSelected
                ? "bg-primary shadow-[0_0_6px_oklch(0.62_0.22_260/0.6)] animate-[pulse-glow_2s_ease-in-out_infinite]"
                : "bg-success shadow-[0_0_4px_rgba(34,197,94,0.5)]"
            }`}
          />
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-semibold text-sm text-foreground truncate tracking-tight">
            {name}
          </span>
          <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">{size}</span>
          {recommended && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-sm bg-primary/10 text-primary">
              {t("common.recommended")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isSelected && (
            <span className="text-xs font-medium text-primary px-2 py-0.5 bg-primary/10 rounded-sm">
              {t("common.active")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export interface TranscriptionModelPickerProps {
  selectedLocalModel: string;
  onLocalModelSelect: (modelId: string) => void;
  className?: string;
  variant?: "onboarding" | "settings";
}

export default function TranscriptionModelPicker({
  selectedLocalModel,
  onLocalModelSelect,
  className = "",
  variant = "settings",
}: TranscriptionModelPickerProps) {
  const { t } = useTranslation();
  const [fasterWhisperAvailable, setFasterWhisperAvailable] = useState<boolean | null>(null);

  const colorScheme: ColorScheme = variant === "settings" ? "purple" : "blue";
  const styles = MODEL_PICKER_COLORS[colorScheme];

  useEffect(() => {
    window.electronAPI
      ?.fasterWhisperStatus?.()
      .then((status) => setFasterWhisperAvailable(status?.available ?? false))
      .catch(() => setFasterWhisperAvailable(false));
  }, []);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      onLocalModelSelect(modelId);
    },
    [onLocalModelSelect]
  );

  if (fasterWhisperAvailable === false) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className={styles.container}>
          <div className="space-y-2 text-center py-4 px-2">
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
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className={styles.container}>
        <div className="p-2">
          <p className="text-xs text-muted-foreground/60 px-1 pb-1">
            {t("transcription.fasterWhisper.autoDownload")}
          </p>
          <div className="space-y-0.5">
            {Object.entries(WHISPER_MODEL_INFO).map(([modelId, info]) => (
              <LocalModelCard
                key={modelId}
                modelId={modelId}
                name={info.name}
                description={info.description}
                size={info.size}
                isSelected={modelId === selectedLocalModel}
                recommended={info.recommended}
                onSelect={() => handleModelSelect(modelId)}
                selectedClass={styles.modelCard.selected}
                defaultClass={styles.modelCard.default}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
