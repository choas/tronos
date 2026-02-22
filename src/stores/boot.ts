import { createStore } from "solid-js/store";
import { loadBootConfig, saveBootConfig, clearBootConfig } from "../persistence/boot";

/** Boot configuration interface */
export interface BootConfig {
  skipBootAnimation: boolean;
}

/** Boot config state interface */
interface BootConfigState {
  config: BootConfig;
}

/** Default configuration */
const DEFAULT_CONFIG: BootConfig = {
  skipBootAnimation: false
};

export const [bootConfigState, setBootConfigState] = createStore<BootConfigState>({
  config: DEFAULT_CONFIG
});

/**
 * Get the current boot configuration
 */
export function getBootConfig(): BootConfig {
  return bootConfigState.config;
}

/**
 * Check if boot animation should be skipped
 */
export function shouldSkipBootAnimation(): boolean {
  return bootConfigState.config.skipBootAnimation;
}

/**
 * Set whether to skip boot animation
 */
export function setSkipBootAnimation(skip: boolean): void {
  setBootConfigState("config", "skipBootAnimation", skip);
  // Persist to localStorage
  saveBootConfig(bootConfigState.config);
}

/**
 * Reset boot configuration to defaults
 */
export function resetBootConfig(): void {
  // Use spread to ensure a new object is created, avoiding Solid.js store proxy issues
  setBootConfigState("config", { ...DEFAULT_CONFIG });
  clearBootConfig();
}

/**
 * Load boot configuration from localStorage on startup
 * Returns true if config was loaded, false if using defaults
 */
export function loadPersistedBootConfig(): boolean {
  const storedConfig = loadBootConfig();
  if (storedConfig) {
    setBootConfigState("config", storedConfig);
    return true;
  }
  return false;
}
