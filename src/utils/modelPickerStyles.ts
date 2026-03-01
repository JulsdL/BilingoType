export type ColorScheme = "purple" | "blue";

export interface ModelPickerStyles {
  container: string;
  header: string;
  modelCard: {
    selected: string;
    default: string;
  };
  badges: {
    recommended: string;
  };
}

const purple: ModelPickerStyles = {
  container: "space-y-3",
  header: "text-sm font-medium text-foreground/70",
  modelCard: {
    selected:
      "border-primary/30 bg-primary/8 dark:bg-primary/6 dark:border-primary/20 shadow-[0_0_0_1px_oklch(0.62_0.22_260/0.12),0_0_10px_-3px_oklch(0.62_0.22_260/0.18)]",
    default:
      "border-border bg-surface-1 hover:border-border-hover hover:bg-muted dark:border-white/5 dark:bg-white/3 dark:hover:border-white/20 dark:hover:bg-white/8",
  },
  badges: {
    recommended:
      "text-[10px] font-medium uppercase tracking-wider text-primary/60 bg-primary/8 dark:bg-primary/12 px-1.5 py-0.5 rounded",
  },
};

const blue: ModelPickerStyles = {
  container: "space-y-3",
  header: "text-sm font-medium text-foreground/70",
  modelCard: {
    selected:
      "border-primary/30 bg-primary/10 dark:bg-primary/6 shadow-[0_0_0_1px_oklch(0.62_0.22_260/0.15),0_0_12px_-3px_oklch(0.62_0.22_260/0.2)]",
    default:
      "border-border bg-surface-1 hover:border-border-hover hover:bg-muted dark:border-white/5 dark:bg-white/3 dark:hover:border-white/20 dark:hover:bg-white/8",
  },
  badges: {
    recommended:
      "text-[10px] font-medium uppercase tracking-wider text-blue-500/60 bg-blue-500/8 dark:bg-blue-400/12 px-1.5 py-0.5 rounded",
  },
};

export const MODEL_PICKER_COLORS: Record<ColorScheme, ModelPickerStyles> = {
  purple,
  blue,
};
