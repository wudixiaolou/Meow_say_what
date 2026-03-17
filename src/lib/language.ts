import { AppLanguage } from "../types";

export const LANGUAGE_STORAGE_KEY = "meowlingo_language";
const LEGACY_LANGUAGE_STORAGE_KEY = "meowlingo_lang";

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === "zh" || value === "en";
}

export function getStoredLanguage(): AppLanguage {
  const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isAppLanguage(raw)) {
    return raw;
  }
  const legacy = window.localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
  if (isAppLanguage(legacy)) {
    return legacy;
  }
  return "en";
}

export function persistLanguage(nextLanguage: AppLanguage) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  window.localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
}

export function getLocaleByLanguage(language: AppLanguage) {
  return language === "zh" ? "zh-CN" : "en-US";
}

export function getSpeechLanguageCode(language: AppLanguage) {
  return language === "zh" ? "zh-CN" : "en-US";
}
