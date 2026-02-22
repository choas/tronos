import type { BootConfig } from "../stores/boot";

const BOOT_STORAGE_KEY = "aios:boot-config";

/**
 * Load boot configuration from localStorage
 * @returns The stored BootConfig or null if not found/invalid
 */
export function loadBootConfig(): BootConfig | null {
  try {
    const stored = localStorage.getItem(BOOT_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const config = JSON.parse(stored) as BootConfig;
    // Validate required fields exist
    if (typeof config.skipBootAnimation === "boolean") {
      return config;
    }
    return null;
  } catch {
    // Invalid JSON or localStorage error
    return null;
  }
}

/**
 * Save boot configuration to localStorage
 * @param config The BootConfig to persist
 */
export function saveBootConfig(config: BootConfig): void {
  try {
    localStorage.setItem(BOOT_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage might be full or disabled
    console.warn("Failed to save boot config to localStorage");
  }
}

/**
 * Clear boot configuration from localStorage
 */
export function clearBootConfig(): void {
  try {
    localStorage.removeItem(BOOT_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
