import { getProviderIcon } from "../../utils/providerIcons";

interface ProviderIconProps {
  provider: string;
  size?: number;
  className?: string;
}

export function ProviderIcon({ provider, size = 14, className = "" }: ProviderIconProps) {
  const icon = getProviderIcon(provider);
  if (!icon) return null;
  return (
    <img
      src={icon}
      alt={provider}
      width={size}
      height={size}
      className={className}
    />
  );
}
