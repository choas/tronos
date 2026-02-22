import type { AIConfig } from "../stores/ai";

const CONFIG_STORAGE_KEY = "aios:ai-config";

/**
 * Load AI configuration from localStorage
 * @returns The stored AIConfig or null if not found/invalid
 */
export function loadAIConfig(): AIConfig | null {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const config = JSON.parse(stored) as AIConfig;
    // Validate required fields exist
    if (
      typeof config.provider === "string" &&
      typeof config.apiKey === "string" &&
      typeof config.model === "string" &&
      typeof config.baseURL === "string" &&
      typeof config.temperature === "number" &&
      typeof config.maxTokens === "number"
    ) {
      return config;
    }
    return null;
  } catch {
    // Invalid JSON or localStorage error
    return null;
  }
}

/**
 * Save AI configuration to localStorage
 * @param config The AIConfig to persist
 */
export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage might be full or disabled
    console.warn("Failed to save AI config to localStorage");
  }
}

/**
 * Clear AI configuration from localStorage
 */
export function clearAIConfig(): void {
  try {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
