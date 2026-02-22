import type { ThemeConfig } from "../stores/theme";
import { PRESET_THEMES } from "../stores/theme";

const THEME_STORAGE_KEY = "aios:theme";

/**
 * Load theme configuration from localStorage
 * Handles both old format { theme: "dark" } and new format { theme: "dark", colors: {...} }
 * @returns The stored ThemeConfig or null if not found/invalid
 */
export function loadTheme(): ThemeConfig | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const config = JSON.parse(stored);

    // Handle legacy format: { theme: "dark" | "light" } without colors
    if (config.theme && !config.colors) {
      const preset = PRESET_THEMES[config.theme];
      if (preset) {
        return {
          theme: config.theme,
          colors: { ...preset.colors },
        };
      }
      return null;
    }

    // Validate new format
    if (config.theme && config.colors && typeof config.colors === 'object') {
      return config as ThemeConfig;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Save theme configuration to localStorage
 * @param config The ThemeConfig to persist
 */
export function saveTheme(config: ThemeConfig): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn("Failed to save theme config to localStorage");
  }
}

/**
 * Clear theme configuration from localStorage
 */
export function clearTheme(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
