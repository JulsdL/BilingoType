import nvidiaIcon from "../assets/icons/providers/nvidia.svg";
import openaiIcon from "../assets/icons/providers/openai.svg";

const PROVIDER_ICONS: Record<string, string> = {
  nvidia: nvidiaIcon,
  whisper: openaiIcon,
};

export function getProviderIcon(provider: string): string | null {
  return PROVIDER_ICONS[provider] ?? null;
}
