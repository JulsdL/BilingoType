import registry from "../config/languageRegistry.json";

function buildLanguageSet(key: "whisper"): Set<string> {
  const set = new Set<string>();
  for (const lang of registry.languages) {
    if (lang[key]) {
      set.add(lang.code);
      const base = lang.code.split("-")[0];
      if (base !== lang.code) set.add(base);
    }
  }
  return set;
}

const WHISPER_LANGUAGES = buildLanguageSet("whisper");

const LANGUAGE_INSTRUCTIONS: Record<string, string> = Object.fromEntries(
  registry.languages
    .filter(
      (l): l is typeof l & { instruction: string } =>
        "instruction" in l && typeof l.instruction === "string"
    )
    .map((l) => [l.code, l.instruction])
);

export function getBaseLanguageCode(language: string | null | undefined): string | undefined {
  if (!language || language === "auto") return undefined;
  return language.split("-")[0];
}

export function validateLanguageForModel(
  language: string | null | undefined,
  modelId: string
): string | undefined {
  const baseCode = getBaseLanguageCode(language);
  if (!baseCode) return undefined;

  // All faster-whisper models support the same languages as Whisper
  if (!WHISPER_LANGUAGES.has(baseCode)) return undefined;

  return baseCode;
}

export function getLanguageInstruction(language: string | undefined): string {
  if (!language) return "";
  return LANGUAGE_INSTRUCTIONS[language] || buildGenericInstruction(language);
}

function buildGenericInstruction(langCode: string): string {
  const template = registry._genericTemplate || "";
  return template.replace("{{code}}", langCode);
}

export { WHISPER_LANGUAGES };
