// i18n module for Local LLM Hub
import { en, type TranslationKey } from "./en";
import { ja } from "./ja";

export type { TranslationKey };

type Translations = Record<string, string>;

const translations: Record<string, Translations> = {
  en,
  ja,
};

// Current locale
let currentLocale = "en";

/**
 * Get the current locale
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Set the current locale
 */
export function setLocale(locale: string): void {
  const normalizedLocale = locale.split("-")[0].toLowerCase();
  if (translations[normalizedLocale]) {
    currentLocale = normalizedLocale;
  } else {
    currentLocale = "en";
  }
}

/**
 * Initialize locale from Obsidian's moment locale
 */
export function initLocale(): void {
  try {
    const momentLocale = window.moment?.locale?.() || navigator.language || "en";
    setLocale(momentLocale);
  } catch {
    setLocale("en");
  }
}

/**
 * Translate a key with optional variable substitution
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const localeTranslations = translations[currentLocale] || translations.en;
  let result = localeTranslations[key] || translations.en[key] || key;

  if (vars) {
    for (const [varName, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${varName}\\}\\}`, "g"), String(value));
    }
  }

  return result;
}
