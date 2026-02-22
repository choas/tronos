import type { TermsConfig } from "../stores/terms";

const TERMS_STORAGE_KEY = "aios:terms-config";

/**
 * Load terms configuration from localStorage
 * @returns The stored TermsConfig or null if not found/invalid
 */
export function loadTermsConfig(): TermsConfig | null {
  try {
    const stored = localStorage.getItem(TERMS_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const config = JSON.parse(stored) as TermsConfig;
    if (typeof config.accepted === "boolean" && typeof config.version === "string") {
      return config;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save terms configuration to localStorage
 * @param config The TermsConfig to persist
 */
export function saveTermsConfig(config: TermsConfig): void {
  try {
    localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn("Failed to save terms config to localStorage");
  }
}

/**
 * Clear terms configuration from localStorage
 */
export function clearTermsConfig(): void {
  try {
    localStorage.removeItem(TERMS_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
